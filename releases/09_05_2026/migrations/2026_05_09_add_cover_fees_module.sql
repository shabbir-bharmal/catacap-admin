-- =====================================================================
-- Release: 09_05_2026
-- Migration: 2026_05_09_add_cover_fees_module.sql
--
-- Intent
--   Register the new admin page "Cover Fees" (route /cover-fees) in the
--   role-based access control system by inserting a row into public.modules
--   with name 'cover-fees'. Mirrors the db-schema-logs module registration
--   pattern from 02_05_2026.
--
-- Schema affected
--   public.modules                 -- one new row, no DDL
--
-- Idempotency
--   Wrapped in a transaction. The INSERT is guarded by a NOT EXISTS check
--   on name = 'cover-fees'. Re-running is a no-op once the row is present.
--
-- Rollback
--   DELETE FROM public.modules WHERE name = 'cover-fees';
-- =====================================================================

BEGIN;

INSERT INTO public.modules (name, category, sort_order, created_at)
SELECT 'cover-fees', 'site-config', 25, now()
WHERE NOT EXISTS (
    SELECT 1 FROM public.modules WHERE name = 'cover-fees'
);

COMMIT;
