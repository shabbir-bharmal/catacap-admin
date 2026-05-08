-- Migration: Backfill historical FundHer match activity (campaign_match_grant id = 2)
-- Date: 2026-05-07
--
-- Purpose:
--   Prior to the campaign-match-grant tool going live (released 2026-04-30),
--   FundHer matches were operated manually: a dedicated user account
--   (fundher@catacap.org, id d3737961-7cf8-426c-8ba2-74196026f040) was
--   pre-funded and that account submitted real `recommendations` rows
--   alongside investor donations on the FundHer-eligible campaigns.
--
--   Those historical recommendations exist in the `recommendations` table but
--   have NO corresponding row in `campaign_match_grant_activity`, which means
--   none of the existing match reporting (admin matching dashboard, totals,
--   per-campaign breakdown) counts them. This migration backfills one
--   `campaign_match_grant_activity` row per missing FundHer recommendation so
--   the existing reporting surfaces a complete history.
--
-- Strategy:
--   1. Identify candidate recommendations: rows owned by the FundHer donor
--      user that do NOT yet have an activity row linking them to grant 2.
--   2. For each candidate, attempt to find a "triggering" investor
--      recommendation: closest-in-time non-FundHer rec on the same campaign
--      within a 30-minute window AND not already claimed by an existing
--      activity row for grant 2.
--   3. Resolve conflicts via ROW_NUMBER(): if two candidates would point at
--      the same trigger (forbidden by unique index
--      campaign_match_grant_activity_grant_rec_uniq on (match_grant_id,
--      triggered_by_recommendation_id)), only the candidate with the
--      smallest time gap keeps that trigger; the rest fall back to anonymous
--      (triggered_by_recommendation_id = NULL, triggered_by_user_id = NULL).
--      NULL triggers are allowed because Postgres treats NULL as distinct in
--      unique indexes by default, so any number of anonymous rows can coexist.
--   4. If no rec is found inside the window, the activity row is inserted as
--      anonymous (campaign_id retained, triggered_by_* NULL). Reports will
--      surface this as "FundHer matched $X on [campaign]" without naming a
--      triggering investor, per product owner direction.
--   5. Increment campaign_match_grants.amount_used by the total of newly
--      inserted rows so the grant header totals reflect reality.
--
-- What this migration does NOT do (deliberate):
--   * Does NOT create new `recommendations` rows.
--   * Does NOT touch the FundHer donor's `account_balance` or write to
--     `account_balance_change_logs` — funds were debited manually back when
--     each historical match happened.
--   * Does NOT modify `campaign_match_grants.reserved_amount`.
--   * Does NOT trigger emails, notifications, or scheduler jobs.
--   * Does NOT pair a FundHer rec to another FundHer rec (anti-chain-match).
--
-- Idempotency:
--   The candidate CTE filters out any FundHer recommendation that already has
--   an activity row, and the conditional UPDATE on amount_used only fires
--   when at least one row was inserted. Safe to re-run.
--
-- Rollback:
--   See bottom of this file.

BEGIN;

WITH candidates AS (
    -- FundHer-donor recommendations not yet linked to an activity row
    SELECT r.id           AS donor_rec_id,
           r.campaign_id  AS campaign_id,
           r.amount       AS amount,
           r.date_created AS rec_date
      FROM recommendations r
     WHERE r.user_id = 'd3737961-7cf8-426c-8ba2-74196026f040'
       AND (r.is_deleted IS NULL OR r.is_deleted = false)
       AND NOT EXISTS (
           SELECT 1
             FROM campaign_match_grant_activity a
            WHERE a.donor_recommendation_id = r.id
              AND a.match_grant_id = 2
       )
),
proposed AS (
    -- For each candidate, propose the closest non-FundHer rec on the same
    -- campaign within 30 minutes (1800 sec) that is NOT already claimed by
    -- an existing activity row for grant 2. NULL if no such rec exists.
    SELECT c.donor_rec_id,
           c.campaign_id,
           c.amount,
           c.rec_date,
           t.id        AS proposed_trigger_rec_id,
           t.user_id   AS proposed_trigger_user_id,
           t.sec_diff  AS proposed_trigger_sec_diff
      FROM candidates c
      LEFT JOIN LATERAL (
          SELECT r2.id,
                 r2.user_id,
                 ABS(EXTRACT(EPOCH FROM (r2.date_created - c.rec_date))) AS sec_diff
            FROM recommendations r2
           WHERE r2.campaign_id = c.campaign_id
             AND r2.user_id <> 'd3737961-7cf8-426c-8ba2-74196026f040'
             AND r2.id <> c.donor_rec_id
             AND (r2.is_deleted IS NULL OR r2.is_deleted = false)
             AND ABS(EXTRACT(EPOCH FROM (r2.date_created - c.rec_date))) <= 1800
             AND NOT EXISTS (
                 SELECT 1 FROM campaign_match_grant_activity a2
                  WHERE a2.match_grant_id = 2
                    AND a2.triggered_by_recommendation_id = r2.id
             )
           ORDER BY ABS(EXTRACT(EPOCH FROM (r2.date_created - c.rec_date)))
           LIMIT 1
      ) t ON true
),
deduped AS (
    -- If multiple candidates pick the same trigger, only the closest keeps
    -- it; the rest get NULL. Required by the unique index
    -- campaign_match_grant_activity_grant_rec_uniq.
    SELECT p.donor_rec_id,
           p.campaign_id,
           p.amount,
           p.rec_date,
           CASE
               WHEN p.proposed_trigger_rec_id IS NULL THEN NULL
               WHEN ROW_NUMBER() OVER (
                       PARTITION BY p.proposed_trigger_rec_id
                       ORDER BY p.proposed_trigger_sec_diff, p.donor_rec_id
                    ) = 1 THEN p.proposed_trigger_rec_id
               ELSE NULL
           END AS triggered_by_rec_id,
           CASE
               WHEN p.proposed_trigger_rec_id IS NULL THEN NULL
               WHEN ROW_NUMBER() OVER (
                       PARTITION BY p.proposed_trigger_rec_id
                       ORDER BY p.proposed_trigger_sec_diff, p.donor_rec_id
                    ) = 1 THEN p.proposed_trigger_user_id
               ELSE NULL
           END AS triggered_by_user_id
      FROM proposed p
),
inserted AS (
    INSERT INTO campaign_match_grant_activity (
        match_grant_id,
        campaign_id,
        triggered_by_user_id,
        triggered_by_recommendation_id,
        donor_recommendation_id,
        amount,
        created_at
    )
    SELECT 2,
           d.campaign_id,
           d.triggered_by_user_id,
           d.triggered_by_rec_id,
           d.donor_rec_id,
           d.amount,
           d.rec_date
      FROM deduped d
    RETURNING id, amount
)
UPDATE campaign_match_grants g
   SET amount_used = g.amount_used + COALESCE((SELECT SUM(amount) FROM inserted), 0),
       updated_at  = NOW()
 WHERE g.id = 2
   AND EXISTS (SELECT 1 FROM inserted);

COMMIT;

-- ------------------------------------------------------------------ --
-- Rollback (uncomment and run to revert this backfill)
-- ------------------------------------------------------------------ --
-- IMPORTANT: rollback identifies the inserted rows via the
-- `fundher_backfill_audit` table created by the companion migration
-- 2026_05_07_fundher_backfill_audit.sql. Do NOT attempt to identify
-- backfilled rows by matching activity.created_at against the donor
-- recommendation's date_created — the live matching tool can produce equal
-- timestamps within the same transaction, so that marker is unsafe and could
-- delete legitimate live-tool match rows. The audit table is the only safe
-- source of truth for what this migration inserted.
--
-- BEGIN;
--
-- WITH removed AS (
--     DELETE FROM campaign_match_grant_activity
--      WHERE id IN (SELECT activity_id FROM fundher_backfill_audit)
--     RETURNING amount
-- )
-- UPDATE campaign_match_grants g
--    SET amount_used = g.amount_used - COALESCE((SELECT SUM(amount) FROM removed), 0),
--        updated_at  = NOW()
--  WHERE g.id = 2
--    AND EXISTS (SELECT 1 FROM removed);
--
-- -- Optionally drop the audit table after a successful rollback:
-- -- DROP TABLE IF EXISTS fundher_backfill_audit;
--
-- COMMIT;
