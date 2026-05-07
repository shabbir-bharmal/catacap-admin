-- Migration: reactivate FundHer match grant (id = 2)
-- Date: 2026-05-07
--
-- Purpose:
--   Re-enable the FundHer match grant after the earlier deactivation
--   (see 2026_05_07_deactivate_fundher_match_grant.sql). Per user
--   request, set is_active back to TRUE.
--
-- Why direct SQL instead of the admin PUT endpoint:
--   PUT /api/admin/matching/:id runs reservation reconciliation against
--   the donor's wallet. FundHer's grant is in an "over-cap" state
--   (amount_used = $37,600 > total_cap = $31,400 = reserved_amount)
--   because of the historical FundHer backfill, and the donor's wallet
--   balance is $0. Round-tripping through the PUT path would attempt
--   to re-reserve / refund based on (newCommitted - oldReserved) and
--   could produce a spurious wallet movement. Toggling is_active in
--   isolation is the only operation we want here, with no wallet or
--   reservation side-effects.
--
-- Functional impact of reactivation:
--   The matching engine will now consider this grant when applying
--   matches, but availableBudget = max(0, reserved_amount - amount_used)
--   = max(0, 31400 - 37600) = 0, so it will not actually fire any new
--   matches until the cap is raised above amount_used. This is the
--   correct, expected behavior for an over-cap grant.
--
-- Idempotency: guarded WHERE clause ensures repeated runs are no-ops.
-- Transactional: BEGIN/COMMIT.
-- Audit: writes a row to schema_change_logs (best-effort, advisory).

BEGIN;

UPDATE campaign_match_grants
   SET is_active  = TRUE,
       updated_at = NOW()
 WHERE id = 2
   AND is_active = FALSE;

INSERT INTO schema_change_logs
    (operation_type, table_name, column_name,
     old_definition, new_definition,
     executed_sql, rollback_sql,
     triggered_by, prompt_reference, status)
SELECT 'data_update',
       'campaign_match_grants',
       'is_active',
       jsonb_build_object('grant_id', 2, 'grant_name', 'Fund Her', 'is_active', false),
       jsonb_build_object('grant_id', 2, 'grant_name', 'Fund Her', 'is_active', true),
       'UPDATE campaign_match_grants SET is_active = TRUE, updated_at = NOW() WHERE id = 2;',
       'UPDATE campaign_match_grants SET is_active = FALSE, updated_at = NOW() WHERE id = 2;',
       'migration',
       '2026_05_07_reactivate_fundher_match_grant.sql',
       'applied'
 WHERE EXISTS (
   SELECT 1
     FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'schema_change_logs'
 );

COMMIT;

-- ------------------------------------------------------------------ --
-- Rollback (return to inactive)
-- ------------------------------------------------------------------ --
-- BEGIN;
-- UPDATE campaign_match_grants
--    SET is_active  = FALSE,
--        updated_at = NOW()
--  WHERE id = 2 AND is_active = TRUE;
-- COMMIT;
