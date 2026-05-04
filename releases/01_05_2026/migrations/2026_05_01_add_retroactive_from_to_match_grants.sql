-- 2026-05-01: Retroactive matching support
--
-- 1) Adds `retroactive_from` to `campaign_match_grants`. When set, the grant
--    is also applied to recommendations on its eligible campaigns whose
--    `date_created` is on/after this timestamp (in addition to future ones).
--
-- 2) Adds a unique index on (match_grant_id, triggered_by_recommendation_id)
--    on the activity table as a defense-in-depth guarantee that the same
--    grant can never produce two match rows for the same investor
--    recommendation, regardless of code paths or concurrency.

ALTER TABLE campaign_match_grants
  ADD COLUMN IF NOT EXISTS retroactive_from TIMESTAMP NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_match_grant_activity_grant_rec_uniq
  ON campaign_match_grant_activity (match_grant_id, triggered_by_recommendation_id);
