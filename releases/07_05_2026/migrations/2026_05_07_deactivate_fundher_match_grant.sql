-- Migration: Deactivate the FundHer match grant (campaign_match_grants.id=2)
-- Date: 2026-05-07
--
-- Purpose:
--   Per Ken's request: turn off the FundHer matching grant so it no longer
--   participates in live matching. The grant is already effectively exhausted
--   (amount_used $37,600 > reserved_amount $31,400 after the historical
--   backfill applied earlier today), so this is a clean policy flip rather
--   than a budget change.
--
-- Why we do NOT route through the admin UI / PUT /api/admin/matching/:id:
--   The UI's deactivate path runs the reservation reconciliation logic in
--   adminMatching.ts (PUT handler). For a paused grant it sets
--     newCommitted = amount_used = $37,600
--     delta        = newCommitted - oldReserved = 37,600 - 31,400 = +$6,200
--   and would call reserveCapFromWallet() to lock another $6,200 from the
--   donor's wallet. With the donor's current account_balance of $0.00 that
--   call would actually fail on insufficient funds and block deactivation
--   outright; even if funds existed, the debit would be wrong because the
--   FundHer historical funds were already
--   debited manually outside the system (donor account_balance = $0.00 right
--   now), and the backfill explicitly avoided touching account_balance or
--   account_balance_change_logs to preserve that truth. Running the UI flow
--   would create a phantom $6,200 debit and a corresponding ledger entry.
--
-- What this migration does:
--   * Sets campaign_match_grants.is_active = FALSE for id = 2.
--   * Bumps updated_at to NOW().
--   * Leaves total_cap, reserved_amount, amount_used, donor_user_id, and the
--     donor's users.account_balance / account_balance_change_logs UNTOUCHED.
--
-- Idempotent: WHERE is_active = TRUE guards re-runs.
-- Transactional: BEGIN/COMMIT.

BEGIN;

UPDATE campaign_match_grants
   SET is_active  = FALSE,
       updated_at = NOW()
 WHERE id = 2
   AND is_active = TRUE;

-- Sanity check: grant must end up inactive and otherwise unchanged.
DO $$
DECLARE
    g RECORD;
BEGIN
    SELECT id, is_active, total_cap, reserved_amount, amount_used, donor_user_id
      INTO g
      FROM campaign_match_grants
     WHERE id = 2;
    IF g.id IS NULL THEN
        RAISE EXCEPTION 'campaign_match_grants id=2 (Fund Her) not found';
    END IF;
    IF g.is_active <> FALSE THEN
        RAISE EXCEPTION 'Fund Her grant did not end up inactive (is_active=%)', g.is_active;
    END IF;
    IF g.donor_user_id <> 'd3737961-7cf8-426c-8ba2-74196026f040' THEN
        RAISE EXCEPTION 'Fund Her donor unexpectedly changed: %', g.donor_user_id;
    END IF;
    IF g.reserved_amount <> 31400 OR g.amount_used <> 37600 OR g.total_cap <> 31400 THEN
        RAISE EXCEPTION
          'Fund Her amounts unexpectedly changed (cap=%, reserved=%, used=%)',
          g.total_cap, g.reserved_amount, g.amount_used;
    END IF;
END $$;

COMMIT;

-- ------------------------------------------------------------------ --
-- Rollback (re-activate the grant)
-- ------------------------------------------------------------------ --
-- BEGIN;
-- UPDATE campaign_match_grants
--    SET is_active  = TRUE,
--        updated_at = NOW()
--  WHERE id = 2
--    AND is_active = FALSE;
-- COMMIT;
