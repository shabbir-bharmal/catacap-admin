import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";

const router = Router();

const ACTION_TYPES = ["signup", "group_join", "investment", "raise_money_signup"] as const;

const SORT_COLUMNS: Record<string, string> = {
  fullname: "full_name",
  email: "u.email",
  refcode: "u.ref_code",
  totalreferred: "total_referred",
  signups: "signups",
  groupjoins: "group_joins",
  // The Investments column now displays total invested $ rather than
  // event count, so we sort by the live-summed amount.
  investments: "investments_total",
  investmentstotal: "investments_total",
  raisemoneysignups: "raise_money_signups",
  lastreferredat: "last_referred_at",
};

router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.CurrentPage as string) || "1", 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt((req.query.PerPage as string) || "50", 10) || 50));
    const sortDirection = ((req.query.SortDirection as string) || "desc").toLowerCase();
    const isAsc = sortDirection === "asc";
    const sortFieldRaw = ((req.query.SortField as string) || "").toLowerCase().replace(/[_\s-]/g, "");
    const sortColumn = SORT_COLUMNS[sortFieldRaw] || "last_referred_at";
    const search = ((req.query.SearchValue as string) || "").trim().toLowerCase();

    const filterParams: any[] = [];
    let whereSearch = "";
    if (search) {
      filterParams.push(`%${search}%`);
      const i = filterParams.length;
      whereSearch = `AND (
        LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $${i}
        OR LOWER(COALESCE(u.email, '')) LIKE $${i}
        OR LOWER(COALESCE(u.ref_code, '')) LIKE $${i}
      )`;
    }

    const baseFrom = `
      FROM public.referrals r
      JOIN public.users u ON u.id = r.referrer_user_id
      WHERE (u.is_deleted IS NULL OR u.is_deleted = false)
      ${whereSearch}
    `;

    const aggregateSelect = `
      SELECT
        u.id AS referrer_id,
        u.first_name,
        u.last_name,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS full_name,
        u.email,
        u.ref_code,
        COUNT(DISTINCT r.referred_user_id)::int AS total_referred,
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE r.action_type = 'signup')::int AS signups,
        COUNT(*) FILTER (WHERE r.action_type = 'group_join')::int AS group_joins,
        COUNT(*) FILTER (WHERE r.action_type = 'investment')::int AS investments,
        COUNT(*) FILTER (WHERE r.action_type = 'raise_money_signup')::int AS raise_money_signups,
        -- Sum of live recommendations.amount across every (campaign,
        -- referred user) pair attributed to this referrer. Matches the
        -- per-campaign totals shown in the Investments drill-down view.
        COALESCE((
          SELECT SUM(rec.amount)
            FROM (
              SELECT DISTINCT r2.target_id::int AS campaign_id,
                              r2.referred_user_id AS user_id
                FROM public.referrals r2
               WHERE r2.referrer_user_id = u.id
                 AND r2.action_type = 'investment'
                 AND r2.target_id ~ '^[0-9]+$'
                 AND r2.referred_user_id IS NOT NULL
            ) ref
            JOIN public.recommendations rec
              ON rec.campaign_id = ref.campaign_id
             AND rec.user_id = ref.user_id
             AND (rec.is_deleted IS NULL OR rec.is_deleted = false)
        ), 0)::numeric AS investments_total,
        MAX(r.created_at) AS last_referred_at
      ${baseFrom}
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.ref_code
      HAVING COUNT(DISTINCT r.referred_user_id) >= 1
    `;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT u.id ${baseFrom} GROUP BY u.id
         HAVING COUNT(DISTINCT r.referred_user_id) >= 1
       ) sub`,
      filterParams
    );
    const totalCount = countResult.rows[0]?.total ?? 0;

    const offset = (page - 1) * pageSize;
    const dir = isAsc ? "ASC" : "DESC";
    const dataParams = [...filterParams, pageSize, offset];
    const dataResult = await pool.query(
      `${aggregateSelect}
       ORDER BY ${sortColumn} ${dir} NULLS LAST, u.id ASC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const items = dataResult.rows.map((r: any) => ({
      referrerId: r.referrer_id,
      firstName: r.first_name || "",
      lastName: r.last_name || "",
      fullName: r.full_name || "",
      email: r.email || "",
      refCode: r.ref_code || "",
      totalReferred: r.total_referred,
      totalEvents: r.total_events,
      signups: r.signups,
      groupJoins: r.group_joins,
      investments: r.investments,
      investmentsTotal: r.investments_total != null ? Number(r.investments_total) : 0,
      raiseMoneySignups: r.raise_money_signups,
      lastReferredAt: r.last_referred_at,
    }));

    res.json({ items, totalCount, currentPage: page, perPage: pageSize });
  } catch (err: any) {
    console.error("Error fetching referrers:", err);
    res.status(500).json({ success: false, message: err?.message || "Internal server error" });
  }
});

router.get("/by-referrer/:referrerId", async (req: Request, res: Response) => {
  try {
    const referrerId = String(req.params.referrerId);
    if (!referrerId) {
      res.status(400).json({ success: false, message: "referrerId is required" });
      return;
    }

    const eventsResult = await pool.query(
      `SELECT
         r.id,
         r.action_type,
         r.target_id,
         r.source_path,
         r.created_at,
         r.amount,
         ru.id AS referred_user_id,
         ru.first_name AS referred_first_name,
         ru.last_name AS referred_last_name,
         ru.email AS referred_email,
         CASE
           WHEN r.action_type IN ('investment','raise_money_signup') AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT c.name FROM public.campaigns c WHERE c.id = r.target_id::int)
           WHEN r.action_type = 'group_join' AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT g.name FROM public.groups g WHERE g.id = r.target_id::int)
           ELSE NULL
         END AS target_name,
         CASE
           WHEN r.action_type IN ('investment','raise_money_signup') AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT c.property FROM public.campaigns c WHERE c.id = r.target_id::int)
           ELSE NULL
         END AS target_slug
       FROM public.referrals r
       LEFT JOIN public.users ru ON ru.id = r.referred_user_id
       WHERE r.referrer_user_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [referrerId]
    );

    // Aggregated summaries used by the per-action drill-down views on the
    // Referrals page. Computed in SQL so totals reflect live data even
    // when the event list rows hold the older first-touch amount.

    // Signups → one row per referred user that this referrer is attributed to.
    const signupSummaryResult = await pool.query(
      `SELECT
         ru.id AS referred_user_id,
         ru.first_name,
         ru.last_name,
         ru.email,
         r.created_at AS signup_at
         FROM public.referrals r
         JOIN public.users ru ON ru.id = r.referred_user_id
        WHERE r.referrer_user_id = $1
          AND r.action_type = 'signup'
        ORDER BY r.created_at DESC, r.id DESC`,
      [referrerId]
    );

    // Group joins → grouped by group, with the count of distinct referred
    // users this referrer brought into that group.
    const groupSummaryResult = await pool.query(
      `SELECT
         r.target_id AS group_id,
         g.name AS group_name,
         COUNT(DISTINCT r.referred_user_id)::int AS referral_count,
         MAX(r.created_at) AS last_joined_at
         FROM public.referrals r
         LEFT JOIN public.groups g
           ON r.target_id ~ '^[0-9]+$' AND g.id = r.target_id::int
        WHERE r.referrer_user_id = $1
          AND r.action_type = 'group_join'
          AND r.target_id IS NOT NULL
        GROUP BY r.target_id, g.name
        ORDER BY referral_count DESC, g.name ASC NULLS LAST`,
      [referrerId]
    );

    // Investments → grouped by campaign. We count the DISTINCT referred
    // users that invested in each campaign through this referrer, and we
    // sum the LIVE recommendations.amount for those users on that
    // campaign (so admin edits to amounts are reflected here).
    const investmentSummaryResult = await pool.query(
      `WITH referred AS (
         SELECT DISTINCT
                r.target_id::int AS campaign_id,
                r.referred_user_id
           FROM public.referrals r
          WHERE r.referrer_user_id = $1
            AND r.action_type = 'investment'
            AND r.target_id ~ '^[0-9]+$'
            AND r.referred_user_id IS NOT NULL
       )
       SELECT
         ref.campaign_id,
         c.name AS campaign_name,
         c.property AS campaign_slug,
         COUNT(DISTINCT ref.referred_user_id)::int AS investor_count,
         COALESCE(SUM(rec.amount), 0)::numeric AS total_amount,
         COUNT(rec.id)::int AS recommendation_count
         FROM referred ref
         LEFT JOIN public.campaigns c ON c.id = ref.campaign_id
         LEFT JOIN public.recommendations rec
           ON rec.campaign_id = ref.campaign_id
          AND rec.user_id = ref.referred_user_id
          AND (rec.is_deleted IS NULL OR rec.is_deleted = false)
        GROUP BY ref.campaign_id, c.name, c.property
        ORDER BY total_amount DESC, c.name ASC NULLS LAST`,
      [referrerId]
    );

    // Raise-money signups → companies/campaigns owned by referred users,
    // with total raised so far through CataCap (sum of non-deleted
    // recommendations on that campaign).
    const raiseMoneySummaryResult = await pool.query(
      `WITH referred_campaigns AS (
         SELECT DISTINCT r.target_id::int AS campaign_id
           FROM public.referrals r
          WHERE r.referrer_user_id = $1
            AND r.action_type = 'raise_money_signup'
            AND r.target_id ~ '^[0-9]+$'
       )
       SELECT
         rc.campaign_id,
         c.name AS campaign_name,
         c.property AS campaign_slug,
         COALESCE(SUM(rec.amount), 0)::numeric AS total_raised,
         COUNT(rec.id)::int AS contribution_count
         FROM referred_campaigns rc
         LEFT JOIN public.campaigns c ON c.id = rc.campaign_id
         LEFT JOIN public.recommendations rec
           ON rec.campaign_id = rc.campaign_id
          AND (rec.is_deleted IS NULL OR rec.is_deleted = false)
        GROUP BY rc.campaign_id, c.name, c.property
        ORDER BY total_raised DESC, c.name ASC NULLS LAST`,
      [referrerId]
    );

    const referrerResult = await pool.query(
      `SELECT id, first_name, last_name, email, ref_code FROM public.users WHERE id = $1 LIMIT 1`,
      [referrerId]
    );
    const referrer = referrerResult.rows[0]
      ? {
          id: referrerResult.rows[0].id,
          firstName: referrerResult.rows[0].first_name || "",
          lastName: referrerResult.rows[0].last_name || "",
          fullName: `${referrerResult.rows[0].first_name || ""} ${referrerResult.rows[0].last_name || ""}`.trim(),
          email: referrerResult.rows[0].email || "",
          refCode: referrerResult.rows[0].ref_code || "",
        }
      : null;

    const items = eventsResult.rows.map((r: any) => ({
      id: Number(r.id),
      actionType: r.action_type,
      targetId: r.target_id || null,
      targetName: r.target_name || null,
      targetSlug: r.target_slug || null,
      sourcePath: r.source_path || null,
      createdAt: r.created_at,
      amount: r.amount != null ? Number(r.amount) : null,
      referredUserId: r.referred_user_id || null,
      referredFirstName: r.referred_first_name || "",
      referredLastName: r.referred_last_name || "",
      referredFullName: `${r.referred_first_name || ""} ${r.referred_last_name || ""}`.trim(),
      referredEmail: r.referred_email || "",
    }));

    const signupSummaries = signupSummaryResult.rows.map((r: any) => ({
      referredUserId: r.referred_user_id,
      firstName: r.first_name || "",
      lastName: r.last_name || "",
      fullName: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
      email: r.email || "",
      signupAt: r.signup_at,
    }));

    const groupSummaries = groupSummaryResult.rows.map((r: any) => ({
      groupId: r.group_id,
      groupName: r.group_name || null,
      referralCount: r.referral_count,
      lastJoinedAt: r.last_joined_at,
    }));

    const investmentSummaries = investmentSummaryResult.rows.map((r: any) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name || null,
      campaignSlug: r.campaign_slug || null,
      investorCount: r.investor_count,
      recommendationCount: r.recommendation_count,
      totalAmount: r.total_amount != null ? Number(r.total_amount) : 0,
    }));

    const raiseMoneySummaries = raiseMoneySummaryResult.rows.map((r: any) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name || null,
      campaignSlug: r.campaign_slug || null,
      totalRaised: r.total_raised != null ? Number(r.total_raised) : 0,
      contributionCount: r.contribution_count,
    }));

    res.json({
      success: true,
      referrer,
      items,
      signupSummaries,
      groupSummaries,
      investmentSummaries,
      raiseMoneySummaries,
    });
  } catch (err: any) {
    console.error("Error fetching referrals for referrer:", err);
    res.status(500).json({ success: false, message: err?.message || "Internal server error" });
  }
});

// POST /api/admin/referrals/link
// Manually create a referrer → referred-user connection and back-fill all of
// the referred user's existing activity (groups joined, investments made,
// raise-money signups) as referral events. Idempotent: re-running the same
// link only inserts events that don't already exist.
router.post("/link", async (req: Request, res: Response) => {
  const referrerUserId = String(req.body?.referrerUserId || "").trim();
  const referredUserId = String(req.body?.referredUserId || "").trim();

  if (!referrerUserId || !referredUserId) {
    res.status(400).json({ success: false, message: "referrerUserId and referredUserId are required" });
    return;
  }
  if (referrerUserId === referredUserId) {
    res.status(400).json({ success: false, message: "A user cannot refer themselves" });
    return;
  }

  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT id FROM public.users
        WHERE id IN ($1, $2)
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [referrerUserId, referredUserId]
    );
    if (users.rows.length !== 2) {
      res.status(400).json({ success: false, message: "Referrer or referred user not found" });
      return;
    }

    await client.query("BEGIN");

    const inserted = { signup: 0, group_join: 0, investment: 0, raise_money_signup: 0 };

    // 1) signup attribution row. The partial unique index
    // idx_referrals_signup_unique_referred_user (migration 003)
    // guarantees at most one signup per referred user even under
    // concurrent admin links — we catch the unique-violation below and
    // surface a 409 if a different referrer raced us. ON CONFLICT DO
    // NOTHING handles the same-referrer idempotent case without raising.
    const signupRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, source_path, created_at)
       VALUES ($1, $2, 'signup', 'admin:manual-link', NOW())
       ON CONFLICT (referred_user_id) WHERE action_type = 'signup'
       DO NOTHING
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.signup = signupRes.rowCount || 0;

    // If our insert was suppressed, confirm the existing row belongs to
    // the same referrer; if not, abort with 409 so we never silently
    // attribute one user's activity to two different referrers.
    if (inserted.signup === 0) {
      const owner = await client.query(
        `SELECT referrer_user_id FROM public.referrals
          WHERE referred_user_id = $1 AND action_type = 'signup'
          LIMIT 1`,
        [referredUserId]
      );
      const existingReferrer = owner.rows[0]?.referrer_user_id;
      if (existingReferrer && existingReferrer !== referrerUserId) {
        await client.query("ROLLBACK");
        res.status(409).json({
          success: false,
          message: "This user is already attributed to a different referrer.",
        });
        return;
      }
    }

    // Back-fill rules:
    //   * One referral event per UNIQUE target (group / campaign).
    //   * If the referred user has multiple accepted memberships for the
    //     same group, or multiple recommendations for the same campaign,
    //     we attribute a single first-touch event using the EARLIEST
    //     timestamp. This matches the existing referrals_first_touch_unique
    //     index on (referred_user_id, action_type, COALESCE(target_id, ''))
    //     and avoids self-conflicting INSERTs within one statement.

    // 2) group_join — DISTINCT ON group_to_follow_id, earliest first.
    const gjRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, source_path, created_at)
       SELECT $1, $2, 'group_join', src.group_id::text,
              'admin:manual-link', COALESCE(src.created_at, NOW())
         FROM (
           SELECT DISTINCT ON (req.group_to_follow_id)
                  req.group_to_follow_id AS group_id,
                  req.created_at
             FROM public.requests req
            WHERE req.request_owner_id = $2
              AND req.status = 'accepted'
              AND (req.is_deleted IS NULL OR req.is_deleted = false)
              AND req.group_to_follow_id IS NOT NULL
            ORDER BY req.group_to_follow_id, req.created_at ASC NULLS LAST
         ) src
        WHERE NOT EXISTS (
          SELECT 1 FROM public.referrals r
           WHERE r.referred_user_id = $2
             AND r.action_type = 'group_join'
             AND r.target_id IS NOT DISTINCT FROM src.group_id::text
        )
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.group_join = gjRes.rowCount || 0;

    // 3) investment — DISTINCT ON campaign_id, earliest first; amount
    // carries over from that earliest recommendation row.
    const invRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, amount, source_path, created_at)
       SELECT $1, $2, 'investment', src.campaign_id::text,
              src.amount,
              'admin:manual-link', COALESCE(src.date_created, NOW())
         FROM (
           SELECT DISTINCT ON (rec.campaign_id)
                  rec.campaign_id,
                  rec.amount,
                  rec.date_created
             FROM public.recommendations rec
            WHERE rec.user_id = $2
              AND (rec.is_deleted IS NULL OR rec.is_deleted = false)
              AND rec.campaign_id IS NOT NULL
            ORDER BY rec.campaign_id, rec.date_created ASC NULLS LAST
         ) src
        WHERE NOT EXISTS (
          SELECT 1 FROM public.referrals r
           WHERE r.referred_user_id = $2
             AND r.action_type = 'investment'
             AND r.target_id IS NOT DISTINCT FROM src.campaign_id::text
        )
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.investment = invRes.rowCount || 0;

    // 4) raise_money_signup — campaigns.id is unique, but DISTINCT ON is
    // cheap defensive insurance against any future schema change.
    const rmRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, source_path, created_at)
       SELECT $1, $2, 'raise_money_signup', src.campaign_id::text,
              'admin:manual-link', COALESCE(src.created_date, NOW())
         FROM (
           SELECT DISTINCT ON (c.id)
                  c.id AS campaign_id,
                  c.created_date
             FROM public.campaigns c
            WHERE c.user_id = $2
              AND (c.is_deleted IS NULL OR c.is_deleted = false)
            ORDER BY c.id, c.created_date ASC NULLS LAST
         ) src
        WHERE NOT EXISTS (
          SELECT 1 FROM public.referrals r
           WHERE r.referred_user_id = $2
             AND r.action_type = 'raise_money_signup'
             AND r.target_id IS NOT DISTINCT FROM src.campaign_id::text
        )
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.raise_money_signup = rmRes.rowCount || 0;

    await client.query("COMMIT");

    const totalNew =
      inserted.signup + inserted.group_join + inserted.investment + inserted.raise_money_signup;

    res.json({
      success: true,
      alreadyLinked: inserted.signup === 0,
      inserted,
      totalNew,
    });
  } catch (err: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    // Unique violation on the signup partial index — another admin
    // attributed this referred user to a different referrer in parallel.
    // Only the signup-uniqueness index implies "different referrer";
    // other unique violations (e.g. first-touch dupes) are real bugs and
    // should surface as 500 so we can fix them rather than misleading
    // the admin.
    if (err?.code === "23505" && err?.constraint === "idx_referrals_signup_unique_referred_user") {
      res.status(409).json({
        success: false,
        message: "This user is already attributed to a different referrer.",
      });
      return;
    }
    console.error("Error linking referral:", err);
    res.status(500).json({ success: false, message: err?.message || "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
export { ACTION_TYPES };
