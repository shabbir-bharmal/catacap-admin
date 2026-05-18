-- Task #503 follow-up: backfill historical account_balance_change_logs rows
-- whose comment uses the old escrow-match wording so they read in the
-- new format that names the investor whose recommendation triggered the
-- match.
--
-- Old format (still in DB for rows inserted before this release):
--     $X matched from escrow via grant "<Grant Name>"
-- New format (written by server/src/utils/matchingGrants.ts as of #503):
--     $X matched from "<Grant Name>" on behalf of <Investor Name>
--
-- Investor name = user_full_name of the recommendation that triggered
-- the match (campaign_match_grant_activity.triggered_by_recommendation_id).
-- The activity row is linked back to the log row by donor user, campaign,
-- and exact amount (which is embedded in the old comment).
--
-- Idempotency: the UPDATE only touches rows that still match the OLD
-- regex; rows already rewritten to the new wording (or unrelated rows)
-- are skipped on re-run. The whole script runs in one transaction.
--
-- Rollback (uncomment to revert to the old wording — best-effort, only
-- for rows backfilled by this migration):
--     BEGIN;
--     UPDATE account_balance_change_logs l
--        SET comment = '$' ||
--                      (regexp_match(l.comment, '^\$([0-9.]+) matched from '))[1]
--                      || ' matched from escrow via grant "' ||
--                      (regexp_match(l.comment, '^\$[0-9.]+ matched from "(.+)" on behalf of '))[1]
--                      || '"'
--      WHERE l.payment_type = 'Match grant – escrow applied'
--        AND l.comment ~ '^\$[0-9.]+ matched from ".+" on behalf of ';
--     COMMIT;

BEGIN;

WITH log_to_activity AS (
    SELECT DISTINCT ON (l.id)
           l.id            AS log_id,
           g.name          AS grant_name,
           tr.user_full_name AS investor_name,
           (regexp_match(l.comment, '^\$([0-9.]+) matched from escrow via grant '))[1] AS amount_str
      FROM account_balance_change_logs l
      JOIN campaign_match_grants g
        ON g.donor_user_id = l.user_id
      JOIN campaign_match_grant_activity a
        ON a.match_grant_id = g.id
       AND a.campaign_id    = l.campaign_id
       AND a.amount         = (regexp_match(l.comment, '^\$([0-9.]+) matched from escrow via grant '))[1]::numeric
      LEFT JOIN recommendations tr
        ON tr.id = a.triggered_by_recommendation_id
     WHERE l.payment_type = 'Match grant – escrow applied'
       AND l.comment ~ '^\$[0-9.]+ matched from escrow via grant "'
     ORDER BY l.id, ABS(EXTRACT(EPOCH FROM (a.created_at - l.change_date))) ASC
)
UPDATE account_balance_change_logs l
   SET comment = '$' || lta.amount_str
                 || ' matched from "' || lta.grant_name
                 || '" on behalf of ' || COALESCE(lta.investor_name, '')
  FROM log_to_activity lta
 WHERE l.id = lta.log_id;

COMMIT;
