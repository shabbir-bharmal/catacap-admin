-- Cover Fees: per-pool "coverage active from" cutoff.
-- A pool may only cover triggers (recommendations / pending grants /
-- other-asset payments) whose creation date is on or after this
-- timestamp. Defaults to NOW() so a freshly-created pool never claims
-- pre-existing pending donations as projected coverage.
--
-- For existing pools, DEFAULT NOW() at migration time means
-- pre-existing pending triggers are excluded automatically — matching
-- the product expectation that a sponsor only covers fees on
-- donations that arrive after they fund the pool. Sponsors who want
-- to cover earlier donations must do so explicitly (feature TBD).
BEGIN;

ALTER TABLE campaign_cover_fees
  ADD COLUMN IF NOT EXISTS coverage_active_from TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMIT;
