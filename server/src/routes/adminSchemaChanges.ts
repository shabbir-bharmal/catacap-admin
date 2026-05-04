import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import {
  applySchemaChange,
  type SchemaChangePayload,
} from "../utils/schemaChange.js";

const router = Router();

const ALLOWED_STATUSES = new Set(["applied", "rolled_back", "failed"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS = `
    id,
    operation_type   AS "operationType",
    table_name       AS "tableName",
    column_name      AS "columnName",
    old_definition   AS "oldDefinition",
    new_definition   AS "newDefinition",
    executed_sql     AS "executedSql",
    rollback_sql     AS "rollbackSql",
    triggered_by     AS "triggeredBy",
    prompt_reference AS "promptReference",
    status,
    created_at       AS "createdAt",
    rolled_back_at   AS "rolledBackAt",
    rolled_back_by   AS "rolledBackBy"
`;

router.get("/", async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const table = typeof req.query.table === "string" ? req.query.table : undefined;
    const operation = typeof req.query.operation === "string" ? req.query.operation : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
    const limitRaw = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    if (status && !ALLOWED_STATUSES.has(status)) {
      res.status(400).json({ error: `invalid status; allowed: ${[...ALLOWED_STATUSES].join(", ")}` });
      return;
    }
    if (dateFrom && Number.isNaN(Date.parse(dateFrom))) {
      res.status(400).json({ error: "invalid dateFrom (expected ISO timestamp)" });
      return;
    }
    if (dateTo && Number.isNaN(Date.parse(dateTo))) {
      res.status(400).json({ error: "invalid dateTo (expected ISO timestamp)" });
      return;
    }

    const conds: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    if (table) {
      params.push(table);
      conds.push(`table_name = $${params.length}`);
    }
    if (operation) {
      params.push(operation.toUpperCase());
      conds.push(`upper(operation_type) = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conds.push(`created_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conds.push(`created_at <= $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const totalResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.schema_change_logs ${where}`,
      params,
    );
    const total = Number.parseInt(totalResult.rows[0]?.count ?? "0", 10) || 0;

    params.push(limit);
    const limitParamIdx = params.length;
    params.push(offset);
    const offsetParamIdx = params.length;

    const itemsResult = await pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM public.schema_change_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params,
    );

    res.json({
      items: itemsResult.rows,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[schema-changes] list failed:", err);
    res.status(500).json({ error: "Failed to list schema changes", message: (err as Error).message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid UUID in :id" });
      return;
    }
    const result = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM public.schema_change_logs WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Schema change not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[schema-changes] get failed:", err);
    res.status(500).json({ error: "Failed to fetch schema change", message: (err as Error).message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const payload = req.body as SchemaChangePayload;
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "JSON body required" });
      return;
    }
    if (!payload.prompt_reference) {
      res.status(400).json({
        error: "prompt_reference is required for traceability (short summary of the user request)",
      });
      return;
    }
    const result = await applySchemaChange(payload);
    res.json(result);
  } catch (err) {
    console.error("[schema-changes] apply failed:", err);
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post("/rollback/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid UUID in :id" });
    return;
  }
  const confirm = (req.body && (req.body as { confirm?: boolean }).confirm) === true;
  if (!confirm) {
    res.status(400).json({
      error: "Rollback requires { \"confirm\": true } in the request body (rollback is itself destructive)",
    });
    return;
  }

  const adminEmail =
    (req.user && (req.user as { email?: string; name?: string }).email) ||
    (req.user && (req.user as { name?: string }).name) ||
    "unknown_admin";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lookup = await client.query<{
      id: string;
      operation_type: string;
      table_name: string;
      rollback_sql: string | null;
      status: string;
    }>(
      `SELECT id, operation_type, table_name, rollback_sql, status
       FROM public.schema_change_logs
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (lookup.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Schema change not found" });
      return;
    }
    const row = lookup.rows[0];
    if (row.status !== "applied") {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: `Cannot roll back: change is already in status '${row.status}'`,
      });
      return;
    }
    if (!row.rollback_sql || row.rollback_sql.trim().length === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error:
          "No rollback_sql available for this change. Provide rollback_sql in the original payload to enable rollback.",
      });
      return;
    }

    console.warn(
      `[schema-changes] ROLLBACK by ${adminEmail}: ${row.operation_type} on ${row.table_name} (change_id=${row.id})`,
    );

    await client.query(row.rollback_sql);

    await client.query(
      `UPDATE public.schema_change_logs
       SET status = 'rolled_back',
           rolled_back_at = now(),
           rolled_back_by = $2
       WHERE id = $1`,
      [id, adminEmail],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      change_id: id,
      status: "rolled_back",
      rolled_back_by: adminEmail,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    console.error("[schema-changes] rollback failed:", err);
    res.status(500).json({
      success: false,
      change_id: id,
      error: "Rollback failed",
      message: (err as Error).message,
    });
  } finally {
    client.release();
  }
});

export default router;
