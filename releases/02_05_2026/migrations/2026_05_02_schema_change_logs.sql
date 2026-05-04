-- Migration: schema_change_logs + apply_schema_change()
-- Date: 2026-05-02
-- Purpose:
--   Introduce a runtime audit + rollback layer for DDL.
--   Every schema change applied via apply_schema_change(jsonb) is:
--     1. wrapped in a transaction (the function call itself),
--     2. captured before/after from information_schema,
--     3. logged into public.schema_change_logs with auto-derived rollback SQL,
--     4. gated against destructive ops (DROP*) unless force_destructive=true.
--
--   This sits ALONGSIDE the existing file-based migration policy (release
--   folders + docs.txt remain the source of truth). It does NOT replace it.
--   It exists so any out-of-band or AI-prompt-driven schema change is
--   reproducible and reversible at runtime.
--
--   Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--   Wrapped in BEGIN/COMMIT.
--
--   Rollback:
--     DROP FUNCTION IF EXISTS public.apply_schema_change(jsonb);
--     DROP TABLE    IF EXISTS public.schema_change_logs;

BEGIN;

-- 1) Audit table -------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.schema_change_logs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type   text        NOT NULL,
    table_name       text        NOT NULL,
    column_name      text,
    old_definition   jsonb,
    new_definition   jsonb,
    executed_sql     text        NOT NULL,
    rollback_sql     text,
    triggered_by     text        NOT NULL DEFAULT 'ai_prompt',
    prompt_reference text,
    status           text        NOT NULL DEFAULT 'applied',
    created_at       timestamptz NOT NULL DEFAULT now(),
    rolled_back_at   timestamptz,
    rolled_back_by   text,
    CONSTRAINT schema_change_logs_status_chk
        CHECK (status IN ('applied', 'rolled_back', 'failed'))
);

CREATE INDEX IF NOT EXISTS schema_change_logs_created_at_idx
    ON public.schema_change_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS schema_change_logs_status_idx
    ON public.schema_change_logs (status);

CREATE INDEX IF NOT EXISTS schema_change_logs_table_name_idx
    ON public.schema_change_logs (table_name);

-- 2) apply_schema_change(jsonb) ---------------------------------------------
--
-- Payload shape (all fields except operation_type/executed_sql/table_name
-- are optional):
--
--   {
--     "operation_type":    "CREATE TABLE" | "ADD COLUMN" | "DROP COLUMN"
--                          | "ALTER COLUMN" | "DROP TABLE"
--                          | "CREATE INDEX" | "DROP INDEX" | "OTHER",
--     "table_name":        "events",
--     "column_name":       "show_on_home",   -- optional, for column-scoped ops
--     "executed_sql":      "ALTER TABLE events ADD COLUMN show_on_home boolean DEFAULT false;",
--     "rollback_sql":      "ALTER TABLE events DROP COLUMN show_on_home;",  -- optional, auto-derived if omitted
--     "triggered_by":      "ai_prompt" | "admin_ui" | "migration_file" ...   -- default 'ai_prompt'
--     "prompt_reference":  "Add show_on_home flag to events (user request 2026-05-02)",
--     "force_destructive": true   -- required for DROP*
--   }
--
-- Returns:
--   { "success": true, "change_id": "<uuid>",
--     "rollback_available": true|false, "warnings": [...] }

CREATE OR REPLACE FUNCTION public.apply_schema_change(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_id        uuid := gen_random_uuid();
    v_op        text;
    v_table     text;
    v_column    text;
    v_sql       text;
    v_rollback  text;
    v_trigger   text;
    v_ref       text;
    v_force     boolean;
    v_old_def   jsonb;
    v_new_def   jsonb;
    v_warnings  jsonb := '[]'::jsonb;
BEGIN
    IF payload IS NULL THEN
        RAISE EXCEPTION 'apply_schema_change: payload is required';
    END IF;

    v_op       := upper(NULLIF(trim(payload->>'operation_type'), ''));
    v_table    := NULLIF(trim(payload->>'table_name'), '');
    v_column   := NULLIF(trim(payload->>'column_name'), '');
    v_sql      := payload->>'executed_sql';
    v_rollback := NULLIF(trim(payload->>'rollback_sql'), '');
    v_trigger  := COALESCE(NULLIF(trim(payload->>'triggered_by'), ''), 'ai_prompt');
    v_ref      := NULLIF(trim(payload->>'prompt_reference'), '');
    v_force    := COALESCE((payload->>'force_destructive')::boolean, false);

    -- Required fields ------------------------------------------------------
    IF v_op IS NULL THEN
        RAISE EXCEPTION 'apply_schema_change: operation_type is required';
    END IF;
    IF v_sql IS NULL OR length(trim(v_sql)) = 0 THEN
        RAISE EXCEPTION 'apply_schema_change: executed_sql is required';
    END IF;
    IF v_table IS NULL THEN
        RAISE EXCEPTION 'apply_schema_change: table_name is required';
    END IF;

    -- Destructive op gate --------------------------------------------------
    -- Catches: any explicit DROP * op, plus a regex sniff of the raw SQL
    -- looking for DROP / TRUNCATE / RENAME at a word boundary. The regex
    -- is a coarse safety net (it can also match comments / string
    -- literals containing those words, which is acceptable — false
    -- positives are recoverable by setting force_destructive=true and
    -- re-running). False NEGATIVES are the real risk; callers should
    -- still set operation_type and force_destructive correctly.
    IF v_op IN ('DROP TABLE','DROP COLUMN','DROP INDEX','DROP CONSTRAINT','TRUNCATE','RENAME')
       OR v_op LIKE 'DROP %'
       OR v_sql ~* '\m(drop\s+(table|column|index|constraint|view|schema|function|trigger))\M'
       OR v_sql ~* '\m(truncate)\s+(table\s+)?[A-Za-z_]'
       OR v_sql ~* '\malter\s+table\s+[^;]+\s+rename\M'
       OR v_sql ~* '\malter\s+table\s+[^;]+\s+drop\s+default\M'
    THEN
        IF NOT v_force THEN
            RAISE EXCEPTION 'apply_schema_change: destructive operation (%) on % requires force_destructive=true in payload',
                v_op, v_table;
        END IF;
        v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object(
                'level',   'warning',
                'message', format('Destructive operation %s applied to %s', v_op, v_table)
            )
        );
        RAISE WARNING 'apply_schema_change: destructive % on % (change_id=%)', v_op, v_table, v_id;
    END IF;

    -- Capture before-state -------------------------------------------------
    -- Snapshot information_schema.columns AND pg_catalog.format_type so we
    -- preserve precise column types (varchar(50), numeric(10,2), int4[],
    -- USER-DEFINED enums, ...) that information_schema alone loses.
    -- NOTE: schema is hardcoded to 'public'. Non-public schemas are not
    -- supported — old_definition / new_definition will be NULL.
    IF v_column IS NOT NULL THEN
        SELECT to_jsonb(c) || jsonb_build_object(
                 'pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod)
               )
          INTO v_old_def
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class     cl ON cl.relname = c.table_name AND cl.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a  ON a.attrelid = cl.oid AND a.attname = c.column_name AND NOT a.attisdropped
        WHERE c.table_schema = 'public'
          AND c.table_name   = v_table
          AND c.column_name  = v_column;
    ELSE
        SELECT jsonb_agg(
                 to_jsonb(c) || jsonb_build_object(
                   'pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod)
                 )
                 ORDER BY c.ordinal_position
               )
          INTO v_old_def
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class     cl ON cl.relname = c.table_name AND cl.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a  ON a.attrelid = cl.oid AND a.attname = c.column_name AND NOT a.attisdropped
        WHERE c.table_schema = 'public'
          AND c.table_name   = v_table;
    END IF;

    -- Auto-derive rollback if not provided ---------------------------------
    IF v_rollback IS NULL THEN
        IF v_op = 'CREATE TABLE' THEN
            v_rollback := format('DROP TABLE IF EXISTS %I.%I CASCADE;', 'public', v_table);

        ELSIF v_op = 'ADD COLUMN' AND v_column IS NOT NULL THEN
            v_rollback := format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I;',
                                 'public', v_table, v_column);

        ELSIF v_op = 'DROP COLUMN' AND v_column IS NOT NULL AND v_old_def IS NOT NULL THEN
            -- Use pg_type_def (from pg_catalog.format_type) so types like
            -- varchar(50), numeric(10,2), int4[], or enum types round-trip
            -- correctly. Falls back to data_type only if the join missed.
            v_rollback := format(
                'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I %s%s%s;',
                'public', v_table, v_column,
                COALESCE(v_old_def->>'pg_type_def', v_old_def->>'data_type', 'text'),
                CASE WHEN (v_old_def->>'is_nullable') = 'NO' THEN ' NOT NULL' ELSE '' END,
                CASE WHEN v_old_def->>'column_default' IS NOT NULL
                     THEN ' DEFAULT ' || (v_old_def->>'column_default')
                     ELSE '' END
            );

        ELSIF v_op = 'ALTER COLUMN' AND v_column IS NOT NULL AND v_old_def IS NOT NULL THEN
            v_rollback := format(
                'ALTER TABLE %I.%I ALTER COLUMN %I TYPE %s%s%s;',
                'public', v_table, v_column,
                COALESCE(v_old_def->>'pg_type_def', v_old_def->>'data_type', 'text'),
                CASE WHEN (v_old_def->>'is_nullable') = 'NO'
                     THEN format(', ALTER COLUMN %I SET NOT NULL', v_column)
                     ELSE format(', ALTER COLUMN %I DROP NOT NULL', v_column) END,
                CASE WHEN v_old_def->>'column_default' IS NOT NULL
                     THEN format(', ALTER COLUMN %I SET DEFAULT %s', v_column, v_old_def->>'column_default')
                     ELSE format(', ALTER COLUMN %I DROP DEFAULT', v_column) END
            );

        ELSIF v_op IN ('DROP TABLE','DROP INDEX') THEN
            -- Rollback for full DROP cannot be safely auto-derived.
            v_rollback := NULL;
            v_warnings := v_warnings || jsonb_build_array(
                jsonb_build_object(
                    'level',   'warning',
                    'message', format('No automatic rollback available for %s. Provide rollback_sql in payload to enable rollback.', v_op)
                )
            );
        END IF;
    END IF;

    -- Execute target SQL ---------------------------------------------------
    -- If this raises, the entire function call (and the txn it runs in) is
    -- rolled back, so no log row is written.
    EXECUTE v_sql;

    -- Capture after-state --------------------------------------------------
    IF v_column IS NOT NULL THEN
        SELECT to_jsonb(c) || jsonb_build_object(
                 'pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod)
               )
          INTO v_new_def
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class     cl ON cl.relname = c.table_name AND cl.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a  ON a.attrelid = cl.oid AND a.attname = c.column_name AND NOT a.attisdropped
        WHERE c.table_schema = 'public'
          AND c.table_name   = v_table
          AND c.column_name  = v_column;
    ELSE
        SELECT jsonb_agg(
                 to_jsonb(c) || jsonb_build_object(
                   'pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod)
                 )
                 ORDER BY c.ordinal_position
               )
          INTO v_new_def
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class     cl ON cl.relname = c.table_name AND cl.relnamespace = n.oid
        JOIN pg_catalog.pg_attribute a  ON a.attrelid = cl.oid AND a.attname = c.column_name AND NOT a.attisdropped
        WHERE c.table_schema = 'public'
          AND c.table_name   = v_table;
    END IF;

    -- Log ------------------------------------------------------------------
    -- If the INSERT below fails, the EXECUTE above is also rolled back
    -- (single-transaction guarantee).
    INSERT INTO public.schema_change_logs(
        id, operation_type, table_name, column_name,
        old_definition, new_definition, executed_sql, rollback_sql,
        triggered_by, prompt_reference, status
    ) VALUES (
        v_id, v_op, v_table, v_column,
        v_old_def, v_new_def, v_sql, v_rollback,
        v_trigger, v_ref, 'applied'
    );

    RETURN jsonb_build_object(
        'success',            true,
        'change_id',          v_id,
        'rollback_available', v_rollback IS NOT NULL AND length(trim(v_rollback)) > 0,
        'warnings',           v_warnings
    );
END;
$function$;

COMMIT;
