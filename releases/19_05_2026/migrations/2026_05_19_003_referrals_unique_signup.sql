-- 2026_05_19_003_referrals_unique_signup.sql
--
-- Enforce at the database level that each referred user has at most ONE
-- 'signup' attribution row. This is the authoritative guard against
-- two admins concurrently linking the same referred user to two
-- different referrers via POST /api/admin/referrals/link.
--
-- Schema:
--   * Partial unique index on public.referrals(referred_user_id)
--     WHERE action_type = 'signup'.
--
-- Idempotency:
--   * CREATE UNIQUE INDEX IF NOT EXISTS — safe to re-run.
--   * Pre-flight check fails fast if existing data already violates the
--     invariant so we never silently leave half the constraint in place.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_referrals_signup_unique_referred_user;

BEGIN;

DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count FROM (
        SELECT referred_user_id
          FROM public.referrals
         WHERE action_type = 'signup'
           AND referred_user_id IS NOT NULL
         GROUP BY referred_user_id
        HAVING COUNT(*) > 1
    ) d;
    IF dup_count > 0 THEN
        RAISE EXCEPTION
          'Cannot create unique signup attribution: % referred_user_id(s) already have multiple signup rows. Resolve duplicates first.',
          dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_signup_unique_referred_user
    ON public.referrals (referred_user_id)
 WHERE action_type = 'signup';

COMMIT;
