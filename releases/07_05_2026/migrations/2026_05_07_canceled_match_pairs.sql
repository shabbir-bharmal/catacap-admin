-- Migration: canceled_match_pairs tombstone table
-- Date: 2026-05-07
--
-- Purpose:
--   Support the new "Cancel match" admin action on /matching. When an
--   admin cancels a single match, the corresponding
--   campaign_match_grant_activity row is hard-deleted and the donor's
--   recommendation is soft-deleted. Without a tombstone, the next
--   retroactive sweep (and the pending-match projection for that grant)
--   would observe the trigger as "uncovered" and re-match it,
--   resurrecting the cancellation.
--
--   This table records each canceled pair so that:
--     * runRetroactiveSweep excludes triggers whose pair is tombstoned
--       for that grant.
--     * projectPendingMatchesForGrant suppresses canceled triggers from
--       the per-grant pending list.
--     * The cancel endpoint becomes idempotent: a re-submitted cancel
--       hits the tombstone and returns success/no-op instead of 404.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, INSERT ON CONFLICT.
-- Transactional: BEGIN/COMMIT.

BEGIN;

CREATE TABLE IF NOT EXISTS canceled_match_pairs (
    id                              SERIAL PRIMARY KEY,
    match_grant_id                  INTEGER NOT NULL,
    triggered_by_recommendation_id  INTEGER,
    donor_recommendation_id         INTEGER,
    campaign_id                     INTEGER,
    amount                          NUMERIC(14, 2) NOT NULL DEFAULT 0,
    canceled_by                     TEXT,
    canceled_at                     TIMESTAMP NOT NULL DEFAULT NOW(),
    note                            TEXT
);

-- Per-grant uniqueness for tombstone lookups in retroactive sweep and
-- the pending projection. Partial unique index because anonymous
-- (no triggering recommendation) backfill rows have NULL trigger ids
-- and we don't want a single NULL slot to block multiple anonymous
-- cancellations on the same grant.
CREATE UNIQUE INDEX IF NOT EXISTS canceled_match_pairs_grant_trigger_uq
    ON canceled_match_pairs (match_grant_id, triggered_by_recommendation_id)
    WHERE triggered_by_recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS canceled_match_pairs_grant_idx
    ON canceled_match_pairs (match_grant_id);

CREATE INDEX IF NOT EXISTS canceled_match_pairs_donor_rec_idx
    ON canceled_match_pairs (donor_recommendation_id)
    WHERE donor_recommendation_id IS NOT NULL;

COMMIT;

-- ------------------------------------------------------------------ --
-- Rollback
-- ------------------------------------------------------------------ --
-- BEGIN;
-- DROP TABLE IF EXISTS canceled_match_pairs;
-- COMMIT;
