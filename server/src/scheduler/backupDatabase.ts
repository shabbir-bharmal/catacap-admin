import { spawn, spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { createGzip } from "zlib";
import { Writable } from "stream";
import { pipeline } from "stream/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pool from "../db.js";

const RETENTION_DAYS = 7;
const DOWNLOAD_URL_TTL_SECONDS = 300;
const STORAGE_PATH_PATTERN =
  /^\d{4}-\d{2}-\d{2}\/backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.sql\.gz$/;
const LEGACY_TIME_ONLY_PATTERN =
  /^\d{4}-\d{2}-\d{2}\/backup-\d{2}-\d{2}\.sql\.gz$/;
const LEGACY_DOUBLE_NESTED_PATTERN =
  /^database-backups\/\d{4}-\d{2}-\d{2}\/backup-\d{2}-\d{2}\.sql\.gz$/;

export { RETENTION_DAYS };

const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /SSL connection has been closed unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /connection reset by peer/i,
  /could not receive data from server/i,
];

const RETRY_BACKOFF_MS = 5000;

interface BackupStorageConfig {
  client: SupabaseClient;
  bucket: string;
}

interface ResolvedDumpUrl {
  url: string;
  source: "SUPABASE_DB_DIRECT_URL" | "SUPABASE_DB_URL" | "DATABASE_URL";
  isPooler: boolean;
  hasDirectFallback: boolean;
}

export function resolveBackupDumpUrl(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDumpUrl {
  const direct = env.SUPABASE_DB_DIRECT_URL;
  const supa = env.SUPABASE_DB_URL;
  const fallback = env.DATABASE_URL;

  let chosen: string | undefined;
  let source: ResolvedDumpUrl["source"];
  if (direct) {
    chosen = direct;
    source = "SUPABASE_DB_DIRECT_URL";
  } else if (supa) {
    chosen = supa;
    source = "SUPABASE_DB_URL";
  } else if (fallback) {
    chosen = fallback;
    source = "DATABASE_URL";
  } else {
    throw new Error(
      "BackupDatabase: SUPABASE_DB_DIRECT_URL, SUPABASE_DB_URL, or DATABASE_URL must be set. " +
        "Prefer SUPABASE_DB_DIRECT_URL pointing at a direct (non-pooler) Postgres connection " +
        "so pg_dump COPY streams aren't terminated by PgBouncer.",
    );
  }

  return {
    url: chosen,
    source,
    isPooler: looksLikeSupabasePoolerUrl(chosen),
    hasDirectFallback: Boolean(direct),
  };
}

function looksLikeSupabasePoolerUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("pooler.supabase")) return true;
    if (u.port === "6543") return true;
    if ((u.searchParams.get("pgbouncer") || "").toLowerCase() === "true")
      return true;
    return false;
  } catch {
    return /pooler\.supabase|:6543\b|pgbouncer=true/i.test(rawUrl);
  }
}

export function withKeepaliveParams(rawUrl: string): string {
  const desired: Record<string, string> = {
    keepalives: "1",
    keepalives_idle: "30",
    keepalives_interval: "10",
    keepalives_count: "5",
    connect_timeout: "30",
  };
  try {
    const u = new URL(rawUrl);
    for (const [k, v] of Object.entries(desired)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    const sep = rawUrl.includes("?") ? "&" : "?";
    const existing = rawUrl.includes("?")
      ? rawUrl.slice(rawUrl.indexOf("?") + 1)
      : "";
    const present = new Set(
      existing
        .split("&")
        .filter(Boolean)
        .map((kv) => kv.split("=")[0]),
    );
    const additions = Object.entries(desired)
      .filter(([k]) => !present.has(k))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return additions ? `${rawUrl}${sep}${additions}` : rawUrl;
  }
}

function isTransientPgDumpError(stderr: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(stderr));
}

function extractFailingTable(stderr: string): string | null {
  const m = stderr.match(/Dumping the contents of table "([^"]+)" failed/);
  return m ? m[1] : null;
}

export function getBackupStorageConfig(): BackupStorageConfig {
  const url = process.env.SUPABASE_URL;
  const backupKey = process.env.SUPABASE_BACKUP_KEY;
  const bucket = process.env.SUPABASE_BACKUP_BUCKET;
  if (!url) {
    throw new Error("BackupDatabase: missing environment variable SUPABASE_URL.");
  }
  if (!backupKey) {
    throw new Error(
      "BackupDatabase: missing environment variable SUPABASE_BACKUP_KEY. " +
        "This MUST be the Supabase service_role key (NOT the publishable/anon key " +
        "used by SUPABASE_KEY). The backup job needs Storage Admin privileges to " +
        "verify the private bucket, upload the dump, prune old backups, and sign " +
        "download URLs — none of which the publishable key can do safely.",
    );
  }
  if (process.env.SUPABASE_KEY && backupKey === process.env.SUPABASE_KEY) {
    throw new Error(
      "BackupDatabase: SUPABASE_BACKUP_KEY must be different from SUPABASE_KEY. " +
        "SUPABASE_KEY is the publishable/anon key shipped to the browser; " +
        "SUPABASE_BACKUP_KEY must be the service_role key (backend-only).",
    );
  }
  if (!bucket) {
    throw new Error(
      "BackupDatabase: missing environment variable SUPABASE_BACKUP_BUCKET. " +
        "Database backups MUST go to a dedicated PRIVATE Supabase Storage bucket — " +
        "do NOT reuse the public asset bucket (SUPABASE_STORAGE_BUCKET).",
    );
  }
  if (
    process.env.SUPABASE_STORAGE_BUCKET &&
    bucket === process.env.SUPABASE_STORAGE_BUCKET
  ) {
    throw new Error(
      `BackupDatabase: SUPABASE_BACKUP_BUCKET ("${bucket}") must be different from ` +
        `the public app bucket SUPABASE_STORAGE_BUCKET. Configure a separate ` +
        `private bucket for database backups.`,
    );
  }
  return {
    client: createClient(url, backupKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    bucket,
  };
}

async function assertBucketIsPrivate(
  client: SupabaseClient,
  bucket: string,
): Promise<void> {
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || !data) {
    throw new Error(
      `BackupDatabase: could not verify bucket "${bucket}" privacy ` +
        `(getBucket failed: ${error?.message ?? "no data returned"}). ` +
        `Refusing to upload database dump until privacy can be confirmed.`,
    );
  }
  if (data.public === true) {
    throw new Error(
      `BackupDatabase: target bucket "${bucket}" is PUBLIC. ` +
        `Database dumps may contain PII/secrets and must only be written to a ` +
        `private bucket. Mark the bucket private in the Supabase dashboard ` +
        `(or point SUPABASE_BACKUP_BUCKET at a different private bucket) before re-running.`,
    );
  }
}

function getPgDumpVersion(binPath: string): number | null {
  try {
    const res = spawnSync(binPath, ["--version"], { encoding: "utf8" });
    if (res.status !== 0) return null;
    const match = /pg_dump \(PostgreSQL\) (\d+)/.exec(res.stdout || "");
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function getServerMajorVersion(): Promise<number> {
  const r = await pool.query<{ server_version_num: string }>(
    "SHOW server_version_num",
  );
  const num = Number(r.rows[0]?.server_version_num);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("BackupDatabase: could not determine Postgres server version.");
  }
  return Math.floor(num / 10000);
}

function resolvePgDumpPath(requiredMajor: number): string {
  const override = process.env.PG_DUMP_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `BackupDatabase: PG_DUMP_PATH=${override} does not exist.`,
      );
    }
    const v = getPgDumpVersion(override);
    if (v !== requiredMajor) {
      throw new Error(
        `BackupDatabase: PG_DUMP_PATH (${override}) is pg_dump v${v ?? "?"}, ` +
          `but the Postgres server is v${requiredMajor}. Major versions must match.`,
      );
    }
    return override;
  }

  const candidates: string[] = [];
  const pathDirs = (process.env.PATH || "").split(":").filter(Boolean);
  for (const dir of pathDirs) {
    const p = path.join(dir, "pg_dump");
    if (existsSync(p)) candidates.push(p);
  }

  try {
    const storeEntries = readdirSync("/nix/store");
    const re = new RegExp(`^[a-z0-9]+-postgresql-${requiredMajor}\\.`);
    for (const entry of storeEntries) {
      if (!re.test(entry)) continue;
      const p = `/nix/store/${entry}/bin/pg_dump`;
      if (existsSync(p)) candidates.push(p);
    }
  } catch {
    /* ignore */
  }

  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (getPgDumpVersion(c) === requiredMajor) return c;
  }

  const tried = [...seen].join(", ") || "(none found)";
  throw new Error(
    `BackupDatabase: no pg_dump matching server major version ${requiredMajor} ` +
      `was found on PATH or in /nix/store. Tried: ${tried}. ` +
      `Set PG_DUMP_PATH to a pg_dump v${requiredMajor} binary.`,
  );
}

function buildDateFolder(now: Date): string {
  const Y = now.getUTCFullYear();
  const M = String(now.getUTCMonth() + 1).padStart(2, "0");
  const D = String(now.getUTCDate()).padStart(2, "0");
  return `${Y}-${M}-${D}`;
}

function buildBackupFilename(now: Date): string {
  const dateStr = buildDateFolder(now);
  const H = String(now.getUTCHours()).padStart(2, "0");
  const m = String(now.getUTCMinutes()).padStart(2, "0");
  return `backup-${dateStr}-${H}-${m}.sql.gz`;
}

interface PruneResult {
  prunedFiles: number;
  prunedFolders: string[];
  prunedPaths: string[];
  warnings: string[];
}

async function logRetentionRun(
  startedAt: Date,
  prune: PruneResult,
): Promise<void> {
  const status: "Success" | "Failed" =
    prune.prunedFiles === 0 && prune.warnings.length > 0 ? "Failed" : "Success";
  const summary =
    prune.prunedFiles > 0
      ? `Deleted ${prune.prunedFiles} backup file(s) older than ${RETENTION_DAYS} day(s)` +
        (prune.prunedFolders.length > 0
          ? ` from folder(s): ${prune.prunedFolders.join(", ")}`
          : "")
      : null;
  const errorMessage =
    status === "Failed"
      ? `Retention pass failed: ${prune.warnings.join("; ")}`
      : null;
  const metadata = {
    action: "retention",
    retentionDays: RETENTION_DAYS,
    prunedFiles: prune.prunedFiles,
    prunedFolders: prune.prunedFolders,
    prunedPaths: prune.prunedPaths,
    warnings: prune.warnings,
    summary,
  };
  try {
    await pool.query(
      `INSERT INTO scheduler_logs
        (start_time, end_time, error_message, job_name, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [startedAt, new Date(), errorMessage, "BackupDatabase", status, metadata],
    );
  } catch (err) {
    console.error(
      `[BackupDatabase] Failed to insert retention log row:`,
      err,
    );
  }
}

async function pruneOldBackups(
  supabase: SupabaseClient,
  bucket: string,
  now: Date,
): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffYMD = buildDateFolder(cutoff);
  const result: PruneResult = {
    prunedFiles: 0,
    prunedFolders: [],
    prunedPaths: [],
    warnings: [],
  };

  const { data: entries, error: listErr } = await supabase.storage
    .from(bucket)
    .list("", { limit: 1000 });
  if (listErr) {
    result.warnings.push(`list bucket root failed: ${listErr.message}`);
    return result;
  }
  if (!entries || entries.length === 0) return result;

  for (const entry of entries) {
    if (entry.id !== null) continue;
    const folderName = entry.name;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(folderName)) continue;
    if (folderName >= cutoffYMD) continue;

    const folderPath = folderName;
    const { data: files, error: subListErr } = await supabase.storage
      .from(bucket)
      .list(folderPath, { limit: 1000 });
    if (subListErr) {
      result.warnings.push(`list ${folderPath}/ failed: ${subListErr.message}`);
      continue;
    }
    if (!files || files.length === 0) continue;

    const paths = files
      .filter((f) => f.id !== null)
      .map((f) => `${folderPath}/${f.name}`);
    if (paths.length === 0) continue;

    const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
    if (rmErr) {
      result.warnings.push(`remove ${folderPath}/ failed: ${rmErr.message}`);
      continue;
    }
    result.prunedFiles += paths.length;
    result.prunedFolders.push(folderName);
    result.prunedPaths.push(...paths);
  }
  return result;
}

function normalizeStoragePath(rawInput: string, bucket: string): string {
  const input = rawInput.trim().replace(/^\/+/, "");
  const bucketPrefix = `${bucket}/`;
  const candidate = input.startsWith(bucketPrefix)
    ? input.slice(bucketPrefix.length)
    : input;
  if (candidate.includes("..") || candidate.includes("\\")) {
    throw new Error("BackupDatabase: invalid backup path.");
  }
  if (STORAGE_PATH_PATTERN.test(candidate)) {
    return candidate;
  }
  if (
    LEGACY_TIME_ONLY_PATTERN.test(candidate) ||
    LEGACY_DOUBLE_NESTED_PATTERN.test(candidate)
  ) {
    return candidate;
  }
  throw new Error(
    `BackupDatabase: backup path "${candidate}" does not match the expected ` +
      `<YYYY-MM-DD>/backup-<YYYY-MM-DD>-<HH-MM>.sql.gz format ` +
      `(legacy <YYYY-MM-DD>/backup-<HH-MM>.sql.gz and ` +
      `database-backups/<YYYY-MM-DD>/backup-<HH-MM>.sql.gz formats are also accepted).`,
  );
}

export async function createBackupDownloadUrl(
  rawPath: string,
): Promise<{ url: string; storagePath: string; expiresInSeconds: number }> {
  const { client: supabase, bucket } = getBackupStorageConfig();
  await assertBucketIsPrivate(supabase, bucket);
  const storagePath = normalizeStoragePath(rawPath, bucket);

  const downloadFilename = storagePath.split("/").pop() ?? "backup.sql.gz";
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS, {
      download: downloadFilename,
    });

  if (error || !data?.signedUrl) {
    throw new Error(
      `BackupDatabase: failed to sign download URL for "${storagePath}": ` +
        `${error?.message ?? "no signed URL returned"}`,
    );
  }

  return {
    url: data.signedUrl,
    storagePath,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  };
}

interface PgDumpAttemptResult {
  ok: boolean;
  buffer: Buffer;
  stderr: string;
  exitCode: number;
  spawnError: Error | null;
  pipelineError: Error | null;
}

async function runPgDumpOnce(
  pgDumpPath: string,
  dumpUrl: string,
): Promise<PgDumpAttemptResult> {
  const child = spawn(
    pgDumpPath,
    ["--no-owner", "--no-privileges", dumpUrl],
    {
      env: {
        ...process.env,
        PGSSLMODE: process.env.PGSSLMODE || "require",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const gzip = createGzip();
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

  let spawnError: Error | null = null;
  child.on("error", (err) => {
    spawnError = err;
  });

  const exitPromise = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? -1));
  });

  let pipelineError: Error | null = null;
  const pipelinePromise = pipeline(child.stdout, gzip, sink).catch((err) => {
    pipelineError = err instanceof Error ? err : new Error(String(err));
  });

  const exitCode = await exitPromise;
  await pipelinePromise;

  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  const buffer = Buffer.concat(chunks);
  const ok =
    !spawnError && !pipelineError && exitCode === 0 && buffer.length > 0;
  return { ok, buffer, stderr, exitCode, spawnError, pipelineError };
}

export async function runBackupDatabase(): Promise<Record<string, unknown>> {
  const resolved = resolveBackupDumpUrl();
  if (resolved.isPooler) {
    if (resolved.hasDirectFallback) {
      console.warn(
        `[BackupDatabase] Resolved dump URL from ${resolved.source} still looks like a Supabase pooler ` +
          `connection (port 6543 / pooler.supabase / pgbouncer=true). PgBouncer can drop long COPY ` +
          `streams mid-dump. Point SUPABASE_DB_DIRECT_URL at the direct (port 5432) database URL.`,
      );
    } else {
      console.warn(
        `[BackupDatabase] ${resolved.source} points at a Supabase pooler connection ` +
          `(PgBouncer). Long COPY streams can be dropped mid-dump, causing "SSL connection ` +
          `has been closed unexpectedly" errors. Set SUPABASE_DB_DIRECT_URL to a direct ` +
          `(non-pooler, port 5432) Postgres URL to avoid this. Proceeding with the pooler URL.`,
      );
    }
  }
  const dumpUrl = withKeepaliveParams(resolved.url);

  const now = new Date();
  const dateFolder = buildDateFolder(now);
  const filename = buildBackupFilename(now);
  const storagePath = `${dateFolder}/${filename}`;

  const { client: supabase, bucket } = getBackupStorageConfig();
  await assertBucketIsPrivate(supabase, bucket);

  const serverMajor = await getServerMajorVersion();
  const pgDumpPath = resolvePgDumpPath(serverMajor);

  console.log(
    `[BackupDatabase] Starting ${pgDumpPath} (v${serverMajor}) -> ${bucket}/${storagePath} ` +
      `[urlSource=${resolved.source}, pooler=${resolved.isPooler}]`,
  );

  const formatAttemptError = (
    attempt: PgDumpAttemptResult,
    label: string,
  ): string => {
    if (attempt.spawnError) {
      return `${label}: failed to spawn pg_dump: ${attempt.spawnError.message}`;
    }
    if (attempt.exitCode !== 0) {
      return `${label}: pg_dump exited with code ${attempt.exitCode}. ${attempt.stderr || "(no stderr output)"}`;
    }
    if (attempt.pipelineError) {
      return `${label}: gzip pipeline failed: ${attempt.pipelineError.message}. ${attempt.stderr || ""}`.trim();
    }
    if (attempt.buffer.length === 0) {
      return `${label}: pg_dump produced an empty output. ${attempt.stderr || ""}`.trim();
    }
    return `${label}: unknown failure. ${attempt.stderr || ""}`.trim();
  };

  let attempt = await runPgDumpOnce(pgDumpPath, dumpUrl);
  let retried = false;
  let firstAttemptStderr = "";

  if (!attempt.ok) {
    const transient =
      isTransientPgDumpError(attempt.stderr) ||
      (attempt.pipelineError !== null &&
        isTransientPgDumpError(String(attempt.pipelineError.message)));
    const failingTable = extractFailingTable(attempt.stderr);
    if (transient) {
      retried = true;
      firstAttemptStderr = attempt.stderr;
      console.warn(
        `[BackupDatabase] pg_dump server dropped the connection (will retry once after ${RETRY_BACKOFF_MS}ms)` +
          (failingTable ? ` [table=${failingTable}]` : "") +
          `. First-attempt stderr: ${attempt.stderr || "(empty)"}`,
      );
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      attempt = await runPgDumpOnce(pgDumpPath, dumpUrl);
      if (attempt.ok) {
        console.log(
          `[BackupDatabase] pg_dump retry succeeded after transient connection drop` +
            (failingTable ? ` [table=${failingTable}]` : ""),
        );
      }
    }

    if (!attempt.ok) {
      const secondTransient =
        isTransientPgDumpError(attempt.stderr) ||
        (attempt.pipelineError !== null &&
          isTransientPgDumpError(String(attempt.pipelineError.message)));
      const failingTableFinal =
        extractFailingTable(attempt.stderr) || failingTable;
      const classification = secondTransient || transient ? "yes" : "no";
      const tableSuffix = failingTableFinal
        ? ` [failingTable=${failingTableFinal}]`
        : "";
      const retrySuffix = retried
        ? ` First-attempt stderr: ${firstAttemptStderr || "(empty)"}.`
        : "";
      throw new Error(
        `BackupDatabase: ${formatAttemptError(attempt, retried ? "retry attempt" : "pg_dump")}` +
          ` [transient=${classification}, retried=${retried}]${tableSuffix}.${retrySuffix}`,
      );
    }
  }

  const buffer = attempt.buffer;

  console.log(
    `[BackupDatabase] pg_dump+gzip complete (${buffer.length} bytes). Uploading to private bucket "${bucket}"...`,
  );

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: "application/gzip",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(
      `BackupDatabase: Supabase Storage upload failed: ${uploadError.message}`,
    );
  }

  const artifactPath = `${bucket}/${storagePath}`;
  console.log(
    `[BackupDatabase] Backup uploaded successfully -> ${artifactPath} (${buffer.length} bytes)`,
  );

  const retentionStartedAt = new Date();
  const prune = await pruneOldBackups(supabase, bucket, now);
  if (prune.prunedFiles > 0) {
    console.log(
      `[BackupDatabase] Retention: deleted ${prune.prunedFiles} file(s) from ${prune.prunedFolders.length} folder(s) older than ${RETENTION_DAYS} days [${prune.prunedFolders.join(", ")}]`,
    );
  }
  for (const w of prune.warnings) {
    console.warn(`[BackupDatabase] Retention warning: ${w}`);
  }
  if (prune.prunedFiles > 0 || prune.warnings.length > 0) {
    await logRetentionRun(retentionStartedAt, prune);
  }

  return {
    artifactPath,
    bucket,
    storagePath,
    sizeBytes: buffer.length,
    filename,
    retentionDays: RETENTION_DAYS,
    prunedFiles: prune.prunedFiles,
    prunedFolders: prune.prunedFolders,
    prunedPaths: prune.prunedPaths,
    pruneWarnings: prune.warnings,
  };
}
