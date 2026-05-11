-- Migration: canceled_cover_fees_pairs tombstone table
-- Date: 2026-05-09
--
-- Purpose:
--   Mirror of canceled_match_pairs for the cover-fees pool. When an admin
--   cancels a single covered-fee activity row, the activity is hard-deleted
--   and amount_used is decremented. Without a tombstone, the next
--   retroactive sweep / pending-fee projection would observe the trigger as
--   "uncovered" and re-cover it, resurrecting the cancellation.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.
-- Transactional: BEGIN/COMMIT.

BEGIN;

CREATE TABLE IF NOT EXISTS canceled_cover_fees_pairs (
    id                              SERIAL PRIMARY KEY,
    cover_fee_id                    INTEGER NOT NULL,
    triggered_by_recommendation_id  INTEGER,
    campaign_id                     INTEGER,
    fee_amount                      NUMERIC(14, 2) NOT NULL DEFAULT 0,
    canceled_by                     TEXT,
    canceled_at                     TIMESTAMP NOT NULL DEFAULT NOW(),
    note                            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS canceled_cover_fees_pairs_pool_trigger_uq
    ON canceled_cover_fees_pairs (cover_fee_id, triggered_by_recommendation_id)
    WHERE triggered_by_recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS canceled_cover_fees_pairs_pool_idx
    ON canceled_cover_fees_pairs (cover_fee_id);

COMMIT;

-- BEGIN;
-- DROP TABLE IF EXISTS canceled_cover_fees_pairs;
-- COMMIT;
