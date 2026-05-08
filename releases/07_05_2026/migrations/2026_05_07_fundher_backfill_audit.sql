-- Migration: FundHer backfill audit table (records the exact activity rows
--            inserted by 2026_05_07_backfill_fundher_match_activity.sql so a
--            future rollback can target them deterministically)
-- Date: 2026-05-07
--
-- Purpose:
--   The companion backfill migration inserted 30 rows into
--   campaign_match_grant_activity for grant_id=2 (FundHer). A naive rollback
--   that identifies "backfilled rows" by matching activity.created_at against
--   the donor recommendation's date_created is unsafe: the live matching tool
--   in matchingGrants.ts inserts the donor recommendation and the activity
--   row in the same transaction using NOW() for both, so the timestamps can
--   coincide for legitimate live-tool rows too. Deleting on that marker risks
--   removing real production matches.
--
--   This migration creates a tiny audit table that records the exact
--   activity.id values inserted by the backfill (verified at write-time as the
--   30 highest activity ids for grant 2 immediately after the backfill ran:
--   ids 40..69 inclusive). Rollback can then target this set safely with no
--   ambiguity.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING.
-- Transactional: wrapped in BEGIN/COMMIT.

BEGIN;

CREATE TABLE IF NOT EXISTS fundher_backfill_audit (
    activity_id  INTEGER PRIMARY KEY,
    inserted_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    note         TEXT NOT NULL DEFAULT
                 'Inserted by 2026_05_07_backfill_fundher_match_activity.sql'
);

-- The 30 activity rows inserted by the backfill.
INSERT INTO fundher_backfill_audit (activity_id)
SELECT generate_series(40, 69)
ON CONFLICT (activity_id) DO NOTHING;

-- Sanity check: every audited id must (a) exist, (b) belong to grant 2,
-- (c) reference a FundHer-donor recommendation. If any fail, abort.
DO $$
DECLARE
    bad_count INT;
BEGIN
    SELECT COUNT(*) INTO bad_count
      FROM fundher_backfill_audit fba
      LEFT JOIN campaign_match_grant_activity a ON a.id = fba.activity_id
      LEFT JOIN recommendations r ON r.id = a.donor_recommendation_id
     WHERE a.id IS NULL
        OR a.match_grant_id <> 2
        OR r.user_id <> 'd3737961-7cf8-426c-8ba2-74196026f040';
    IF bad_count > 0 THEN
        RAISE EXCEPTION
          'fundher_backfill_audit sanity check failed: % audited row(s) do not match the expected backfill set',
          bad_count;
    END IF;
END $$;

COMMIT;

-- ------------------------------------------------------------------ --
-- Rollback (uncomment to drop the audit table)
-- ------------------------------------------------------------------ --
-- BEGIN;
-- DROP TABLE IF EXISTS fundher_backfill_audit;
-- COMMIT;
