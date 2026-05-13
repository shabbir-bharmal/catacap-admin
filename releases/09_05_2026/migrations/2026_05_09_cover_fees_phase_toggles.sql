-- Cover Fees: per-pool toggles for which fee phases the pool covers.
-- cover_initial_fee   = the 5% fee on the initial donation (recommendations approval flow)
-- cover_lifecycle_fee = the 5% fee on later disbursements/payments tied to the
--                       investment over its lifetime (pending grants, other assets)
-- Both default TRUE so existing pools continue to behave as before.
BEGIN;

ALTER TABLE campaign_cover_fees
  ADD COLUMN IF NOT EXISTS cover_initial_fee   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cover_lifecycle_fee BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
