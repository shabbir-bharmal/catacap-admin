/**
 * Centralized definition of "who receives a campaign update" for a given
 * campaign. This MUST stay in sync with the `unifiedInvestorsCTE` used by the
 * Investors tab on the admin investment page (see
 * `server/src/routes/adminInvestment.ts`). If a person is visible on that tab
 * with a fundable / non-rejected status, they should also receive update
 * emails and in-app notifications.
 *
 * Historically the fan-out only looked at `user_investments`, which silently
 * excluded investors whose recommendation had not yet been converted into a
 * `user_investments` row (e.g. an approved recommendation that's still
 * pending money landing). The Investors tab still showed those people, so
 * admins reasonably expected them to receive the update.
 *
 * Recipient definition (DISTINCT user_id), all scoped to one campaign ($1):
 *   1. `recommendations` rows with status `approved` or `pending`,
 *      `amount > 0`, and (no linked `pending_grants` OR the linked grant is
 *      not `rejected`). Mirrors the recommendations branch of
 *      `unifiedInvestorsCTE`.
 *   2. Orphan `pending_grants` rows (no linked recommendation) with status
 *      `pending` and `amount > 0`. Mirrors the pending_grants branch of
 *      `unifiedInvestorsCTE`.
 *   3. `asset_based_payment_requests` rows with status `In Transit`. These
 *      are not part of `unifiedInvestorsCTE` but represent committed
 *      other-asset investors who would otherwise be silently skipped.
 *
 * Final outer filter: deliverable email (`u.email IS NOT NULL AND u.email <> ''`)
 * and not opted out of email notifications.
 *
 * Each export takes a single positional parameter at $1: `campaignId`.
 */

// SELECT shape: { id, email, first_name } — used by send-email loop.
export const CAMPAIGN_UPDATE_RECIPIENT_USERS_SQL = `
  SELECT u.id, u.email, COALESCE(u.first_name, '') AS first_name
    FROM users u
    JOIN (
      SELECT r.user_id
        FROM recommendations r
        LEFT JOIN pending_grants pg ON r.pending_grants_id = pg.id
       WHERE r.campaign_id = $1
         AND r.user_id IS NOT NULL
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
         AND LOWER(COALESCE(r.status, '')) IN ('approved', 'pending')
         AND r.amount > 0
         AND (pg.id IS NULL OR LOWER(COALESCE(pg.status, '')) <> 'rejected')
      UNION
      SELECT pg.user_id
        FROM pending_grants pg
       WHERE pg.campaign_id = $1
         AND pg.user_id IS NOT NULL
         AND (pg.is_deleted IS NULL OR pg.is_deleted = false)
         AND LOWER(COALESCE(pg.status, '')) = 'pending'
         AND COALESCE(NULLIF(pg.amount, '')::numeric, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM recommendations r2
            WHERE r2.pending_grants_id = pg.id
              AND (r2.is_deleted IS NULL OR r2.is_deleted = false)
         )
      UNION
      SELECT a.user_id
        FROM asset_based_payment_requests a
       WHERE a.campaign_id = $1
         AND a.user_id IS NOT NULL
         AND (a.is_deleted IS NULL OR a.is_deleted = false)
         AND LOWER(TRIM(COALESCE(a.status, ''))) = 'in transit'
    ) src ON src.user_id = u.id
   WHERE u.email IS NOT NULL
     AND u.email <> ''
     AND COALESCE(u.is_deleted, false) = false
     AND (u.opt_out_email_notifications IS NULL OR u.opt_out_email_notifications = false)
`;

// SELECT shape: { user_id } — used by in-app notification fan-out. We do NOT
// filter on email or `opt_out_email_notifications` here because those are
// email-channel concerns and must not suppress in-app notifications. We do
// still exclude soft-deleted users.
export const CAMPAIGN_UPDATE_RECIPIENT_USER_IDS_SQL = `
  SELECT DISTINCT src.user_id
    FROM (
      SELECT r.user_id
        FROM recommendations r
        LEFT JOIN pending_grants pg ON r.pending_grants_id = pg.id
       WHERE r.campaign_id = $1
         AND r.user_id IS NOT NULL
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
         AND LOWER(COALESCE(r.status, '')) IN ('approved', 'pending')
         AND r.amount > 0
         AND (pg.id IS NULL OR LOWER(COALESCE(pg.status, '')) <> 'rejected')
      UNION
      SELECT pg.user_id
        FROM pending_grants pg
       WHERE pg.campaign_id = $1
         AND pg.user_id IS NOT NULL
         AND (pg.is_deleted IS NULL OR pg.is_deleted = false)
         AND LOWER(COALESCE(pg.status, '')) = 'pending'
         AND COALESCE(NULLIF(pg.amount, '')::numeric, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM recommendations r2
            WHERE r2.pending_grants_id = pg.id
              AND (r2.is_deleted IS NULL OR r2.is_deleted = false)
         )
      UNION
      SELECT a.user_id
        FROM asset_based_payment_requests a
       WHERE a.campaign_id = $1
         AND a.user_id IS NOT NULL
         AND (a.is_deleted IS NULL OR a.is_deleted = false)
         AND LOWER(TRIM(COALESCE(a.status, ''))) = 'in transit'
    ) src
    JOIN users u ON u.id = src.user_id
   WHERE src.user_id IS NOT NULL
     AND COALESCE(u.is_deleted, false) = false
`;

// SELECT shape: { count } — used by /email-preview to render "will email N
// people" in the admin UI.
export const CAMPAIGN_UPDATE_RECIPIENT_COUNT_SQL = `
  SELECT COUNT(DISTINCT u.id)::int AS count
    FROM users u
    JOIN (
      SELECT r.user_id
        FROM recommendations r
        LEFT JOIN pending_grants pg ON r.pending_grants_id = pg.id
       WHERE r.campaign_id = $1
         AND r.user_id IS NOT NULL
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
         AND LOWER(COALESCE(r.status, '')) IN ('approved', 'pending')
         AND r.amount > 0
         AND (pg.id IS NULL OR LOWER(COALESCE(pg.status, '')) <> 'rejected')
      UNION
      SELECT pg.user_id
        FROM pending_grants pg
       WHERE pg.campaign_id = $1
         AND pg.user_id IS NOT NULL
         AND (pg.is_deleted IS NULL OR pg.is_deleted = false)
         AND LOWER(COALESCE(pg.status, '')) = 'pending'
         AND COALESCE(NULLIF(pg.amount, '')::numeric, 0) > 0
         AND NOT EXISTS (
           SELECT 1 FROM recommendations r2
            WHERE r2.pending_grants_id = pg.id
              AND (r2.is_deleted IS NULL OR r2.is_deleted = false)
         )
      UNION
      SELECT a.user_id
        FROM asset_based_payment_requests a
       WHERE a.campaign_id = $1
         AND a.user_id IS NOT NULL
         AND (a.is_deleted IS NULL OR a.is_deleted = false)
         AND LOWER(TRIM(COALESCE(a.status, ''))) = 'in transit'
    ) src ON src.user_id = u.id
   WHERE u.email IS NOT NULL
     AND u.email <> ''
     AND COALESCE(u.is_deleted, false) = false
     AND (u.opt_out_email_notifications IS NULL OR u.opt_out_email_notifications = false)
`;
