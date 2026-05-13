-- Cover Fees: refund reversal support
--
-- Adds bookkeeping columns to campaign_cover_fees_activity so we can track
-- partial / full reversals against the original covered fee, plus a dedicated
-- per-refund idempotency table that survives webhook retries even when no
-- donor / sponsor audit row gets written (e.g. zero-fee proportional refund).
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS or guarded DO blocks.
-- Wrapped in a transaction so the activity table can never be left in a
-- half-migrated state.
--
-- Rollback (uncomment to revert):
--   BEGIN;
--   DROP TABLE IF EXISTS cover_fees_refund_reversals;
--   DROP INDEX IF EXISTS idx_ccfa_unreversed;
--   DROP INDEX IF EXISTS idx_ccfa_payment_ref;
--   ALTER TABLE campaign_cover_fees_activity
--     DROP COLUMN IF EXISTS reversed_fee_amount,
--     DROP COLUMN IF EXISTS fully_reversed_at,
--     DROP COLUMN IF EXISTS last_reversed_reason,
--     DROP COLUMN IF EXISTS payment_ref;
--   COMMIT;

BEGIN;

-- ── 1. Reversal bookkeeping columns on the activity row ────────────────────
ALTER TABLE campaign_cover_fees_activity
    ADD COLUMN IF NOT EXISTS reversed_fee_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fully_reversed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_reversed_reason TEXT;

-- payment_ref lets the Stripe webhook locate the activity row that backs a
-- given charge (e.g. 'stripe_card_pi_xxx' / 'stripe_bank_pi_xxx'). Added
-- defensively here so the helper's lookup query never references a missing
-- column on environments that haven't been hand-patched.
ALTER TABLE campaign_cover_fees_activity
    ADD COLUMN IF NOT EXISTS payment_ref TEXT;

-- Partial index: most reversal lookups only care about activities that have
-- not been fully reversed yet. Keeps the index small on a busy table.
CREATE INDEX IF NOT EXISTS idx_ccfa_unreversed
    ON campaign_cover_fees_activity (cover_fee_id)
    WHERE fully_reversed_at IS NULL;

-- Stripe payment_intent IDs are globally unique, so we enforce that
-- payment_ref is also unique on the activity table. This guards against
-- the heuristic auto-derive (in applyCoverFees) ever binding two
-- activity rows to the same Stripe intent — a duplicate insert would
-- fail loudly rather than silently allowing a refund to reverse the
-- wrong donation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ccfa_payment_ref
    ON campaign_cover_fees_activity (payment_ref)
    WHERE payment_ref IS NOT NULL;

-- ── 2. Authoritative per-refund idempotency table ──────────────────────────
-- A separate table (rather than relying on audit-row uniqueness) so that
-- duplicate webhook deliveries are guaranteed no-ops even when the
-- proportional reversal calculates to $0 and no donor / sponsor audit row
-- ends up being written.
CREATE TABLE IF NOT EXISTS cover_fees_refund_reversals (
    id                       SERIAL PRIMARY KEY,
    activity_id              INTEGER NOT NULL,
    refund_idempotency_key   TEXT NOT NULL,
    refund_amount            NUMERIC(15,2) NOT NULL,
    fee_reversed_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    reason                   TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'cover_fees_refund_reversals'
          AND constraint_name = 'cover_fees_refund_reversals_activity_fkey'
    ) THEN
        ALTER TABLE cover_fees_refund_reversals
            ADD CONSTRAINT cover_fees_refund_reversals_activity_fkey
            FOREIGN KEY (activity_id)
            REFERENCES campaign_cover_fees_activity(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cover_fees_refund_reversals_uniq
    ON cover_fees_refund_reversals (activity_id, refund_idempotency_key);

CREATE INDEX IF NOT EXISTS idx_cfrr_activity
    ON cover_fees_refund_reversals (activity_id);

COMMIT;
