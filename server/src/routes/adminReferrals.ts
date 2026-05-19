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
    `;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT u.id ${baseFrom} GROUP BY u.id
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

export default router;
export { ACTION_TYPES };
