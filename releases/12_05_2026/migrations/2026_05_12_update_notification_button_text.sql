-- Rename the CTA button in the "Investment Update Notification" email template
-- from "View the investment" to "View File", per product request on 12 May 2026.
--
-- Idempotent: REPLACE() leaves the row unchanged when the old text is already
-- absent (subsequent runs are no-ops). Wrapped in a transaction so the row is
-- never left half-updated.

BEGIN;

UPDATE email_templates
SET body_html = REPLACE(body_html, '🔗 View the investment', '🔗 View File'),
    modified_at = NOW()
WHERE name = 'Investment Update Notification'
  AND body_html LIKE '%🔗 View the investment%';

COMMIT;
