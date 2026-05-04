import pool from "../db.js";

export type SchemaOperationType =
  | "CREATE TABLE"
  | "ADD COLUMN"
  | "DROP COLUMN"
  | "ALTER COLUMN"
  | "DROP TABLE"
  | "CREATE INDEX"
  | "DROP INDEX"
  | "OTHER"
  | string;

export interface SchemaChangePayload {
  operation_type: SchemaOperationType;
  table_name: string;
  column_name?: string | null;
  executed_sql: string;
  rollback_sql?: string | null;
  triggered_by?: string;
  prompt_reference?: string | null;
  force_destructive?: boolean;
}

export interface SchemaChangeResult {
  success: boolean;
  change_id: string;
  rollback_available: boolean;
  warnings: Array<{ level: string; message: string }>;
}

export async function applySchemaChange(
  payload: SchemaChangePayload,
): Promise<SchemaChangeResult> {
  if (!payload || typeof payload !== "object") {
    throw new Error("applySchemaChange: payload object is required");
  }
  if (!payload.operation_type || !payload.table_name || !payload.executed_sql) {
    throw new Error(
      "applySchemaChange: operation_type, table_name and executed_sql are required",
    );
  }

  const { rows } = await pool.query<{ result: SchemaChangeResult }>(
    `SELECT public.apply_schema_change($1::jsonb) AS result`,
    [JSON.stringify(payload)],
  );
  return rows[0].result;
}
