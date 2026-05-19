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
  investments: "investments",
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
         ru.id AS referred_user_id,
         ru.first_name AS referred_first_name,
         ru.last_name AS referred_last_name,
         ru.email AS referred_email,
         CASE
           WHEN r.action_type = 'investment' AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT c.name FROM public.campaigns c WHERE c.id = r.target_id::int)
           WHEN r.action_type = 'group_join' AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT g.name FROM public.groups g WHERE g.id = r.target_id::int)
           ELSE NULL
         END AS target_name,
         CASE
           WHEN r.action_type = 'investment' AND r.target_id ~ '^[0-9]+$'
             THEN (SELECT c.property FROM public.campaigns c WHERE c.id = r.target_id::int)
           ELSE NULL
         END AS target_slug
       FROM public.referrals r
       LEFT JOIN public.users ru ON ru.id = r.referred_user_id
       WHERE r.referrer_user_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
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
      referredUserId: r.referred_user_id || null,
      referredFirstName: r.referred_first_name || "",
      referredLastName: r.referred_last_name || "",
      referredFullName: `${r.referred_first_name || ""} ${r.referred_last_name || ""}`.trim(),
      referredEmail: r.referred_email || "",
    }));

    res.json({ success: true, referrer, items });
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

    // 2) group_join — every accepted, non-deleted membership the referred user has
    const gjRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, source_path, created_at)
       SELECT $1, $2, 'group_join', req.group_to_follow_id::text,
              'admin:manual-link', COALESCE(req.created_at, NOW())
         FROM public.requests req
        WHERE req.request_owner_id = $2
          AND req.status = 'accepted'
          AND (req.is_deleted IS NULL OR req.is_deleted = false)
          AND req.group_to_follow_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.referrals r
             WHERE r.referred_user_id = $2
               AND r.action_type = 'group_join'
               AND r.target_id IS NOT DISTINCT FROM req.group_to_follow_id::text
          )
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.group_join = gjRes.rowCount || 0;

    // 3) investment — every non-deleted recommendation made by the referred user
    const invRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, amount, source_path, created_at)
       SELECT $1, $2, 'investment', rec.campaign_id::text,
              rec.amount,
              'admin:manual-link', COALESCE(rec.date_created, NOW())
         FROM public.recommendations rec
        WHERE rec.user_id = $2
          AND (rec.is_deleted IS NULL OR rec.is_deleted = false)
          AND rec.campaign_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.referrals r
             WHERE r.referred_user_id = $2
               AND r.action_type = 'investment'
               AND r.target_id IS NOT DISTINCT FROM rec.campaign_id::text
          )
       RETURNING id`,
      [referrerUserId, referredUserId]
    );
    inserted.investment = invRes.rowCount || 0;

    // 4) raise_money_signup — every non-deleted campaign owned by the referred user
    const rmRes = await client.query(
      `INSERT INTO public.referrals
         (referrer_user_id, referred_user_id, action_type, target_id, source_path, created_at)
       SELECT $1, $2, 'raise_money_signup', c.id::text,
              'admin:manual-link', COALESCE(c.created_date, NOW())
         FROM public.campaigns c
        WHERE c.user_id = $2
          AND (c.is_deleted IS NULL OR c.is_deleted = false)
          AND NOT EXISTS (
            SELECT 1 FROM public.referrals r
             WHERE r.referred_user_id = $2
               AND r.action_type = 'raise_money_signup'
               AND r.target_id IS NOT DISTINCT FROM c.id::text
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
    if (err?.code === "23505") {
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
