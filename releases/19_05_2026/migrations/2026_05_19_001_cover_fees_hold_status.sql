-- 2026_05_19_001_cover_fees_hold_status.sql
--
-- Adds hold-on-create support to the Cover Fees escrow pool.
--
-- Schema:
--   * status                              TEXT NOT NULL DEFAULT 'applied'
--       Lifecycle of a cover-fees activity row:
--           'held'    — escrow reserved against a Pending grant / asset
--                       request; pool.amount_used is NOT yet incremented.
--           'applied' — fee has actually been drawn from the pool (or the
--                       sponsor's live wallet); pool.amount_used was
--                       incremented and a paired account_balance_change_log
--                       row was written.
--   * triggered_by_pending_grant_id              FK to pending_grants(id)
--   * triggered_by_asset_based_payment_request_id FK to asset_based_payment_requests(id)
--       The FKs identify the source request even before a recommendation
--       exists. For Other Assets the rec is created at Received, AFTER the
--       hold is placed (at create) and converted (at In Transit) — so the
--       activity row carries the request FK throughout and the rec link is
--       backfilled when Received fires.
--
-- Idempotency:
--   Per pool, at most one ACTIVE (non-fully-reversed) activity row may
--   exist for a given pending_grant OR asset_based_payment_request.
--   Partial unique indexes enforce this without preventing a fresh hold
--   from being placed after a prior row was fully reversed.
--
-- Rollback:
--   ALTER TABLE campaign_cover_fees_activity
--     DROP CONSTRAINT IF EXISTS campaign_cover_fees_activity_pg_fkey,
--     DROP CONSTRAINT IF EXISTS campaign_cover_fees_activity_abpr_fkey,
--     DROP CONSTRAINT IF EXISTS campaign_cover_fees_activity_status_chk,
--     DROP COLUMN IF EXISTS triggered_by_pending_grant_id,
--     DROP COLUMN IF EXISTS triggered_by_asset_based_payment_request_id,
--     DROP COLUMN IF EXISTS status;
--   DROP INDEX IF EXISTS idx_ccfa_pool_pending_grant_uniq;
--   DROP INDEX IF EXISTS idx_ccfa_pool_asset_request_uniq;
--   DROP INDEX IF EXISTS idx_ccfa_held;

BEGIN;

ALTER TABLE campaign_cover_fees_activity
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied',
    ADD COLUMN IF NOT EXISTS triggered_by_pending_grant_id INTEGER,
    ADD COLUMN IF NOT EXISTS triggered_by_asset_based_payment_request_id INTEGER;

-- Backfill any pre-existing rows that landed before the default took
-- effect (defensive; default handles the live case).
UPDATE campaign_cover_fees_activity
   SET status = 'applied'
 WHERE status IS NULL
    OR status NOT IN ('held', 'applied');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema = 'public'
           AND table_name = 'campaign_cover_fees_activity'
           AND constraint_name = 'campaign_cover_fees_activity_status_chk'
    ) THEN
        ALTER TABLE campaign_cover_fees_activity
            ADD CONSTRAINT campaign_cover_fees_activity_status_chk
            CHECK (status IN ('held', 'applied'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema = 'public'
           AND table_name = 'campaign_cover_fees_activity'
           AND constraint_name = 'campaign_cover_fees_activity_pg_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees_activity
            ADD CONSTRAINT campaign_cover_fees_activity_pg_fkey
            FOREIGN KEY (triggered_by_pending_grant_id)
            REFERENCES pending_grants(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema = 'public'
           AND table_name = 'campaign_cover_fees_activity'
           AND constraint_name = 'campaign_cover_fees_activity_abpr_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees_activity
            ADD CONSTRAINT campaign_cover_fees_activity_abpr_fkey
            FOREIGN KEY (triggered_by_asset_based_payment_request_id)
            REFERENCES asset_based_payment_requests(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccfa_pool_pending_grant_uniq
    ON campaign_cover_fees_activity (cover_fee_id, triggered_by_pending_grant_id)
 WHERE triggered_by_pending_grant_id IS NOT NULL
   AND fully_reversed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ccfa_pool_asset_request_uniq
    ON campaign_cover_fees_activity (cover_fee_id, triggered_by_asset_based_payment_request_id)
 WHERE triggered_by_asset_based_payment_request_id IS NOT NULL
   AND fully_reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ccfa_held
    ON campaign_cover_fees_activity (cover_fee_id)
 WHERE status = 'held';

COMMIT;
