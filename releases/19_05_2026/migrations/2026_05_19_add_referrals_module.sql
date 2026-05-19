-- 2026-05-19: Register the 'referrals' admin module so the new Referrals page
-- under "Donations to Invest" can be gated by role permissions in the same way
-- as Users, Recommendations, Pending Grants, etc. Idempotent.
BEGIN;

INSERT INTO public.modules (name, category, sort_order, created_at)
SELECT 'referrals',
       'Donations to Invest',
       COALESCE((SELECT MAX(sort_order) FROM public.modules), 0) + 1,
       NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.modules WHERE name = 'referrals'
);

COMMIT;
