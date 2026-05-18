import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import dayjs from "dayjs";

const router = Router();

const SOFT_DELETE_FILTER = (alias: string) =>
  `${alias}.is_deleted = false`;

const USER_ROLE = "User";

interface PaginationParams {
  currentPage: number;
  perPage: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: string;
  id?: string;
  type?: string;
}

function parsePagination(query: Record<string, unknown>): PaginationParams {
  const MAX_PER_PAGE = 100;
  let currentPage = parseInt(String(query.CurrentPage || query.currentPage || "1"), 10);
  let perPage = parseInt(String(query.PerPage || query.perPage || "10"), 10);
  if (isNaN(currentPage) || currentPage < 1) currentPage = 1;
  if (isNaN(perPage) || perPage < 1) perPage = 10;
  if (perPage > MAX_PER_PAGE) perPage = MAX_PER_PAGE;

  return {
    currentPage,
    perPage,
    sortField: (query.SortField || query.sortField) as string | undefined,
    sortDirection: (query.SortDirection || query.sortDirection) as string | undefined,
    searchValue: (query.SearchValue || query.searchValue) as string | undefined,
    status: (query.Status || query.status) as string | undefined,
    id: query.id as string | undefined,
    type: query.type as string | undefined,
  };
}

function calculateGrowth(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100 * 100) / 100;
}

router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Fire all four independent aggregations in parallel rather than serially
    // — each round-trip used to add latency on top of the previous one.
    const [recStats, groupStats, userStats, lastMonthUserResult] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN LOWER(TRIM(r.status)) = 'approved' THEN r.amount ELSE 0 END), 0) AS total_approved,
           COUNT(CASE WHEN LOWER(TRIM(r.status)) = 'approved' THEN 1 END) AS approved_count,
           COALESCE(SUM(CASE WHEN r.date_created >= $1 THEN r.amount ELSE 0 END), 0) AS this_month_amount,
           COUNT(CASE WHEN r.date_created >= $1 THEN 1 END) AS this_month_count,
           COALESCE(SUM(CASE WHEN r.date_created >= $2 AND r.date_created < $1 THEN r.amount ELSE 0 END), 0) AS last_month_amount,
           COUNT(CASE WHEN r.date_created >= $2 AND r.date_created < $1 THEN 1 END) AS last_month_count
         FROM recommendations r
         WHERE ${SOFT_DELETE_FILTER("r")}
           AND LOWER(r.user_email) IN (
             SELECT LOWER(u.email) FROM users u
             JOIN user_roles ur ON u.id = ur.user_id
             JOIN roles role ON ur.role_id = role.id
             WHERE role.name = $3
               AND ${SOFT_DELETE_FILTER("u")}
           )`,
        [startOfThisMonth.toISOString(), startOfLastMonth.toISOString(), USER_ROLE]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(CASE WHEN created_at >= $1 AND created_at < $2 THEN 1 END) AS last_month
         FROM groups
         WHERE ${SOFT_DELETE_FILTER("groups")}`,
        [startOfLastMonth.toISOString(), startOfThisMonth.toISOString()]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM users u
         JOIN user_roles ur ON u.id = ur.user_id
         JOIN roles role ON ur.role_id = role.id
         WHERE role.name = $1
           AND ${SOFT_DELETE_FILTER("u")}`,
        [USER_ROLE]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM users u
         WHERE u.date_created >= $1 AND u.date_created < $2
           AND ${SOFT_DELETE_FILTER("u")}`,
        [startOfLastMonth.toISOString(), startOfThisMonth.toISOString()]
      ),
    ]);

    const stats = recStats.rows[0];
    const totalDonations = parseFloat(stats.total_approved) || 0;
    const approvedCount = parseInt(stats.approved_count) || 0;
    const averageDonation = approvedCount === 0 ? 0 : totalDonations / approvedCount;
    const lastMonthDonations = parseFloat(stats.last_month_amount) || 0;
    const thisMonthCount = parseInt(stats.this_month_count) || 0;
    const lastMonthCount = parseInt(stats.last_month_count) || 0;

    const totalGroups = parseInt(groupStats.rows[0].total) || 0;
    const lastMonthGroups = parseInt(groupStats.rows[0].last_month) || 0;
    const totalUsers = parseInt(userStats.rows[0].total) || 0;
    const lastMonthUsers = parseInt(lastMonthUserResult.rows[0].total) || 0;

    const thisMonthDonations = parseFloat(stats.this_month_amount) || 0;
    const thisMonthAvg = thisMonthCount === 0 ? 0 : thisMonthDonations / thisMonthCount;
    const lastMonthAvg = lastMonthCount === 0 ? 0 : lastMonthDonations / lastMonthCount;

    res.json({
      totalDonations: Math.round(totalDonations),
      totalGroups,
      totalUsers,
      averageDonation: Math.round(averageDonation),
      donationGrowthPercentage: calculateGrowth(totalDonations, lastMonthDonations),
      groupGrowthPercentage: calculateGrowth(totalGroups, lastMonthGroups),
      userGrowthPercentage: calculateGrowth(totalUsers, lastMonthUsers),
      avgDonationGrowthPercentage: calculateGrowth(thisMonthAvg, lastMonthAvg),
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/investment-chart", async (req: Request, res: Response) => {
  try {
    const months = req.query.months ? parseInt(String(req.query.months), 10) : null;
    const now = new Date();

    let startDate: Date;
    if (months && months > 0) {
      startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    } else {
      const minResult = await pool.query(
        `SELECT MIN(date_created) AS min_date FROM recommendations r WHERE date_created IS NOT NULL AND ${SOFT_DELETE_FILTER("r")}`
      );
      const minDate = minResult.rows[0]?.min_date;
      if (minDate) {
        const d = new Date(minDate);
        startDate = new Date(d.getFullYear(), d.getMonth(), 1);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    }

    const dataResult = await pool.query(
      `SELECT r.amount, r.date_created, r.user_email
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE role.name = $1
         AND r.status = 'approved'
         AND r.date_created IS NOT NULL
         AND r.date_created >= $2
         AND r.date_created <= $3
         AND ${SOFT_DELETE_FILTER("r")}
         AND ${SOFT_DELETE_FILTER("u")}`,
      [USER_ROLE, startDate.toISOString(), now.toISOString()]
    );

    const data = dataResult.rows;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthlyMap = new Map<string, number>();
    const investorEmails = new Set<string>();

    for (const row of data) {
      const d = dayjs(row.date_created);
      const key = `${d.year()}-${d.month()}`;
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + (parseFloat(row.amount) || 0));
      if (row.user_email) investorEmails.add(row.user_email);
    }

    const chartData: Array<{ month: string; amount: number }> = [];
    let loopDate = dayjs(startDate);
    const nowDayjs = dayjs(now);
    while (loopDate.isBefore(nowDayjs) || loopDate.isSame(nowDayjs)) {
      const key = `${loopDate.year()}-${loopDate.month()}`;
      chartData.push({
        month: monthNames[loopDate.month()],
        amount: Math.round(monthlyMap.get(key) || 0),
      });
      loopDate = loopDate.add(1, "month");
    }

    const totalInvestment = data.reduce((sum: number, r: { amount: string }) => sum + (parseFloat(r.amount) || 0), 0);

    let growthRate = 0;
    if (months && months > 0) {
      const previousStart = new Date(startDate);
      previousStart.setMonth(previousStart.getMonth() - months);
      const previousEnd = new Date(startDate);
      previousEnd.setDate(previousEnd.getDate() - 1);

      const prevResult = await pool.query(
        `SELECT COALESCE(SUM(r.amount), 0) AS total
         FROM recommendations r
         JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
         JOIN user_roles ur ON u.id = ur.user_id
         JOIN roles role ON ur.role_id = role.id
         WHERE role.name = $1
           AND r.status = 'approved'
           AND r.date_created >= $2
           AND r.date_created <= $3
           AND ${SOFT_DELETE_FILTER("r")}
           AND ${SOFT_DELETE_FILTER("u")}`,
        [USER_ROLE, previousStart.toISOString(), previousEnd.toISOString()]
      );
      const previousTotal = parseFloat(prevResult.rows[0].total) || 0;
      growthRate = calculateGrowth(totalInvestment, previousTotal);
    }

    res.json({
      totalDonations: Math.round(totalInvestment),
      totalInvestments: Math.round(totalInvestment),
      growthRate,
      investors: investorEmails.size,
      chartData,
    });
  } catch (err) {
    console.error("Investment chart error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/investment-by-theme", async (_req: Request, res: Response) => {
  try {
    const themes = await pool.query(`SELECT id, name FROM themes`);

    const campaigns = await pool.query(
      `SELECT id, themes FROM campaigns WHERE ${SOFT_DELETE_FILTER("campaigns")}`
    );

    const campaignThemes = campaigns.rows.map((c: { id: number; themes: string | null }) => ({
      id: c.id,
      themeIds: c.themes
        ? c.themes.split(",").map((t: string) => parseInt(t.trim(), 10)).filter((n: number) => !isNaN(n))
        : [],
    }));

    const recResult = await pool.query(
      `SELECT r.campaign_id, r.amount, r.status
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE role.name = $1
         AND (r.status = 'pending' OR r.status = 'approved')
         AND ${SOFT_DELETE_FILTER("r")}
         AND ${SOFT_DELETE_FILTER("u")}`,
      [USER_ROLE]
    );

    const campaignThemeMap = new Map<number, number[]>();
    for (const ct of campaignThemes) {
      campaignThemeMap.set(Number(ct.id), ct.themeIds);
    }

    const themeStats = new Map<number, { name: string; total: number }>();
    for (const theme of themes.rows) {
      themeStats.set(Number(theme.id), { name: theme.name, total: 0 });
    }

    for (const rec of recResult.rows) {
      const themeIds = campaignThemeMap.get(Number(rec.campaign_id)) || [];
      if (themeIds.length === 0) continue;
      const splitAmount = (parseFloat(rec.amount) || 0) / themeIds.length;
      for (const themeId of themeIds) {
        const stat = themeStats.get(themeId);
        if (stat) {
          stat.total += splitAmount;
        }
      }
    }

    const results = Array.from(themeStats.values())
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);

    const grandTotal = results.reduce((sum, s) => sum + s.total, 0);

    const response = results.map((s) => ({
      name: s.name,
      totalAmount: Math.round(s.total * 100) / 100,
      percentage: grandTotal === 0 ? 0 : Math.round((s.total / grandTotal) * 100),
    }));

    res.json(response);
  } catch (err) {
    console.error("Investment by theme error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/recent-investments", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const sortColumns: Record<string, string> = {
      investor: "investor",
      investment: "investment",
      amount: "r.amount",
      status: "r.status",
      date: "r.date_created",
    };
    const orderBy = sortColumns[params.sortField?.toLowerCase() || ""] || "r.date_created";
    const orderDir = isAsc ? "ASC" : "DESC";

    const conditions: string[] = [
      `role.name = $1`,
      SOFT_DELETE_FILTER("r"),
      SOFT_DELETE_FILTER("u"),
      SOFT_DELETE_FILTER("c"),
    ];
    const values: (string | number)[] = [USER_ROLE];
    let paramIdx = 2;

    if (params.searchValue) {
      conditions.push(
        `(LOWER(u.first_name || ' ' || u.last_name) LIKE $${paramIdx} OR LOWER(u.user_name) LIKE $${paramIdx} OR LOWER(c.name) LIKE $${paramIdx})`
      );
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    if (params.status) {
      conditions.push(`r.status = $${paramIdx}`);
      values.push(params.status);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN campaigns c ON r.campaign_id = c.id
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         u.first_name || ' ' || u.last_name AS investor,
         u.first_name AS first_name,
         u.email AS email,
         '@' || u.user_name AS "userName",
         c.name AS investment,
         COALESCE(r.amount, 0) AS amount,
         r.status,
         r.date_created
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN campaigns c ON r.campaign_id = c.id
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((row: { investor: string; first_name: string | null; email: string | null; userName: string; investment: string; amount: string; status: string; date_created: string }) => {
      const d = row.date_created ? dayjs(row.date_created) : null;
      return {
        investor: row.investor,
        firstName: row.first_name || "",
        email: row.email || "",
        userName: row.userName,
        investment: row.investment,
        amount: Math.round(parseFloat(row.amount) || 0),
        status: row.status,
        date: d && d.isValid() ? d.format("MMM DD") : "",
      };
    });

    res.json({
      totalCount: parseInt(countResult.rows[0].total) || 0,
      items,
    });
  } catch (err) {
    console.error("Recent investments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/top-donors", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const sortColumns: Record<string, string> = {
      donor: "donor",
      amount: "amount",
      donations: "donations",
    };
    const orderBy = sortColumns[params.sortField?.toLowerCase() || ""] || "donations";
    const orderDir = isAsc ? "ASC" : "DESC";

    const conditions: string[] = [
      `role.name = $1`,
      `r.status = 'approved'`,
      SOFT_DELETE_FILTER("r"),
      SOFT_DELETE_FILTER("u"),
    ];
    const values: (string | number)[] = [USER_ROLE];
    let paramIdx = 2;

    if (params.searchValue) {
      conditions.push(`LOWER(u.first_name || ' ' || u.last_name) LIKE $${paramIdx}`);
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT u.id) AS total
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         u.first_name || ' ' || u.last_name AS donor,
         COALESCE(SUM(r.amount), 0) AS amount,
         COUNT(*) AS donations
       FROM recommendations r
       JOIN users u ON LOWER(r.user_email) = LOWER(u.email)
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((row: { donor: string; amount: string; donations: string }) => ({
      donor: row.donor,
      amount: Math.round(parseFloat(row.amount) || 0),
      donations: parseInt(row.donations) || 0,
    }));

    res.json({
      totalCount: parseInt(countResult.rows[0].total) || 0,
      items,
    });
  } catch (err) {
    console.error("Top donors error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/top-groups", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const sortColumns: Record<string, string> = {
      group: "group_name",
      investment: "total_investment",
      members: "members",
    };
    const orderBy = sortColumns[params.sortField?.toLowerCase() || ""] || "total_investment";
    const orderDir = isAsc ? "ASC" : "DESC";

    const conditions: string[] = [
      `role.name = $1`,
      `log.group_id IS NOT NULL`,
      `(log.new_value - log.old_value) > 0`,
      SOFT_DELETE_FILTER("g"),
      SOFT_DELETE_FILTER("u"),
    ];
    const values: (string | number)[] = [USER_ROLE];
    let paramIdx = 2;

    if (params.searchValue) {
      conditions.push(`LOWER(g.name) LIKE $${paramIdx}`);
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT g.id) AS total
       FROM groups g
       JOIN account_balance_change_logs log ON g.id = log.group_id
       JOIN users u ON log.user_id = u.id
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         g.id AS group_id,
         g.name AS group_name,
         COALESCE(SUM(log.new_value - log.old_value), 0) AS total_investment,
         (SELECT COUNT(*) FROM requests req WHERE req.group_to_follow_id = g.id AND req.status = 'accepted' AND req.is_deleted = false) AS members
       FROM groups g
       JOIN account_balance_change_logs log ON g.id = log.group_id
       JOIN users u ON log.user_id = u.id
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles role ON ur.role_id = role.id
       WHERE ${whereClause}
       GROUP BY g.id, g.name
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((row: { group_name: string; total_investment: string; members: string }) => ({
      group: row.group_name,
      investment: Math.round(parseFloat(row.total_investment) || 0),
      members: parseInt(row.members) || 0,
    }));

    res.json({
      totalCount: parseInt(countResult.rows[0].total) || 0,
      items,
    });
  } catch (err) {
    console.error("Top groups error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/audit-logs", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let paramIdx = 1;

    if (params.type) {
      conditions.push(`LOWER(TRIM(a.table_name)) = LOWER(TRIM($${paramIdx}))`);
      values.push(params.type as string);
      paramIdx++;
    }

    if (params.id) {
      conditions.push(`a.record_id = $${paramIdx}`);
      values.push(params.id);
      paramIdx++;
    }

    if (params.searchValue) {
      conditions.push(
        `(LOWER(a.table_name) LIKE $${paramIdx} OR LOWER(a.action_type) LIKE $${paramIdx} OR LOWER(COALESCE(
          CASE
            WHEN a.table_name IN ('AspNetUsers', 'users') THEN COALESCE(usr.first_name || ' ' || usr.last_name, a.record_id)
            WHEN a.table_name IN ('Campaigns', 'campaigns') THEN COALESCE(camp.name, a.record_id)
            WHEN a.table_name IN ('Groups', 'groups') THEN COALESCE(grp.name, a.record_id)
            ELSE a.record_id
          END, '')) LIKE $${paramIdx})`
      );
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortColumns: Record<string, string> = {
      actiontype: "a.action_type",
      updatedat: "a.updated_at",
    };
    const orderBy = sortColumns[params.sortField?.toLowerCase() || ""] || "a.updated_at";
    const orderDir = isAsc ? "ASC" : "DESC";

    const identifierJoins = `
       LEFT JOIN users usr ON a.record_id = usr.id AND a.table_name IN ('AspNetUsers', 'users')
       LEFT JOIN campaigns camp ON a.record_id = camp.id::text AND a.table_name IN ('Campaigns', 'campaigns')
       LEFT JOIN groups grp ON a.record_id = grp.id::text AND a.table_name IN ('Groups', 'groups')`;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs a ${identifierJoins} ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         a.table_name AS "tableName",
         a.record_id,
         CASE
           WHEN a.table_name IN ('AspNetUsers', 'users') THEN COALESCE(usr.first_name || ' ' || usr.last_name, a.record_id)
           WHEN a.table_name IN ('Campaigns', 'campaigns') THEN COALESCE(camp.name, a.record_id)
           WHEN a.table_name IN ('Groups', 'groups') THEN COALESCE(grp.name, a.record_id)
           ELSE a.record_id
         END AS identifier,
         a.action_type AS "actionType",
         a.old_values AS "oldValues",
         a.new_values AS "newValues",
         a.changed_columns AS "changedColumns",
         upd.user_name AS "updatedBy",
         TO_CHAR(a.updated_at, 'DD Mon YYYY HH12:MI AM') AS "updatedAt"
       FROM audit_logs a
       LEFT JOIN users upd ON a.updated_by = upd.id
       ${identifierJoins}
       ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((item: Record<string, string | null>) => ({
      ...item,
      oldValues: formatJsonDates(item.oldValues),
      newValues: formatJsonDates(item.newValues),
    }));

    res.json({
      totalCount: parseInt(countResult.rows[0].total) || 0,
      items,
    });
  } catch (err) {
    console.error("Audit logs error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

interface DbRow { [key: string]: string | number | boolean | null }

interface UserFullDataRow {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  user_name: string;
  account_balance: string | null;
  email: string;
  is_active: boolean;
  date_created: string | null;
}

interface IdNameRow { id: number; name: string }

interface RecRow extends DbRow { campaign_id: number | null }
interface ReturnRow extends DbRow {
  campaign_id: number | null;
  private_debt_start_date: string | null;
  private_debt_end_date: string | null;
  post_date: string | null;
}
interface CompletedInvRow extends DbRow {
  campaign_id: number | null;
  associated_fund_id: number | null;
  theme_ids: string | null;
  type_of_investment: string | null;
  amount: string | null;
}
interface AchRow extends DbRow { user_id: string | null }
interface StatusRow extends DbRow { status: string | null; campaign_id: number | null }

function parseCommaSeparatedIds(str: string | null): number[] {
  if (!str) return [];
  return str.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

function addCampaignName<T extends { campaign_id: number | null }>(
  row: T,
  dict: Map<number, string>
): T & { campaignName: string | null } {
  return {
    ...row,
    campaignName: row.campaign_id ? dict.get(Number(row.campaign_id)) || null : null,
  };
}

router.get("/user-full-data", async (req: Request, res: Response) => {
  try {
    const email = (req.query.email as string) || "";
    if (!email) {
      return res.json({ success: false, message: "Email or username is required." });
    }

    const searchParam = `%${email.toLowerCase()}%`;

    const usersResult = await pool.query<UserFullDataRow>(
      `SELECT id, first_name, last_name, first_name || ' ' || last_name AS full_name,
              user_name, account_balance, email, is_active, date_created
       FROM users
       WHERE (LOWER(email) LIKE $1 OR LOWER(user_name) LIKE $1)
         AND (is_deleted IS NULL OR is_deleted = false)`,
      [searchParam]
    );

    if (usersResult.rows.length === 0) {
      return res.json({ success: false, message: "No users found." });
    }

    const themesResult = await pool.query<IdNameRow>(`SELECT id, name FROM themes`);
    const investmentTypesResult = await pool.query<IdNameRow>(`SELECT id, name FROM investment_instruments`);
    const themes = themesResult.rows;
    const investmentTypes = investmentTypesResult.rows;

    const campaignDictResult = await pool.query<IdNameRow>(`SELECT id, name FROM campaigns`);
    const campaignDict = new Map<number, string>();
    for (const c of campaignDictResult.rows) {
      campaignDict.set(Number(c.id), c.name);
    }

    const userDictResult = await pool.query<{ id: string; email: string; first_name: string; last_name: string; user_name: string }>(
      `SELECT id, email, first_name, last_name, user_name FROM users WHERE (is_deleted IS NULL OR is_deleted = false)`
    );
    const userDict = new Map<string, { email: string; firstName: string; lastName: string; userName: string }>();
    for (const u of userDictResult.rows) {
      userDict.set(String(u.id).toLowerCase(), {
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        userName: u.user_name,
      });
    }

    const result: Record<string, unknown>[] = [];

    for (const user of usersResult.rows) {
      const userId = user.id;
      const userEmail = user.email;

      const campaignsResult = await pool.query<DbRow>(
        `SELECT id, name, stage, fundraising_close_date, created_date
         FROM campaigns WHERE user_id = $1 AND ${SOFT_DELETE_FILTER("campaigns")} ORDER BY TRIM(name)`,
        [userId]
      );
      const campaignIds = campaignsResult.rows.map((c) => Number(c.id));

      const recommendationsResult = await pool.query<RecRow>(
        `SELECT id, user_full_name, user_email, status, amount, date_created, campaign_id
         FROM recommendations WHERE user_id = $1 AND ${SOFT_DELETE_FILTER("recommendations")} ORDER BY id DESC`,
        [userId]
      );

      const accountLogsResult = await pool.query<RecRow>(
        `SELECT id, user_name, user_id, payment_type, old_value, new_value,
                change_date, fees, gross_amount, net_amount, campaign_id
         FROM account_balance_change_logs WHERE user_id = $1 ORDER BY id DESC`,
        [userId]
      );

      let investmentNotesRows: RecRow[] = [];
      if (campaignIds.length > 0) {
        const investmentNotesResult = await pool.query<RecRow>(
          `SELECT i.id, u2.user_name, i.campaign_id, i.old_status, i.new_status, i.note, i.created_at
           FROM investment_notes i
           LEFT JOIN users u2 ON i.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE i.campaign_id = ANY($1) ORDER BY i.id DESC`,
          [campaignIds]
        );
        investmentNotesRows = investmentNotesResult.rows;
      }

      const disbursalsResult = await pool.query<RecRow>(
        `SELECT d.id, u2.email, d.role, d.distributed_amount, d.created_at, d.campaign_id
         FROM disbursal_requests d
         LEFT JOIN users u2 ON d.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
         WHERE d.user_id = $1 AND ${SOFT_DELETE_FILTER("d")} ORDER BY d.id DESC`,
        [userId]
      );
      const disbursalIds = disbursalsResult.rows.map((d) => Number(d.id));

      let disbursalNotesRows: DbRow[] = [];
      if (disbursalIds.length > 0) {
        const disbursalNotesResult = await pool.query<DbRow>(
          `SELECT dn.id, dn.note, u2.user_name, dn.created_at
           FROM disbursal_request_notes dn
           LEFT JOIN users u2 ON dn.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE dn.disbursal_request_id = ANY($1) ORDER BY dn.id DESC`,
          [disbursalIds]
        );
        disbursalNotesRows = disbursalNotesResult.rows;
      }

      const pendingGrantsResult = await pool.query<StatusRow>(
        `SELECT p.id, u2.first_name, u2.last_name, u2.email, p.amount, p.amount_after_fees,
                p.daf_name, p.daf_provider, p.status, p.created_date, p.campaign_id
         FROM pending_grants p
         LEFT JOIN users u2 ON p.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
         WHERE p.user_id = $1 AND ${SOFT_DELETE_FILTER("p")} ORDER BY p.id DESC`,
        [userId]
      );
      const pendingIds = pendingGrantsResult.rows.map((p) => Number(p.id));

      let pendingNotesRows: DbRow[] = [];
      if (pendingIds.length > 0) {
        const pendingNotesResult = await pool.query<DbRow>(
          `SELECT pn.id, u2.user_name, pn.note, pn.old_status, pn.new_status, pn.created_at
           FROM pending_grant_notes pn
           LEFT JOIN users u2 ON pn.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE pn.pending_grant_id = ANY($1) ORDER BY pn.id DESC`,
          [pendingIds]
        );
        pendingNotesRows = pendingNotesResult.rows;
      }

      const assetRequestsResult = await pool.query<RecRow>(
        `SELECT a.id, u2.first_name, u2.last_name, u2.email,
                COALESCE(NULLIF(a.asset_description, ''), at.type) AS asset_type,
                a.approximate_amount, a.received_amount, a.contact_method, a.contact_value,
                a.status, a.created_at, a.campaign_id
         FROM asset_based_payment_requests a
         LEFT JOIN users u2 ON a.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
         LEFT JOIN asset_types at ON a.asset_type_id = at.id
         WHERE a.user_id = $1 AND ${SOFT_DELETE_FILTER("a")} ORDER BY a.id DESC`,
        [userId]
      );
      const assetIds = assetRequestsResult.rows.map((a) => Number(a.id));

      let assetNotesRows: DbRow[] = [];
      if (assetIds.length > 0) {
        const assetNotesResult = await pool.query<DbRow>(
          `SELECT an.id, u2.user_name, an.old_status, an.new_status, an.note, an.created_at
           FROM asset_based_payment_request_notes an
           LEFT JOIN users u2 ON an.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE an.request_id = ANY($1) ORDER BY an.id DESC`,
          [assetIds]
        );
        assetNotesRows = assetNotesResult.rows;
      }

      let returnRows: ReturnRow[] = [];
      if (campaignIds.length > 0) {
        const returnsResult = await pool.query<ReturnRow>(
          `SELECT rm.id, rm.status, rm.post_date, rm.memo_note, rm.campaign_id,
                  rm.private_debt_start_date, rm.private_debt_end_date,
                  rd.investment_amount, rd.percentage_of_total_investment AS percentage,
                  rd.return_amount AS returned_amount,
                  u2.first_name, u2.last_name, u2.email
           FROM return_masters rm
           JOIN return_details rd ON rm.id = rd.return_master_id
           LEFT JOIN users u2 ON rd.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE rm.campaign_id = ANY($1) AND ${SOFT_DELETE_FILTER("rm")} ORDER BY rm.id DESC`,
          [campaignIds]
        );
        returnRows = returnsResult.rows;
      }

      let completedInvestmentRows: CompletedInvRow[] = [];
      if (campaignIds.length > 0) {
        const completedResult = await pool.query<CompletedInvRow>(
          `SELECT ci.id, ci.date_of_last_investment, ci.campaign_id,
                  c.stage, c.associated_fund_id, c.themes AS theme_ids,
                  ci.investment_detail, ci.amount, ci.type_of_investment, ci.donors
           FROM completed_investment_details ci
           LEFT JOIN campaigns c ON ci.campaign_id = c.id
           WHERE ci.campaign_id = ANY($1) AND ${SOFT_DELETE_FILTER("ci")} ORDER BY ci.id DESC`,
          [campaignIds]
        );
        completedInvestmentRows = completedResult.rows;
      }

      const completedIds = completedInvestmentRows.map((c) => Number(c.id));
      let completedNotesRows: DbRow[] = [];
      if (completedIds.length > 0) {
        const completedNotesResult = await pool.query<DbRow>(
          `SELECT cn.id, u2.user_name, cn.transaction_type, cn.note, cn.new_amount, cn.old_amount, cn.created_at
           FROM completed_investment_notes cn
           LEFT JOIN users u2 ON cn.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE cn.completed_investment_id = ANY($1) ORDER BY cn.id DESC`,
          [completedIds]
        );
        completedNotesRows = completedNotesResult.rows;
      }

      const achResult = await pool.query<AchRow>(
        `SELECT id, user_id, amount, transaction_id, created_date, status, country
         FROM user_stripe_transaction_mappings WHERE user_id = $1 ORDER BY created_date DESC`,
        [userId]
      );

      const formResult = await pool.query<DbRow>(
        `SELECT id, form_type, first_name, last_name, email, created_at, status
         FROM form_submissions WHERE email = $1 AND ${SOFT_DELETE_FILTER("form_submissions")} ORDER BY id DESC`,
        [userEmail]
      );
      const formIds = formResult.rows.map((f) => Number(f.id));

      let formNotesRows: DbRow[] = [];
      if (formIds.length > 0) {
        const formNotesResult = await pool.query<DbRow>(
          `SELECT fn.id, fn.note, u2.user_name, fn.old_status, fn.new_status, fn.created_at
           FROM form_submission_notes fn
           LEFT JOIN users u2 ON fn.user_id = u2.id AND (u2.is_deleted IS NULL OR u2.is_deleted = false)
           WHERE fn.form_submission_id = ANY($1) ORDER BY fn.id DESC`,
          [formIds]
        );
        formNotesRows = formNotesResult.rows;
      }

      result.push({
        user,
        campaigns: campaignsResult.rows,
        recommendations: recommendationsResult.rows.map((r) => addCampaignName(r, campaignDict)),
        accountLogs: accountLogsResult.rows.map((a) => addCampaignName(a, campaignDict)),
        investmentNotes: investmentNotesRows.map((i) => addCampaignName(i, campaignDict)),
        disbursals: disbursalsResult.rows.map((d) => addCampaignName(d, campaignDict)),
        disbursalNotes: disbursalNotesRows,
        pendingGrants: pendingGrantsResult.rows.map((p) => ({
          ...addCampaignName(p, campaignDict),
          status: p.status || "Pending",
        })),
        pendingGrantNotes: pendingNotesRows,
        assetRequests: assetRequestsResult.rows.map((a) => addCampaignName(a, campaignDict)),
        assetRequestNotes: assetNotesRows,
        returns: returnRows.map((r) => ({
          ...addCampaignName(r, campaignDict),
          dateRange: r.private_debt_start_date && r.private_debt_end_date
            ? `${dayjs(r.private_debt_start_date).format("MM/DD/YY")}-${dayjs(r.private_debt_end_date).format("MM/DD/YY")}`
            : null,
          postDateFormatted: r.post_date ? dayjs(r.post_date).format("MM/DD/YY") : null,
        })),
        completedInvestments: completedInvestmentRows.map((c) => {
          const themeIds = parseCommaSeparatedIds(c.theme_ids);
          const invTypeIds = parseCommaSeparatedIds(c.type_of_investment);
          const themeNames = themes
            .filter((t) => themeIds.includes(Number(t.id)))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .map((t) => t.name);
          const investmentTypeNames = investmentTypes
            .filter((i) => invTypeIds.includes(Number(i.id)))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .map((i) => i.name);
          return {
            id: c.id,
            dateOfLastInvestment: c.date_of_last_investment,
            campaignName: c.campaign_id ? campaignDict.get(Number(c.campaign_id)) || null : null,
            stage: c.stage,
            cataCapFund: c.associated_fund_id ? campaignDict.get(Number(c.associated_fund_id)) || null : null,
            investmentDetail: c.investment_detail,
            amount: Math.round(parseFloat(String(c.amount)) || 0),
            typeOfInvestment: investmentTypeNames.join(", "),
            donors: c.donors,
            themes: themeNames.join(", "),
          };
        }),
        completedInvestmentNotes: completedNotesRows,
        achPayments: achResult.rows.map((a) => {
          const u = userDict.get(String(a.user_id).toLowerCase());
          return {
            ...a,
            email: u?.email || null,
            userName: u?.userName || null,
            firstName: u?.firstName || null,
            lastName: u?.lastName || null,
          };
        }),
        formSubmission: formResult.rows,
        formSubmissionNotes: formNotesRows,
      });
    }

    res.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    console.error("User full data error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

function formatJsonDates(json: string | null): string | null {
  if (!json) return json;
  try {
    const dict = JSON.parse(json);
    if (!dict || typeof dict !== "object") return json;
    for (const key of Object.keys(dict)) {
      const val = dict[key];
      if (typeof val !== "string" || val.length < 8 || val.length > 40) continue;
      if (/^\d+$/.test(val.trim())) continue;
      const d = dayjs(val);
      if (!d.isValid()) continue;
      if (d.year() < 1900 || d.year() > 2100) continue;
      dict[key] = d.format("DD MMM YYYY hh:mm A");
    }
    return JSON.stringify(dict);
  } catch {
    return json;
  }
}

export default router;
