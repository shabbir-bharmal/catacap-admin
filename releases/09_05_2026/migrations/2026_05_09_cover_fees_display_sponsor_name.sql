-- Cover Fees: per-pool override for the sponsor name shown to investors.
--
-- The public investment page renders a banner like
--   "The CataCap fees for this investment have been generously
--    covered by <sponsor> so that 100% of your donation is invested."
-- where <sponsor> currently comes from the pool's sponsor user record
-- (first/last name, falling back to user_name). Some sponsors prefer
-- to be displayed under a different name (e.g. their fund's brand
-- name, an anonymized handle, or a co-sponsor credit). This column
-- holds that override.
--
-- Semantics: when display_sponsor_name is non-NULL and non-blank,
-- the public endpoint returns it as `sponsorName`. Otherwise the
-- existing fallback chain (full name → user_name → "Sponsor")
-- continues to apply. Admin-side displays (Excel export, activity
-- panel) intentionally still show the real sponsor name.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. NULL default preserves
-- existing pools' behaviour exactly.
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE campaign_cover_fees DROP COLUMN IF EXISTS display_sponsor_name;
--   COMMIT;
BEGIN;

ALTER TABLE campaign_cover_fees
  ADD COLUMN IF NOT EXISTS display_sponsor_name TEXT NULL;

COMMIT;
