-- 2026_05_19_004_users_ref_code_backfill.sql
--
-- Intent
-- ------
-- Ensure every user in public.users has a non-empty ref_code so the
-- /referrals admin page can show, and the public site can issue,
-- a referral link for every account. Previously ref_code was only
-- populated for a handful of legacy accounts (e.g. Ken Kurtzig);
-- newly created users had it left NULL.
--
-- Changes
-- -------
-- 1. Create helper function public.generate_user_ref_code() that
--    returns a random 8-char alphanumeric code (mixed case + digits)
--    not already present in users.ref_code.
-- 2. Back-fill ref_code for every user where it is NULL or ''.
-- 3. Add a unique index on ref_code (excluding NULL/'') so two users
--    can never share a code.
--
-- Idempotency
-- -----------
-- * Function is CREATE OR REPLACE.
-- * Back-fill targets only rows where ref_code IS NULL OR '' = no-op
--   on re-run once every user has one.
-- * Index uses IF NOT EXISTS.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_user_ref_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars  text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code   text;
  i      int;
  taken  boolean;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(chars, 1 + floor(random() * 62)::int, 1);
    END LOOP;

    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE ref_code = code
    ) INTO taken;

    IF NOT taken THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.users WHERE ref_code IS NULL OR ref_code = ''
  LOOP
    UPDATE public.users
       SET ref_code = public.generate_user_ref_code()
     WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ref_code_unique
  ON public.users (ref_code)
  WHERE ref_code IS NOT NULL AND ref_code <> '';

COMMIT;
