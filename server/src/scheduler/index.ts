import cron, { ScheduledTask } from "node-cron";
import pool from "../db.js";
import { runSendReminderEmail } from "./sendReminderEmail.js";
import { runDailyCleanup } from "./dailyCleanup.js";
import { runDeleteTestUsers } from "./deleteTestUsers.js";
import { runWelcomeSeries } from "./welcomeSeries.js";
import { runWeeklyKenStats } from "./weeklyKenStats.js";
import { runCampaignUpdateNotifications } from "./campaignUpdateNotifications.js";
import { runExpireMatchGrants } from "./expireMatchGrants.js";
import { runBackupDatabase } from "./backupDatabase.js";

const LOCK_KEYS: Record<string, number> = {
  SendReminderEmail: 900001,
  DeleteArchivedUsers: 900002,
  DeleteTestUsers: 900003,
  WelcomeSeries: 900004,
  WeeklyKenStats: 900005,
  CampaignUpdateNotifications: 900005,
  ExpireMatchGrants: 900006,
  BackupDatabase: 900007,
};

type JobResult = Record<string, unknown> | void;

const JOB_RUNNERS: Record<string, () => Promise<JobResult>> = {
  SendReminderEmail: runSendReminderEmail,
  DeleteArchivedUsers: runDailyCleanup,
  DeleteTestUsers: runDeleteTestUsers,
  WelcomeSeries: runWelcomeSeries,
  WeeklyKenStats: runWeeklyKenStats,
  ExpireMatchGrants: runExpireMatchGrants,
  BackupDatabase: runBackupDatabase,
};

const WEEKLY_JOBS: Record<string, number> = {
  WeeklyKenStats: 1,
  CampaignUpdateNotifications: runCampaignUpdateNotifications,
};

const activeTasks: ScheduledTask[] = [];

async function withAdvisoryLock(
  lockKey: number,
  jobName: string,
  fn: () => Promise<void>
): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockKey]
    );

    if (!lockResult.rows[0].acquired) {
      console.log(
        `[SCHEDULER] ${jobName} already running (advisory lock not acquired). Skipping.`
      );
      return;
    }

    try {
      await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
    }
  } finally {
    client.release();
  }
}

interface PgErrorLike {
  message?: string;
  code?: string;
  severity?: string;
  table?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
}

function extractSchedulerErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const pgErr = err as PgErrorLike;
    const parts: string[] = [pgErr.message || String(err)];
    if (pgErr.code) parts.push(`[SQLSTATE: ${pgErr.code}]`);
    if (pgErr.table) parts.push(`[Table: ${pgErr.table}]`);
    if (pgErr.column) parts.push(`[Column: ${pgErr.column}]`);
    if (pgErr.constraint) parts.push(`[Constraint: ${pgErr.constraint}]`);
    if (pgErr.detail) parts.push(`[Detail: ${pgErr.detail}]`);
    return parts.join(" ");
  }
  return String(err);
}

const SELF_LOGGING_JOBS = new Set(["SendReminderEmail", "WelcomeSeries"]);

async function insertRunningLog(
  jobName: string,
  startTime: Date,
): Promise<number | null> {
  try {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO scheduler_logs (start_time, job_name, status)
       VALUES ($1, $2, 'Running') RETURNING id`,
      [startTime, jobName],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error(
      `[SCHEDULER] Failed to insert running log for ${jobName}:`,
      err,
    );
    return null;
  }
}

async function finalizeLog(
  logId: number,
  status: "Success" | "Failed",
  errorMessage: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    const metadataValue =
      metadata && Object.keys(metadata).length > 0 ? metadata : null;
    await pool.query(
      `UPDATE scheduler_logs
         SET end_time = $1, status = $2, error_message = $3, metadata = $4
       WHERE id = $5`,
      [new Date(), status, errorMessage, metadataValue, logId],
    );
  } catch (err) {
    console.error(
      `[SCHEDULER] Failed to finalize scheduler_logs row ${logId}:`,
      err,
    );
  }
}

interface SchedulerConfigRow {
  job_name: string;
  hour: number;
  minute: number;
  timezone: string;
  is_enabled: boolean;
}

async function loadConfigsFromDb(): Promise<SchedulerConfigRow[]> {
  try {
    const result = await pool.query(
      `SELECT job_name, hour, minute, timezone, COALESCE(is_enabled, true) AS is_enabled FROM scheduler_configurations ORDER BY id`
    );
    return result.rows;
  } catch {
    return [];
  }
}

function getDefaultConfigs(): SchedulerConfigRow[] {
  return [
    { job_name: "SendReminderEmail", hour: 8, minute: 0, timezone: "America/New_York", is_enabled: true },
    { job_name: "DeleteArchivedUsers", hour: 2, minute: 0, timezone: "America/New_York", is_enabled: true },
    { job_name: "DeleteTestUsers", hour: 18, minute: 0, timezone: "Asia/Kolkata", is_enabled: true },
    { job_name: "WelcomeSeries", hour: 9, minute: 0, timezone: "America/New_York", is_enabled: true },
    { job_name: "WeeklyKenStats", hour: 12, minute: 0, timezone: "America/Los_Angeles", is_enabled: true },
    { job_name: "CampaignUpdateNotifications", hour: 6, minute: 0, timezone: "America/New_York", is_enabled: true },
    { job_name: "ExpireMatchGrants", hour: 1, minute: 0, timezone: "America/New_York", is_enabled: true },
    { job_name: "BackupDatabase", hour: 3, minute: 30, timezone: "America/New_York", is_enabled: true },
  ];
}

function scheduleJob(config: SchedulerConfigRow): void {
  const { job_name, hour, minute, timezone, is_enabled } = config;
  const runner = JOB_RUNNERS[job_name];
  const lockKey = LOCK_KEYS[job_name];

  if (!runner || lockKey == null) {
    console.log(`[SCHEDULER] Unknown job: ${job_name}, skipping.`);
    return;
  }

  if (!is_enabled) {
    console.log(
      `  - ${job_name}: DISABLED (skipping cron registration)`
    );
    return;
  }

  const dayOfWeek = WEEKLY_JOBS[job_name];
  const cronExpression =
    dayOfWeek !== undefined
      ? `${minute} ${hour} * * ${dayOfWeek}`
      : `${minute} ${hour} * * *`;

  const task = cron.schedule(
    cronExpression,
    async () => {
      console.log(`[SCHEDULER] Running ${job_name} job...`);
      await withAdvisoryLock(lockKey, job_name, async () => {
        const startTime = new Date();
        let runningLogId: number | null = null;
        if (!SELF_LOGGING_JOBS.has(job_name)) {
          runningLogId = await insertRunningLog(job_name, startTime);
        }
        try {
          const result = await runner();
          console.log(`[SCHEDULER] ${job_name} completed successfully.`);
          if (runningLogId !== null) {
            await finalizeLog(
              runningLogId,
              "Success",
              null,
              (result && typeof result === "object" ? result : null) as
                | Record<string, unknown>
                | null,
            );
          }
        } catch (err: unknown) {
          const message = extractSchedulerErrorMessage(err);
          console.error(`[SCHEDULER] ${job_name} failed:`, err);
          if (runningLogId !== null) {
            await finalizeLog(runningLogId, "Failed", message, null);
          }
        }
      });
    },
    { timezone }
  );

  activeTasks.push(task);
  if (dayOfWeek !== undefined) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(
      `  - ${job_name}: weekly on ${dayNames[dayOfWeek] || `day ${dayOfWeek}`} at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${timezone})`
    );
  } else {
    console.log(
      `  - ${job_name}: daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${timezone})`
    );
  }
}

export async function executeJobInBackground(
  jobName: string,
): Promise<{
  started: boolean;
  alreadyRunning: boolean;
  startTime: Date;
  runningLogId: number | null;
}> {
  const runner = JOB_RUNNERS[jobName];
  const lockKey = LOCK_KEYS[jobName];

  if (!runner || lockKey == null) {
    throw new Error(`Unknown job: ${jobName}`);
  }

  const startTime = new Date();
  console.log(`[SCHEDULER] Manually triggering ${jobName} job...`);

  const client = await pool.connect();
  let acquired = false;
  try {
    const lockResult = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockKey],
    );
    acquired = !!lockResult.rows[0].acquired;
  } catch (err) {
    client.release();
    throw err;
  }

  if (!acquired) {
    client.release();
    console.log(
      `[SCHEDULER] ${jobName} already running (advisory lock not acquired). Skipping manual trigger.`,
    );
    return {
      started: false,
      alreadyRunning: true,
      startTime,
      runningLogId: null,
    };
  }

  let runningLogId: number | null = null;
  if (!SELF_LOGGING_JOBS.has(jobName)) {
    runningLogId = await insertRunningLog(jobName, startTime);
  }

  // Fire-and-forget: run the job asynchronously and release the lock when done.
  (async () => {
    try {
      const result = await runner();
      console.log(`[SCHEDULER] ${jobName} completed successfully.`);
      if (runningLogId !== null) {
        await finalizeLog(
          runningLogId,
          "Success",
          null,
          (result && typeof result === "object" ? result : null) as
            | Record<string, unknown>
            | null,
        );
      }
    } catch (err: unknown) {
      const message = extractSchedulerErrorMessage(err);
      console.error(`[SCHEDULER] ${jobName} failed:`, err);
      if (runningLogId !== null) {
        await finalizeLog(runningLogId, "Failed", message, null);
      }
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
      } catch (e) {
        console.error(
          `[SCHEDULER] Failed to release advisory lock for ${jobName}:`,
          e,
        );
      } finally {
        client.release();
      }
    }
  })();

  return { started: true, alreadyRunning: false, startTime, runningLogId };
}

// Max duration a job may stay in "Running" before it is treated as stuck and
// force-failed even if an advisory lock is still held. Backups and welcome
// series can take a while, so allow a generous window.
const MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// How often the periodic sweep wakes up to look for orphaned Running rows.
const ORPHAN_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let orphanSweepTimer: NodeJS.Timeout | null = null;

export async function reconcileOrphanedRunningLogs(
  context: "startup" | "sweep" = "startup",
): Promise<number> {
  let orphanRows: Array<{ id: number; job_name: string; start_time: Date }> = [];
  try {
    const result = await pool.query<{
      id: number;
      job_name: string;
      start_time: Date;
    }>(
      `SELECT id, job_name, start_time FROM scheduler_logs
        WHERE status = 'Running' AND end_time IS NULL
        ORDER BY id`,
    );
    orphanRows = result.rows;
  } catch (err) {
    console.error(
      "[SCHEDULER] Failed to query for orphaned Running logs:",
      err,
    );
    return 0;
  }

  if (orphanRows.length === 0) {
    return 0;
  }

  const now = Date.now();
  let reconciled = 0;
  for (const row of orphanRows) {
    const ageMs = row.start_time
      ? now - new Date(row.start_time).getTime()
      : Number.POSITIVE_INFINITY;
    const exceededMaxDuration = ageMs >= MAX_RUN_DURATION_MS;
    const lockKey = LOCK_KEYS[row.job_name];

    if (lockKey == null) {
      try {
        await pool.query(
          `UPDATE scheduler_logs
              SET end_time = NOW(),
                  status = 'Failed',
                  error_message = 'Auto-cancelled stuck scheduler run: unknown job (no advisory lock key registered).'
            WHERE id = $1 AND status = 'Running' AND end_time IS NULL`,
          [row.id],
        );
        reconciled += 1;
      } catch (err) {
        console.error(
          `[SCHEDULER] Failed to reconcile orphan log ${row.id}:`,
          err,
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      const lockResult = await client.query(
        `SELECT pg_try_advisory_lock($1) AS acquired`,
        [lockKey],
      );
      const acquired = !!lockResult.rows[0]?.acquired;

      if (!acquired) {
        // Lock still held by an active session. Only force-fail the row if it
        // has clearly exceeded the maximum allowed duration.
        if (!exceededMaxDuration) {
          continue;
        }

        // Terminate the backend(s) holding the advisory lock so the lock is
        // released and the Run Now button actually becomes available again.
        // Without this, marking the row Failed would leave the job appearing
        // not-running while manual triggers still report "alreadyRunning".
        let terminatedAny = false;
        try {
          const holders = await client.query<{ pid: number }>(
            `SELECT l.pid
               FROM pg_locks l
              WHERE l.locktype = 'advisory'
                AND ((l.classid::bigint << 32) | (l.objid::bigint & x'FFFFFFFF'::bigint))
                    = $1::bigint
                AND l.granted = true`,
            [lockKey],
          );
          for (const holder of holders.rows) {
            try {
              const term = await client.query<{ terminated: boolean }>(
                `SELECT pg_terminate_backend($1) AS terminated`,
                [holder.pid],
              );
              if (term.rows[0]?.terminated) {
                terminatedAny = true;
                console.warn(
                  `[SCHEDULER] Terminated stuck backend pid=${holder.pid} holding lock for ${row.job_name}.`,
                );
              }
            } catch (termErr) {
              console.error(
                `[SCHEDULER] Failed to terminate backend pid=${holder.pid} for ${row.job_name}:`,
                termErr,
              );
            }
          }
        } catch (err) {
          console.error(
            `[SCHEDULER] Failed to look up advisory lock holders for ${row.job_name}:`,
            err,
          );
        }

        // Re-check that the lock is now free before declaring the row Failed.
        // If termination didn't release it (e.g. insufficient privilege), keep
        // the row in Running so we don't desync with the actual lock state.
        let lockNowFree = false;
        try {
          const recheck = await client.query(
            `SELECT pg_try_advisory_lock($1) AS acquired`,
            [lockKey],
          );
          lockNowFree = !!recheck.rows[0]?.acquired;
          if (lockNowFree) {
            await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
          }
        } catch (err) {
          console.error(
            `[SCHEDULER] Failed to re-check advisory lock for ${row.job_name}:`,
            err,
          );
        }

        if (!lockNowFree) {
          console.warn(
            `[SCHEDULER] Stuck Running row ${row.id} for ${row.job_name} exceeded max duration but advisory lock could not be released; leaving row as Running (terminatedBackend=${terminatedAny}).`,
          );
          continue;
        }

        try {
          const updateResult = await pool.query(
            `UPDATE scheduler_logs
                SET end_time = NOW(),
                    status = 'Failed',
                    error_message = $2
              WHERE id = $1 AND status = 'Running' AND end_time IS NULL`,
            [
              row.id,
              `Auto-cancelled stuck scheduler run: job ran for over ${Math.round(
                MAX_RUN_DURATION_MS / 60000,
              )} minutes without completing; the stuck backend was terminated to free the advisory lock.`,
            ],
          );
          if ((updateResult.rowCount ?? 0) > 0) {
            reconciled += 1;
            console.warn(
              `[SCHEDULER] Force-failed stuck Running row ${row.id} for ${row.job_name} (age ${Math.round(ageMs / 1000)}s).`,
            );
          }
        } catch (err) {
          console.error(
            `[SCHEDULER] Failed to force-fail stuck log ${row.id} for ${row.job_name}:`,
            err,
          );
        }
        continue;
      }

      // Lock acquired => no live process owns this row; treat as orphaned.
      try {
        const reason =
          context === "sweep"
            ? "Auto-cancelled stuck scheduler run: no live process holds the advisory lock (server likely crashed mid-run)."
            : "Auto-cancelled stuck scheduler run: detected on server start (server likely restarted before completion).";
        const updateResult = await client.query(
          `UPDATE scheduler_logs
              SET end_time = NOW(),
                  status = 'Failed',
                  error_message = $2
            WHERE id = $1 AND status = 'Running' AND end_time IS NULL`,
          [row.id, reason],
        );
        if ((updateResult.rowCount ?? 0) > 0) {
          reconciled += 1;
        }
      } finally {
        await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
      }
    } catch (err) {
      console.error(
        `[SCHEDULER] Failed to reconcile orphan log ${row.id} for ${row.job_name}:`,
        err,
      );
    } finally {
      client.release();
    }
  }

  if (reconciled > 0) {
    console.log(
      `[SCHEDULER] Reconciled ${reconciled} orphaned Running scheduler_logs row(s) as Failed (${context}).`,
    );
  }
  return reconciled;
}

function startOrphanSweep(): void {
  if (orphanSweepTimer) return;
  orphanSweepTimer = setInterval(() => {
    reconcileOrphanedRunningLogs("sweep").catch((err) => {
      console.error("[SCHEDULER] Orphan sweep failed:", err);
    });
  }, ORPHAN_SWEEP_INTERVAL_MS);
  if (typeof orphanSweepTimer.unref === "function") {
    orphanSweepTimer.unref();
  }
}

function stopOrphanSweep(): void {
  if (orphanSweepTimer) {
    clearInterval(orphanSweepTimer);
    orphanSweepTimer = null;
  }
}

function stopAllTasks(): void {
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
}

export async function reloadScheduler(): Promise<void> {
  console.log("[SCHEDULER] Reloading scheduler configurations...");
  stopAllTasks();

  await reconcileOrphanedRunningLogs("startup");
  startOrphanSweep();

  let configs = await loadConfigsFromDb();
  if (configs.length === 0) {
    console.log("[SCHEDULER] No DB configs found, using defaults.");
    configs = getDefaultConfigs();
  }

  console.log("[SCHEDULER] Jobs registered:");
  for (const config of configs) {
    scheduleJob(config);
  }
}

export function initScheduler(): void {
  console.log("[SCHEDULER] Initializing scheduled jobs...");
  reloadScheduler().catch((err) => {
    console.error("[SCHEDULER] Failed to initialize from DB, using hardcoded defaults:", err);
    stopAllTasks();
    const defaults = getDefaultConfigs();
    console.log("[SCHEDULER] Jobs registered (defaults):");
    for (const config of defaults) {
      scheduleJob(config);
    }
  });
}
