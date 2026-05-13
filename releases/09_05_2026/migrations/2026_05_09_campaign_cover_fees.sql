-- Migration: Campaign "Cover Fees" sponsor program
-- Date: 2026-05-09
-- Purpose:
--   Mirrors the Investment Matching feature (campaign_match_grants) but for
--   the CataCap 5% platform fee. A sponsor pre-funds an escrow pool; whenever
--   an eligible donation lands on a covered investment, FEE_RATE (5%) of the
--   donation is debited from the pool to "cover the fee" on behalf of the
--   donor. Per-investment fee cap is optional. Same escrow semantics, expiry
--   semantics, retroactive sweep, and cancel-with-tombstone semantics as
--   campaign_match_grants.
--
--   Type notes:
--     users.id           -> character varying(450)
--     campaigns.id       -> integer
--     recommendations.id -> integer
--
--   Tables created:
--     campaign_cover_fees             – Sponsor pool configuration
--     campaign_cover_fees_campaigns   – Which campaigns the pool covers
--     campaign_cover_fees_activity    – Log of every fee covered
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, guarded ALTER constraints.
-- Transactional: BEGIN/COMMIT.

BEGIN;

-- ------------------------------------------------------------------ --
-- 1. campaign_cover_fees  (one row = one sponsor's cover-fees pool)
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS campaign_cover_fees (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL DEFAULT '',
    sponsor_user_id     VARCHAR(450) NOT NULL,        -- references users(id)
    total_cap           NUMERIC(15,2) NULL,            -- NULL = unlimited
    amount_used         NUMERIC(15,2) NOT NULL DEFAULT 0,
    reserved_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    fee_rate            NUMERIC(6,4)  NOT NULL DEFAULT 0.0500, -- 5%
    per_investment_cap  NUMERIC(15,2) NULL,            -- max fee per donation (optional)
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT NULL,
    expires_at          TIMESTAMP NULL,
    retroactive_from    TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'campaign_cover_fees'
          AND constraint_name = 'campaign_cover_fees_sponsor_user_id_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees
            ADD CONSTRAINT campaign_cover_fees_sponsor_user_id_fkey
            FOREIGN KEY (sponsor_user_id) REFERENCES users(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ccf_sponsor_user
    ON campaign_cover_fees (sponsor_user_id);
CREATE INDEX IF NOT EXISTS idx_ccf_is_active
    ON campaign_cover_fees (is_active);

-- ------------------------------------------------------------------ --
-- 2. campaign_cover_fees_campaigns  (which campaigns this pool covers)
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS campaign_cover_fees_campaigns (
    id              SERIAL PRIMARY KEY,
    cover_fee_id    INTEGER NOT NULL,
    campaign_id     INTEGER NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'campaign_cover_fees_campaigns'
          AND constraint_name = 'campaign_cover_fees_campaigns_cfid_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees_campaigns
            ADD CONSTRAINT campaign_cover_fees_campaigns_cfid_fkey
            FOREIGN KEY (cover_fee_id) REFERENCES campaign_cover_fees(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'campaign_cover_fees_campaigns'
          AND constraint_name = 'campaign_cover_fees_campaigns_cid_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees_campaigns
            ADD CONSTRAINT campaign_cover_fees_campaigns_cid_fkey
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'campaign_cover_fees_campaigns'
          AND constraint_name = 'campaign_cover_fees_campaigns_unique'
    ) THEN
        ALTER TABLE campaign_cover_fees_campaigns
            ADD CONSTRAINT campaign_cover_fees_campaigns_unique
            UNIQUE (cover_fee_id, campaign_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ccfc_pool
    ON campaign_cover_fees_campaigns (cover_fee_id);
CREATE INDEX IF NOT EXISTS idx_ccfc_campaign
    ON campaign_cover_fees_campaigns (campaign_id);

-- ------------------------------------------------------------------ --
-- 3. campaign_cover_fees_activity  (one row = one covered fee)
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS campaign_cover_fees_activity (
    id                              SERIAL PRIMARY KEY,
    cover_fee_id                    INTEGER NOT NULL,
    campaign_id                     INTEGER NULL,
    triggered_by_user_id            VARCHAR(450) NULL,
    triggered_by_recommendation_id  INTEGER NULL,
    fee_amount                      NUMERIC(15,2) NOT NULL,
    donation_amount                 NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at                      TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'campaign_cover_fees_activity'
          AND constraint_name = 'campaign_cover_fees_activity_cfid_fkey'
    ) THEN
        ALTER TABLE campaign_cover_fees_activity
            ADD CONSTRAINT campaign_cover_fees_activity_cfid_fkey
            FOREIGN KEY (cover_fee_id) REFERENCES campaign_cover_fees(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Idempotency / dedup: same triggering recommendation cannot have its fee
-- covered twice by the same pool. Mirrors campaign_match_grant_activity_grant_rec_uniq.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_cover_fees_activity_pool_rec_uniq
    ON campaign_cover_fees_activity (cover_fee_id, triggered_by_recommendation_id)
    WHERE triggered_by_recommendation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ccfa_pool
    ON campaign_cover_fees_activity (cover_fee_id);
CREATE INDEX IF NOT EXISTS idx_ccfa_campaign
    ON campaign_cover_fees_activity (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ccfa_triggered_by
    ON campaign_cover_fees_activity (triggered_by_user_id);

COMMIT;

-- Rollback (uncomment to revert):
-- BEGIN;
-- DROP TABLE IF EXISTS campaign_cover_fees_activity;
-- DROP TABLE IF EXISTS campaign_cover_fees_campaigns;
-- DROP TABLE IF EXISTS campaign_cover_fees;
-- COMMIT;
