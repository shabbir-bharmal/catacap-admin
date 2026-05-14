import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, buildSortClause } from "../utils/softDelete.js";
import crypto from "crypto";
import ExcelJS from "exceljs";
import { uploadBase64Image, resolveFileUrl, extractStoragePath } from "../utils/uploadBase64Image.js";
import { logAudit } from "../utils/auditLog.js";
import { modulePermission } from "../middleware/jwtAuth.js";
import { sendTemplateEmail } from "../utils/emailService.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

const STAGE_LABELS: Record<number, string> = {
  1: "Private",
  2: "Public",
  3: "Closed - Invested",
  4: "Closed - Not Invested",
  5: "New",
  6: "Compliance Review",
  7: "Completed - Ongoing",
  8: "Vetting",
  9: "Completed - Ongoing/Private",
};

const COMPLETED_STAGES = [3, 7, 9];
const PUBLIC_STAGES = [2, 7];

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = !params.sortDirection || params.sortDirection.toLowerCase() === "asc";
    const page = params.currentPage;
    const pageSize = params.perPage;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    softDeleteFilter("g", params.isDeleted, conditions);

    const activeFilter = ((req.query.ActiveFilter as string) || (req.query.activeFilter as string) || "").toLowerCase();
    if (activeFilter === "active") {
      conditions.push(`(g.is_deactivated IS NULL OR g.is_deactivated = false)`);
    } else if (activeFilter === "inactive") {
      conditions.push(`g.is_deactivated = true`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.identifier, g.is_deactivated, g.is_corporate_group,
              g.is_private_group, g.featured_group, g.leaders, g.group_themes,
              g.meta_title, g.meta_description, g.deleted_at,
              g.deleted_by, g.owner_id
       FROM groups g
       ${whereClause}`,
      values
    );

    if (groupsResult.rows.length === 0) {
      res.json({ items: [], totalCount: 0 });
      return;
    }

    const groups = groupsResult.rows;
    const groupIds = groups.map((g: any) => g.id);

    const userIdsToResolve: string[] = [];
    for (const g of groups) {
      if (g.owner_id) userIdsToResolve.push(g.owner_id);
      if (g.leaders) {
        try {
          const parsed = JSON.parse(g.leaders);
          for (const l of parsed) {
            if (l.UserId || l.userId) userIdsToResolve.push(l.UserId || l.userId);
          }
        } catch {}
      }
    }

    let userNameLookup: Record<string, string> = {};
    if (userIdsToResolve.length > 0) {
      const uniqueIds = [...new Set(userIdsToResolve)];
      const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(", ");
      const userResult = await pool.query(
        `SELECT id, COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as full_name FROM users WHERE id IN (${placeholders})`,
        uniqueIds
      );
      for (const row of userResult.rows) {
        userNameLookup[row.id] = (row.full_name || '').trim();
      }
    }

    const memberPlaceholders = groupIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
    // Pull the raw user IDs per group so we can dedupe owner / leaders against
    // accepted request members (someone can be both an owner and a member).
    const memberRowsResult = await pool.query(
      `SELECT group_to_follow_id, request_owner_id
       FROM requests
       WHERE group_to_follow_id IN (${memberPlaceholders})
         AND status = 'accepted'
         AND (is_deleted IS NULL OR is_deleted = false)`,
      groupIds
    );
    const memberUserIdsByGroup: Record<number, Set<string>> = {};
    for (const row of memberRowsResult.rows) {
      if (!memberUserIdsByGroup[row.group_to_follow_id]) {
        memberUserIdsByGroup[row.group_to_follow_id] = new Set<string>();
      }
      if (row.request_owner_id) {
        memberUserIdsByGroup[row.group_to_follow_id].add(row.request_owner_id);
      }
    }

    const memberInvestedResult = await pool.query(
      `SELECT req.group_to_follow_id, COALESCE(SUM(r.amount), 0) AS total
       FROM requests req
       JOIN recommendations r
         ON r.user_id = req.request_owner_id
        AND (r.is_deleted IS NULL OR r.is_deleted = false)
       WHERE req.group_to_follow_id IN (${memberPlaceholders})
         AND req.status = 'accepted'
         AND (req.is_deleted IS NULL OR req.is_deleted = false)
       GROUP BY req.group_to_follow_id`,
      groupIds
    );
    const memberInvestedTotals: Record<number, number> = {};
    for (const row of memberInvestedResult.rows) {
      memberInvestedTotals[row.group_to_follow_id] = parseFloat(row.total) || 0;
    }

    const cgPlaceholders = groupIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
    const cgResult = await pool.query(
      `SELECT cg.groups_id, c.id as campaign_id, c.is_active, c.stage
       FROM campaign_groups cg
       JOIN campaigns c ON cg.campaigns_id = c.id
       WHERE cg.groups_id IN (${cgPlaceholders})
         AND (c.is_deleted IS NULL OR c.is_deleted = false)
       UNION
       SELECT c.group_for_private_access_id as groups_id, c.id as campaign_id, c.is_active, c.stage
       FROM campaigns c
       WHERE c.group_for_private_access_id IN (${cgPlaceholders})
         AND (c.is_deleted IS NULL OR c.is_deleted = false)`,
      groupIds
    );

    const campaignsByGroup: Record<number, any[]> = {};
    for (const row of cgResult.rows) {
      if (!campaignsByGroup[row.groups_id]) campaignsByGroup[row.groups_id] = [];
      campaignsByGroup[row.groups_id].push(row);
    }

    let deletedByLookup: Record<string, string> = {};
    const deletedByIds = groups.filter((g: any) => g.deleted_by).map((g: any) => g.deleted_by);
    if (deletedByIds.length > 0) {
      const uniqueDeletedIds = [...new Set(deletedByIds)] as string[];
      const dPlaceholders = uniqueDeletedIds.map((_, i) => `$${i + 1}`).join(", ");
      const dResult = await pool.query(
        `SELECT id, COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as full_name FROM users WHERE id IN (${dPlaceholders})`,
        uniqueDeletedIds
      );
      for (const row of dResult.rows) {
        deletedByLookup[row.id] = row.full_name;
      }
    }

    let result = groups.map((g: any) => {
      let leaderNames: string[] = [];
      const leaderUserIds: string[] = [];
      if (g.leaders) {
        try {
          const parsed = JSON.parse(g.leaders);
          for (const l of parsed) {
            const uid = l.UserId || l.userId;
            if (uid) {
              leaderUserIds.push(uid);
              if (userNameLookup[uid]) leaderNames.push(userNameLookup[uid]);
            }
          }
        } catch {}
      }

      const ownerName = g.owner_id ? (userNameLookup[g.owner_id] || "") : "";

      // Member count = distinct user IDs across accepted requests + owner + leaders.
      // Using a Set dedupes the case where the owner or a leader also has an
      // accepted request row.
      const allMemberIds = new Set<string>(memberUserIdsByGroup[g.id] || []);
      if (g.owner_id) allMemberIds.add(g.owner_id);
      for (const uid of leaderUserIds) allMemberIds.add(uid);

      const campaigns = campaignsByGroup[g.id] || [];
      const activeCampaigns = campaigns.filter((c: any) => c.is_active === true);
      const completedCampaigns = campaigns.filter((c: any) => COMPLETED_STAGES.includes(c.stage));
      const allCampaignIds = new Set([
        ...activeCampaigns.map((c: any) => c.campaign_id),
        ...completedCampaigns.map((c: any) => c.campaign_id),
      ]);

      return {
        id: g.id,
        name: g.name,
        identifier: g.identifier,
        isDeactivated: g.is_deactivated || false,
        isCorporateGroup: g.is_corporate_group || false,
        isPrivateGroup: g.is_private_group || false,
        featuredGroup: g.featured_group || false,
        leader: leaderNames.join(", "),
        groupOwner: ownerName,
        groupOwnerId: g.owner_id || null,
        member: allMemberIds.size,
        memberInvestedTotal: memberInvestedTotals[g.id] || 0,
        groupThemes: g.group_themes,
        investment: allCampaignIds.size,
        metaTitle: g.meta_title,
        metaDescription: g.meta_description,
        deletedAt: g.deleted_at,
        deletedBy: g.deleted_by ? deletedByLookup[g.deleted_by] || null : null,
      };
    });

    const searchValue = params.searchValue?.trim().toLowerCase();
    if (searchValue) {
      result = result.filter(
        (u: any) =>
          (u.name || "").toLowerCase().includes(searchValue) ||
          (u.groupOwner || "").toLowerCase().includes(searchValue) ||
          (u.leader || "").toLowerCase().includes(searchValue)
      );
    }

    const totalCount = result.length;

    const sortField = params.sortField?.toLowerCase();
    const sortFn = (a: any, b: any): number => {
      let valA: any, valB: any;
      switch (sortField) {
        case "groupname":
          valA = (a.name || "").toLowerCase();
          valB = (b.name || "").toLowerCase();
          break;
        case "membercount":
          valA = a.member;
          valB = b.member;
          break;
        case "memberinvestedtotal":
          valA = a.memberInvestedTotal || 0;
          valB = b.memberInvestedTotal || 0;
          break;
        case "investmentcount":
          valA = a.investment;
          valB = b.investment;
          break;
        case "status":
          valA = a.isPrivateGroup ? 1 : 0;
          valB = b.isPrivateGroup ? 1 : 0;
          break;
        case "active":
          valA = a.isDeactivated ? 1 : 0;
          valB = b.isDeactivated ? 1 : 0;
          break;
        case "featuredgroup":
          valA = a.featuredGroup ? 1 : 0;
          valB = b.featuredGroup ? 1 : 0;
          break;
        case "corporategroup":
          valA = a.isCorporateGroup ? 1 : 0;
          valB = b.isCorporateGroup ? 1 : 0;
          if (isAsc) return valB - valA;
          return valA - valB;
        default:
          valA = (a.name || "").toLowerCase();
          valB = (b.name || "").toLowerCase();
          break;
      }
      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    };

    result.sort(sortFn);

    const items = result.slice((page - 1) * pageSize, page * pageSize);
    res.json({ items, totalCount });
  } catch (err) {
    console.error("Get admin groups error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/reports", async (_req: Request, res: Response) => {
  try {
    const FUNDING_THRESHOLDS = [50000, 100000, 200000, 500000, 1000000];

    const [secondMemberResult, totalsResult] = await Promise.all([
      pool.query(
        `WITH ordered AS (
           SELECT req.group_to_follow_id,
                  req.created_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY req.group_to_follow_id
                    ORDER BY req.created_at ASC
                  ) AS rn
           FROM requests req
           JOIN groups g ON g.id = req.group_to_follow_id
           WHERE req.status = 'accepted'
             AND (req.is_deleted IS NULL OR req.is_deleted = false)
             AND req.created_at IS NOT NULL
             AND (g.is_deleted IS NULL OR g.is_deleted = false)
         )
         SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
                COUNT(*)::int AS new_groups
         FROM ordered
         WHERE rn = 2
         GROUP BY date_trunc('month', created_at)
         ORDER BY date_trunc('month', created_at) ASC`
      ),
      pool.query(
        `SELECT COALESCE(SUM(r.amount), 0)::numeric AS total
         FROM requests req
         JOIN recommendations r
           ON r.user_id = req.request_owner_id
          AND (r.is_deleted IS NULL OR r.is_deleted = false)
         JOIN groups g ON g.id = req.group_to_follow_id
         WHERE req.status = 'accepted'
           AND (req.is_deleted IS NULL OR req.is_deleted = false)
           AND (g.is_deleted IS NULL OR g.is_deleted = false)
         GROUP BY req.group_to_follow_id`
      ),
    ]);

    let cumulative = 0;
    const cumulativeMembership = secondMemberResult.rows.map((row: any) => {
      const newGroups = parseInt(row.new_groups, 10) || 0;
      cumulative += newGroups;
      return {
        month: row.month as string,
        newGroups,
        cumulativeGroups: cumulative,
      };
    });

    const groupTotals = totalsResult.rows.map((r: any) => parseFloat(r.total) || 0);
    const fundingBuckets = FUNDING_THRESHOLDS.map((threshold) => ({
      threshold,
      groupCount: groupTotals.filter((t) => t >= threshold).length,
    }));

    res.json({
      cumulativeMembership,
      fundingBuckets,
      totals: {
        groupsWithTwoOrMore: cumulative,
        groupsWithAnyInvestment: groupTotals.filter((t) => t > 0).length,
      },
    });
  } catch (err) {
    console.error("Get group reports error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/group-reporting", modulePermission("groups", "Manage"), async (_req: Request, res: Response) => {
  try {
    const CUTOFF = '2026-01-01';

    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.identifier, g.owner_id, g.leaders
       FROM groups g
       WHERE (g.is_deleted IS NULL OR g.is_deleted = false)
       ORDER BY g.name ASC`
    );

    const groups = groupsResult.rows;
    if (groups.length === 0) {
      res.json({ items: [] });
      return;
    }

    const groupIds = groups.map((g: any) => g.id);
    const ph = groupIds.map((_: any, i: number) => `$${i + 1}`).join(", ");

    const memberRowsResult = await pool.query(
      `SELECT group_to_follow_id, request_owner_id, created_at
       FROM requests
       WHERE group_to_follow_id IN (${ph})
         AND status = 'accepted'
         AND (is_deleted IS NULL OR is_deleted = false)`,
      groupIds
    );
    const memberIdsByGroup: Record<number, Set<string>> = {};
    const memberIdsByCutoff: Record<number, Set<string>> = {};
    for (const row of memberRowsResult.rows) {
      if (!memberIdsByGroup[row.group_to_follow_id]) memberIdsByGroup[row.group_to_follow_id] = new Set();
      if (!memberIdsByCutoff[row.group_to_follow_id]) memberIdsByCutoff[row.group_to_follow_id] = new Set();
      if (row.request_owner_id) {
        memberIdsByGroup[row.group_to_follow_id].add(row.request_owner_id);
        if (row.created_at && new Date(row.created_at) < new Date(CUTOFF)) {
          memberIdsByCutoff[row.group_to_follow_id].add(row.request_owner_id);
        }
      }
    }

    for (const g of groups) {
      if (!memberIdsByGroup[g.id]) memberIdsByGroup[g.id] = new Set();
      if (!memberIdsByCutoff[g.id]) memberIdsByCutoff[g.id] = new Set();
      if (g.owner_id) {
        memberIdsByGroup[g.id].add(g.owner_id);
        memberIdsByCutoff[g.id].add(g.owner_id);
      }
      if (g.leaders) {
        try {
          const parsed = JSON.parse(g.leaders);
          for (const l of parsed) {
            const uid = l.UserId || l.userId;
            if (uid) {
              memberIdsByGroup[g.id].add(uid);
              memberIdsByCutoff[g.id].add(uid);
            }
          }
        } catch {}
      }
    }

    const phOffset = groupIds.map((_: any, i: number) => `$${i + 2}`).join(", ");

    const [throughCutoffResult, throughTodayResult] = await Promise.all([
      pool.query(
        `SELECT req.group_to_follow_id, COALESCE(SUM(r.amount), 0) AS total
         FROM requests req
         JOIN recommendations r
           ON r.user_id = req.request_owner_id
          AND (r.is_deleted IS NULL OR r.is_deleted = false)
          AND r.date_created < $1
         WHERE req.group_to_follow_id IN (${phOffset})
           AND req.status = 'accepted'
           AND (req.is_deleted IS NULL OR req.is_deleted = false)
         GROUP BY req.group_to_follow_id`,
        [CUTOFF, ...groupIds]
      ),
      pool.query(
        `SELECT req.group_to_follow_id, COALESCE(SUM(r.amount), 0) AS total
         FROM requests req
         JOIN recommendations r
           ON r.user_id = req.request_owner_id
          AND (r.is_deleted IS NULL OR r.is_deleted = false)
         WHERE req.group_to_follow_id IN (${ph})
           AND req.status = 'accepted'
           AND (req.is_deleted IS NULL OR req.is_deleted = false)
         GROUP BY req.group_to_follow_id`,
        groupIds
      ),
    ]);

    const cutoffTotals: Record<number, number> = {};
    for (const row of throughCutoffResult.rows) {
      cutoffTotals[row.group_to_follow_id] = parseFloat(row.total) || 0;
    }

    const todayTotals: Record<number, number> = {};
    for (const row of throughTodayResult.rows) {
      todayTotals[row.group_to_follow_id] = parseFloat(row.total) || 0;
    }

    const items = groups.map((g: any) => {
      const throughCutoff = cutoffTotals[g.id] || 0;
      const throughToday = todayTotals[g.id] || 0;
      const increase = Math.round((throughToday - throughCutoff) * 100) / 100;
      const pctIncrease = throughCutoff > 0 ? (increase / throughCutoff) * 100 : (throughToday > 0 ? 100 : 0);

      const membersCutoff = (memberIdsByCutoff[g.id] || new Set()).size;
      const membersToday = (memberIdsByGroup[g.id] || new Set()).size;
      const memberIncrease = membersToday - membersCutoff;
      const memberPctChange = membersCutoff > 0 ? Math.round(((memberIncrease / membersCutoff) * 100) * 100) / 100 : (membersToday > 0 ? 100 : 0);

      return {
        id: g.id,
        name: g.name,
        identifier: g.identifier,
        membersCutoff,
        membersToday,
        memberPctChange,
        throughCutoff,
        throughToday,
        increase,
        pctIncrease: Math.round(pctIncrease * 100) / 100,
      };
    });

    res.json({ items, cutoffLabel: "12/31/2025" });
  } catch (err) {
    console.error("Group reporting error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/export", async (req: Request, res: Response) => {
  try {
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, g.identifier, g.is_deactivated, g.is_corporate_group,
              g.is_private_group, g.featured_group, g.leaders, g.group_themes,
              g.owner_id
       FROM groups g
       WHERE (g.is_deleted IS NULL OR g.is_deleted = false)
       ORDER BY g.id DESC`
    );

    const groups = groupsResult.rows;
    const groupIds = groups.map((g: any) => g.id);

    const allLeaderIds: string[] = [];
    for (const g of groups) {
      if (g.leaders) {
        try {
          const parsed = JSON.parse(g.leaders);
          for (const l of parsed) {
            if (l.UserId || l.userId) allLeaderIds.push(l.UserId || l.userId);
          }
        } catch {}
      }
    }

    let leaderNameLookup: Record<string, string> = {};
    if (allLeaderIds.length > 0) {
      const uniqueIds = [...new Set(allLeaderIds)];
      const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(", ");
      const leaderResult = await pool.query(
        `SELECT id, COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as full_name FROM users WHERE id IN (${placeholders}) AND (is_deleted IS NULL OR is_deleted = false)`,
        uniqueIds
      );
      for (const row of leaderResult.rows) {
        leaderNameLookup[row.id] = row.full_name;
      }
    }

    // Per-group set of user IDs of accepted-request members. We later union
    // owner_id and leader IDs into this set so the count includes them once.
    const memberUserIdsByGroup: Record<number, Set<string>> = {};
    let memberInvestedTotals: Record<number, number> = {};
    if (groupIds.length > 0) {
      const memberPlaceholders = groupIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const memberRowsResult = await pool.query(
        `SELECT group_to_follow_id, request_owner_id
         FROM requests
         WHERE group_to_follow_id IN (${memberPlaceholders})
           AND status = 'accepted'
           AND (is_deleted IS NULL OR is_deleted = false)`,
        groupIds
      );
      for (const row of memberRowsResult.rows) {
        if (!memberUserIdsByGroup[row.group_to_follow_id]) {
          memberUserIdsByGroup[row.group_to_follow_id] = new Set<string>();
        }
        if (row.request_owner_id) {
          memberUserIdsByGroup[row.group_to_follow_id].add(row.request_owner_id);
        }
      }

      const memberInvestedResult = await pool.query(
        `SELECT req.group_to_follow_id, COALESCE(SUM(r.amount), 0) AS total
         FROM requests req
         JOIN recommendations r
           ON r.user_id = req.request_owner_id
          AND (r.is_deleted IS NULL OR r.is_deleted = false)
         WHERE req.group_to_follow_id IN (${memberPlaceholders})
           AND req.status = 'accepted'
           AND (req.is_deleted IS NULL OR req.is_deleted = false)
         GROUP BY req.group_to_follow_id`,
        groupIds
      );
      for (const row of memberInvestedResult.rows) {
        memberInvestedTotals[row.group_to_follow_id] = parseFloat(row.total) || 0;
      }
    }

    let campaignsByGroup: Record<number, any[]> = {};
    if (groupIds.length > 0) {
      const cgPlaceholders = groupIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const cgResult = await pool.query(
        `SELECT cg.groups_id, c.id as campaign_id, c.is_active, c.stage
         FROM campaign_groups cg
         JOIN campaigns c ON cg.campaigns_id = c.id
         WHERE cg.groups_id IN (${cgPlaceholders})
           AND (c.is_deleted IS NULL OR c.is_deleted = false)
         UNION
         SELECT c.group_for_private_access_id as groups_id, c.id as campaign_id, c.is_active, c.stage
         FROM campaigns c
         WHERE c.group_for_private_access_id IN (${cgPlaceholders})
           AND (c.is_deleted IS NULL OR c.is_deleted = false)`,
        groupIds
      );
      for (const row of cgResult.rows) {
        if (!campaignsByGroup[row.groups_id]) campaignsByGroup[row.groups_id] = [];
        campaignsByGroup[row.groups_id].push(row);
      }
    }

    const themeIds: number[] = [];
    for (const g of groups) {
      if (g.group_themes) {
        const ids = g.group_themes.split(",").map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
        themeIds.push(...ids);
      }
    }

    let themeLookup: Record<number, string> = {};
    if (themeIds.length > 0) {
      const uniqueThemeIds = [...new Set(themeIds)];
      const tPlaceholders = uniqueThemeIds.map((_, i) => `$${i + 1}`).join(", ");
      const themeResult = await pool.query(
        `SELECT id, name FROM themes WHERE id IN (${tPlaceholders}) AND (is_deleted IS NULL OR is_deleted = false)`,
        uniqueThemeIds
      );
      for (const row of themeResult.rows) {
        themeLookup[row.id] = row.name;
      }
    }

    const requestOrigin = process.env.ADMIN_BASE_URL || "";

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("InvestmentNotes");

    const headers = ["Group Name", "Group URL", "Group Leader(s)", "Member Count", "Total Mem Invested", "Investment Count", "Status", "Active", "Corporate Group", "Featured Group", "Themes"];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
    });

    const sortedGroups = [...groups].sort((a: any, b: any) => {
      const ta = memberInvestedTotals[a.id] || 0;
      const tb = memberInvestedTotals[b.id] || 0;
      return tb - ta;
    });

    for (const g of sortedGroups) {
      let leaderNames: string[] = [];
      const leaderUserIds: string[] = [];
      if (g.leaders) {
        try {
          const parsed = JSON.parse(g.leaders);
          for (const l of parsed) {
            const uid = l.UserId || l.userId;
            if (uid) {
              leaderUserIds.push(uid);
              if (leaderNameLookup[uid]) leaderNames.push(leaderNameLookup[uid]);
            }
          }
        } catch {}
      }

      // Member count = distinct user IDs across accepted requests + owner + leaders.
      const allMemberIds = new Set<string>(memberUserIdsByGroup[g.id] || []);
      if (g.owner_id) allMemberIds.add(g.owner_id);
      for (const uid of leaderUserIds) allMemberIds.add(uid);

      const campaigns = campaignsByGroup[g.id] || [];
      const activeCampaigns = campaigns.filter((c: any) => c.is_active === true);
      const completedCampaigns = campaigns.filter((c: any) => COMPLETED_STAGES.includes(c.stage));
      const allCampaignIds = new Set([
        ...activeCampaigns.map((c: any) => c.campaign_id),
        ...completedCampaigns.map((c: any) => c.campaign_id),
      ]);

      const groupThemeNames: string[] = [];
      if (g.group_themes) {
        const ids = g.group_themes.split(",").map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
        for (const id of ids) {
          if (themeLookup[id]) groupThemeNames.push(themeLookup[id]);
        }
      }

      const url = g.identifier?.trim() ? `${requestOrigin}/group/${g.identifier.trim()}` : `${requestOrigin}/group/${g.id}`;

      const memInvested = memberInvestedTotals[g.id] || 0;
      const newRow = worksheet.addRow([
        g.name || "",
        url,
        leaderNames.join(", "),
        allMemberIds.size,
        memInvested,
        allCampaignIds.size,
        g.is_private_group ? "Private" : "Public",
        g.is_deactivated ? "False" : "True",
        g.is_corporate_group ? "True" : "",
        g.featured_group ? "True" : "",
        groupThemeNames.join(", "),
      ]);
      newRow.getCell(5).numFmt = '"$"#,##0';
    }

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 60);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Groups.xlsx"');
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (err) {
    console.error("Export groups error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/leaders-and-champions", async (req: Request, res: Response) => {
  try {
    const userName = ((req.query.userName as string) || "").trim().toLowerCase();
    const groupId = parseInt((req.query.groupId as string) || "0", 10);
    const type = ((req.query.type as string) || "").trim().toLowerCase();

    if (!userName) {
      res.json({ success: false, message: "Username required." });
      return;
    }

    const ownerResult = await pool.query(
      `SELECT owner_id FROM groups WHERE id = $1`,
      [groupId]
    );
    const groupOwnerId = ownerResult.rows[0]?.owner_id;

    if (type === "leaders") {
      // Search across ALL active, non-deleted users (no role gate, owner included).
      // The group's owner can be added as a public Leader if desired.
      const result = await pool.query(
        `SELECT u.id, COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') as "fullName", u.picture_file_name as "pictureFileName"
         FROM users u
         WHERE u.is_active = true
           AND (u.is_deleted IS NULL OR u.is_deleted = false)
           AND LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $1
         ORDER BY u.first_name, u.last_name
         LIMIT 50`,
        [`%${userName}%`]
      );
      // groupOwnerId is read above for parity with the champions branch but is no
      // longer used as an exclusion filter here.
      void groupOwnerId;
      res.json(result.rows.map((r: any) => ({ ...r, pictureFileName: resolveFileUrl(r.pictureFileName, "users") })));
    } else if (type === "champions") {
      const result = await pool.query(
        `SELECT DISTINCT u.id, COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') as "fullName",
                u.picture_file_name as "pictureFileName", u.date_created as "dateCreated"
         FROM requests r
         JOIN users u ON r.request_owner_id = u.id
         WHERE r.group_to_follow_id = $1
           AND r.status = 'accepted'
           AND u.is_active = true
           AND (u.is_deleted IS NULL OR u.is_deleted = false)
           AND ($2::text IS NULL OR u.id != $2::text)
           AND LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $3`,
        [groupId, groupOwnerId || null, `%${userName}%`]
      );
      res.json(result.rows.map((r: any) => ({ ...r, pictureFileName: resolveFileUrl(r.pictureFileName, "users") })));
    } else {
      res.json({ success: false, message: "Invalid type specified. Please use 'leaders' or 'champions'." });
    }
  } catch (err) {
    console.error("Search leaders/champions error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/leaders-and-champions", async (req: Request, res: Response) => {
  try {
    const dto = req.body;
    const groupId = parseInt((req.query.groupId as string) || "0", 10);
    const type = ((req.query.type as string) || "").trim().toLowerCase();

    if (!dto) {
      res.json({ success: false, message: "Invalid request payload." });
      return;
    }

    if (!type) {
      res.json({ success: false, message: "Type is required." });
      return;
    }

    const groupResult = await pool.query(
      `SELECT id, leaders, champions_and_catalysts, owner_id FROM groups WHERE id = $1`,
      [groupId]
    );
    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];

    if (type === "leaders") {
      let leaders: any[] = [];
      if (group.leaders) {
        try { leaders = JSON.parse(group.leaders); } catch {}
      }

      const existing = leaders.find((x: any) => (x.UserId || x.userId) === dto.UserId);
      if (existing) {
        existing.RoleAndTitle = dto.RoleAndTitle;
        existing.Description = dto.Description;
        existing.LinkedInUrl = dto.LinkedInUrl;
      } else {
        leaders.push({
          UserId: dto.UserId,
          RoleAndTitle: dto.RoleAndTitle,
          Description: dto.Description,
          LinkedInUrl: dto.LinkedInUrl,
        });

        const leaderGroupExists = await pool.query(
          `SELECT id FROM leader_groups WHERE group_id = $1 AND user_id = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
          [groupId, dto.UserId]
        );
        if (leaderGroupExists.rows.length === 0) {
          await pool.query(
            `INSERT INTO leader_groups (user_id, group_id) VALUES ($1, $2)`,
            [dto.UserId, groupId]
          );
        }
      }

      await pool.query(`UPDATE groups SET leaders = $1 WHERE id = $2`, [JSON.stringify(leaders), groupId]);

      await logAudit({
        tableName: "groups",
        recordId: String(groupId),
        actionType: "Modified",
        oldValues: { leaders: group.leaders },
        newValues: { leaders: JSON.stringify(leaders) },
        updatedBy: req.user?.id || null,
      });

      const enriched = await enrichMembers(leaders, group.owner_id);
      res.json(enriched);
    } else if (type === "champions") {
      let champions: any[] = [];
      if (group.champions_and_catalysts) {
        try { champions = JSON.parse(group.champions_and_catalysts); } catch {}
      }

      const existing = champions.find((x: any) => (x.UserId || x.userId) === dto.UserId);
      if (existing) {
        existing.RoleAndTitle = dto.RoleAndTitle;
        existing.Description = dto.Description;
        existing.MemberSince = dto.MemberSince;
      } else {
        champions.push({
          UserId: dto.UserId,
          RoleAndTitle: dto.RoleAndTitle,
          Description: dto.Description,
          MemberSince: dto.MemberSince,
        });
      }

      await pool.query(`UPDATE groups SET champions_and_catalysts = $1 WHERE id = $2`, [JSON.stringify(champions), groupId]);

      await logAudit({
        tableName: "groups",
        recordId: String(groupId),
        actionType: "Modified",
        oldValues: { champions_and_catalysts: group.champions_and_catalysts },
        newValues: { champions_and_catalysts: JSON.stringify(champions) },
        updatedBy: req.user?.id || null,
      });

      const enriched = await enrichMembers(champions);
      res.json(enriched);
    } else {
      res.status(400).json({ success: false, message: "Invalid type." });
    }
  } catch (err) {
    console.error("Save leaders/champions error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/leaders-and-champions", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt((req.query.groupId as string) || "0", 10);
    const userId = (req.query.userId as string) || "";
    const type = ((req.query.type as string) || "").trim().toLowerCase();

    if (!userId) {
      res.json({ success: false, message: "User Id is required." });
      return;
    }

    if (!type) {
      res.json({ success: false, message: "Type is required." });
      return;
    }

    const groupResult = await pool.query(
      `SELECT id, leaders, champions_and_catalysts, owner_id FROM groups WHERE id = $1`,
      [groupId]
    );
    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];

    if (type === "leaders") {
      let leaders: any[] = [];
      if (group.leaders) {
        try { leaders = JSON.parse(group.leaders); } catch {}
      }

      leaders = leaders.filter((x: any) => (x.UserId || x.userId) !== userId);

      await pool.query(
        `DELETE FROM leader_groups WHERE group_id = $1 AND user_id = $2 AND ($3 IS NULL OR user_id != $3)`,
        [groupId, userId, group.owner_id]
      );

      await pool.query(`UPDATE groups SET leaders = $1 WHERE id = $2`, [JSON.stringify(leaders), groupId]);

      await logAudit({
        tableName: "groups",
        recordId: String(groupId),
        actionType: "Modified",
        oldValues: { leaders: group.leaders },
        newValues: { leaders: JSON.stringify(leaders) },
        updatedBy: req.user?.id || null,
      });

      const enriched = await enrichMembers(leaders);
      res.json(enriched);
    } else if (type === "champions") {
      let champions: any[] = [];
      if (group.champions_and_catalysts) {
        try { champions = JSON.parse(group.champions_and_catalysts); } catch {}
      }

      champions = champions.filter((x: any) => (x.UserId || x.userId) !== userId);

      await pool.query(`UPDATE groups SET champions_and_catalysts = $1 WHERE id = $2`, [JSON.stringify(champions), groupId]);

      await logAudit({
        tableName: "groups",
        recordId: String(groupId),
        actionType: "Modified",
        oldValues: { champions_and_catalysts: group.champions_and_catalysts },
        newValues: { champions_and_catalysts: JSON.stringify(champions) },
        updatedBy: req.user?.id || null,
      });

      const enriched = await enrichMembers(champions);
      res.json(enriched);
    } else {
      res.status(400).json({ success: false, message: "Invalid type." });
    }
  } catch (err) {
    console.error("Delete leaders/champions error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/group-investments", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt((req.query.groupId as string) || "0", 10);
    if (groupId <= 0) {
      res.status(400).json({ message: "Valid groupId is required." });
      return;
    }

    const groupResult = await pool.query(`SELECT id, owner_id FROM groups WHERE id = $1`, [groupId]);
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];
    const currentUserId = req.user?.id;
    const isOwner = currentUserId === group.owner_id;
    const isAdmin = req.user?.isSuperAdmin || req.user?.roles?.some((r: string) => ["admin", "superadmin"].includes(r.toLowerCase()));
    if (!isOwner && !isAdmin) {
      res.status(403).json({ message: "Only the group owner or an admin can view group investments." });
      return;
    }

    const linkedResult = await pool.query(
      `SELECT c.id, c.name, c.stage, c.image_file_name, c.is_active,
              (c.group_for_private_access_id = $1) AS is_private_access
       FROM campaigns c
       LEFT JOIN campaign_groups cg
         ON cg.campaigns_id = c.id AND cg.groups_id = $1
       WHERE cg.campaigns_id IS NOT NULL
          OR c.group_for_private_access_id = $1
       ORDER BY c.name`,
      [groupId]
    );

    const linkedIds = linkedResult.rows.map((r: any) => r.id);

    let publicCampaignsQuery = `
      SELECT c.id, c.name, c.stage, c.image_file_name, c.is_active
      FROM campaigns c
      WHERE c.is_active = true
        AND c.group_for_private_access_id IS NULL
        AND c.stage IN (2, 7)`;
    const publicValues: any[] = [];
    if (linkedIds.length > 0) {
      const placeholders = linkedIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      publicCampaignsQuery += ` AND c.id NOT IN (${placeholders})`;
      publicValues.push(...linkedIds);
    }
    publicCampaignsQuery += ` ORDER BY c.name`;

    const publicResult = await pool.query(publicCampaignsQuery, publicValues);

    let completedQuery = `
      SELECT c.id, c.name, c.stage, c.image_file_name, c.is_active
      FROM campaigns c
      WHERE c.stage = 3
        AND c.group_for_private_access_id IS NULL`;
    const completedValues: any[] = [];
    if (linkedIds.length > 0) {
      const placeholders = linkedIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      completedQuery += ` AND c.id NOT IN (${placeholders})`;
      completedValues.push(...linkedIds);
    }
    completedQuery += ` ORDER BY c.name`;
    const completedResult = await pool.query(completedQuery, completedValues);
    const completedCampaigns = completedResult.rows.map((c: any) => ({
      id: c.id,
      name: c.name,
      stage: c.stage,
      stageLabel: STAGE_LABELS[c.stage] || `Stage ${c.stage}`,
      imageFileName: resolveFileUrl(c.image_file_name, "campaigns"),
    }));

    const allCampaignIds = [
      ...linkedResult.rows,
      ...publicResult.rows,
    ].map((c: any) => c.id);

    let raisedByCompaign: Record<number, { raised: number; investorCount: number; avatars: string[] }> = {};
    if (allCampaignIds.length > 0) {
      const placeholders = allCampaignIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const raisedResult = await pool.query(
        `SELECT r.campaign_id,
                COALESCE(SUM(r.amount), 0) as raised,
                COUNT(DISTINCT r.user_id) as investor_count
         FROM recommendations r
         WHERE r.campaign_id IN (${placeholders})
           AND (r.is_deleted IS NULL OR r.is_deleted = false)
         GROUP BY r.campaign_id`,
        allCampaignIds
      );
      for (const row of raisedResult.rows) {
        raisedByCompaign[row.campaign_id] = {
          raised: parseFloat(row.raised),
          investorCount: parseInt(row.investor_count),
          avatars: [],
        };
      }

      const avatarResult = await pool.query(
        `SELECT DISTINCT ON (r.campaign_id, r.user_id) r.campaign_id, u.picture_file_name
         FROM recommendations r
         JOIN users u ON r.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
         WHERE r.campaign_id IN (${placeholders})
           AND (r.is_deleted IS NULL OR r.is_deleted = false)
           AND u.picture_file_name IS NOT NULL
         ORDER BY r.campaign_id, r.user_id
         LIMIT ${allCampaignIds.length * 3}`,
        allCampaignIds
      );
      const avatarsByCampaign: Record<number, string[]> = {};
      for (const row of avatarResult.rows) {
        if (!avatarsByCampaign[row.campaign_id]) avatarsByCampaign[row.campaign_id] = [];
        if (avatarsByCampaign[row.campaign_id].length < 3) {
          avatarsByCampaign[row.campaign_id].push(resolveFileUrl(row.picture_file_name, "users") || "");
        }
      }
      for (const [cid, avatars] of Object.entries(avatarsByCampaign)) {
        if (raisedByCompaign[Number(cid)]) {
          raisedByCompaign[Number(cid)].avatars = avatars;
        }
      }
    }

    const mapCampaign = (c: any) => ({
      id: c.id,
      name: c.name,
      stage: c.stage,
      stageLabel: STAGE_LABELS[c.stage] || `Stage ${c.stage}`,
      imageFileName: resolveFileUrl(c.image_file_name, "campaigns"),
      raised: raisedByCompaign[c.id]?.raised || 0,
      investorCount: raisedByCompaign[c.id]?.investorCount || 0,
      investorAvatars: raisedByCompaign[c.id]?.avatars || [],
      isPrivateAccess: c.is_private_access === true,
    });

    res.json({
      groupCampaigns: linkedResult.rows.map(mapCampaign),
      publicCampaigns: publicResult.rows.map(mapCampaign),
      completedCampaigns,
    });
  } catch (err) {
    console.error("Get group investments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/update-group-investments", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt((req.query.groupId as string) || "0", 10);
    const rawBody = req.body;

    if (groupId <= 0) {
      res.status(400).json({ message: "Valid groupId is required." });
      return;
    }

    if (!Array.isArray(rawBody)) {
      res.status(400).json({ message: "Request body must be an array of campaign IDs." });
      return;
    }

    const rawCampaignIds: number[] = [...new Set(
      rawBody
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    )];

    const privateLinkedResult = await pool.query(
      `SELECT id FROM campaigns WHERE group_for_private_access_id = $1`,
      [groupId]
    );
    const privateLinkedIds = new Set<number>(
      privateLinkedResult.rows.map((r: any) => Number(r.id))
    );

    const campaignIds: number[] = rawCampaignIds.filter((id) => !privateLinkedIds.has(id));

    const groupResult = await pool.query(
      `SELECT id, name, identifier, owner_id, picture_file_name FROM groups WHERE id = $1`,
      [groupId]
    );
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];
    const currentUserId = req.user?.id;

    const isOwner = currentUserId === group.owner_id;
    const isAdmin = req.user?.isSuperAdmin || req.user?.roles?.some((r: string) => ["admin", "superadmin"].includes(r.toLowerCase()));
    if (!isOwner && !isAdmin) {
      res.status(403).json({ message: "Only the group owner or an admin can update group investments." });
      return;
    }

    const oldLinksResult = await pool.query(
      `SELECT campaigns_id FROM campaign_groups WHERE groups_id = $1`,
      [groupId]
    );
    const oldIds = new Set(oldLinksResult.rows.map((r: any) => r.campaigns_id));
    const newIds = new Set(campaignIds);

    const addedIds = campaignIds.filter((id) => !oldIds.has(id));
    const removedIds: number[] = [...oldIds].filter((id: any) => !newIds.has(id)).map((id: any) => Number(id));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`DELETE FROM campaign_groups WHERE groups_id = $1`, [groupId]);

      if (campaignIds.length > 0) {
        const insertValues: any[] = [];
        const insertPlaceholders: string[] = [];
        campaignIds.forEach((cid, idx) => {
          insertPlaceholders.push(`($${idx * 2 + 1}, $${idx * 2 + 2})`);
          insertValues.push(groupId, cid);
        });
        await client.query(
          `INSERT INTO campaign_groups (groups_id, campaigns_id) VALUES ${insertPlaceholders.join(", ")}`,
          insertValues
        );
      }

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    await logAudit({
      tableName: "campaign_groups",
      recordId: String(groupId),
      actionType: "Modified",
      oldValues: { campaignIds: [...oldIds] },
      newValues: { campaignIds },
      updatedBy: currentUserId || null,
    });

    if (addedIds.length > 0 || removedIds.length > 0) {
      const NON_NOTIFY_STAGES = [3, 7, 9];

      const requestOrigin = process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
      const groupSlug = (group.identifier && String(group.identifier).trim()) || String(group.id);
      const groupPageUrl = requestOrigin ? `${requestOrigin}/group/${groupSlug}` : "";
      const unsubscribeUrl = requestOrigin ? `${requestOrigin}/settings` : "";

      const groupPicturePath = extractStoragePath(group.picture_file_name) || null;
      const groupLogoUrl = resolveFileUrl(group.picture_file_name, "groups") || "";
      const escapeHtml = (s: string) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const groupNameSafe = escapeHtml(group.name || "");
      const groupPageHrefSafe = escapeHtml(groupPageUrl);
      const groupLogoSrcSafe = escapeHtml(groupLogoUrl);
      const groupHeaderBranding = groupLogoUrl
        ? `<a href="${groupPageHrefSafe}" target="_blank" style="text-decoration:none;"><img src="${groupLogoSrcSafe}" alt="${groupNameSafe}" width="150" height="75" style="display:block; max-height:75px; width:auto; max-width:200px; object-fit:contain;"></a>`
        : `<a href="${groupPageHrefSafe}" target="_blank" style="text-decoration:none;"><span style="display:inline-block; font-family:Georgia,'Times New Roman',serif; font-size:22px; font-weight:700; color:#16a34a; line-height:1.2;">${groupNameSafe}</span></a>`;

      const formatTargetAmount = (val: any): string => {
        if (val == null || val === "") return "";
        const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[$,]/g, ""));
        if (isNaN(num)) return "";
        return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      const fetchCampaigns = async (ids: number[]): Promise<any[]> => {
        if (ids.length === 0) return [];
        const placeholders = ids.map((_: any, i: number) => `$${i + 1}`).join(", ");
        const result = await pool.query(
          `SELECT id, name, stage, property, target, description FROM campaigns WHERE id IN (${placeholders})`,
          ids
        );
        return result.rows.filter((c: any) => {
          const stageNum = Number(c.stage);
          if (!Number.isFinite(stageNum)) return true;
          return !NON_NOTIFY_STAGES.includes(stageNum);
        });
      };

      let membersRows: any[] | null = null;
      const fetchMembers = async (): Promise<any[]> => {
        if (membersRows !== null) return membersRows;
        const membersResult = await pool.query(
          `SELECT DISTINCT r.request_owner_id as user_id, u.email, u.first_name
           FROM requests r
           JOIN users u ON r.request_owner_id = u.id
           WHERE r.group_to_follow_id = $1
             AND r.status = 'accepted'
             AND (r.is_deleted IS NULL OR r.is_deleted = false)
             AND u.is_active = true
             AND (u.is_deleted IS NULL OR u.is_deleted = false)`,
          [groupId]
        );
        membersRows = membersResult.rows;
        return membersRows;
      };

      if (addedIds.length > 0) {
        const campaignsToNotify = await fetchCampaigns(addedIds);
        if (campaignsToNotify.length > 0) {
          const members = await fetchMembers();
          for (const campaign of campaignsToNotify) {
            for (const member of members) {
              try {
                await pool.query(
                  `INSERT INTO user_notifications (title, description, url_to_redirect, is_read, target_user_id, picture_file_name)
                   VALUES ($1, $2, $3, false, $4, $5)`,
                  [
                    `New Investment in ${group.name}`,
                    `${campaign.name} has been added to ${group.name}`,
                    `/investments/${campaign.property || campaign.id}`,
                    member.user_id,
                    groupPicturePath,
                  ]
                );
              } catch (notifErr) {
                console.error(`Failed to create notification for user ${member.user_id}:`, notifErr);
              }

              if (member.email) {
                const exploreInvestmentUrl = `${requestOrigin}/investments/${campaign.property || campaign.id}`;
                sendTemplateEmail(12, member.email, {
                  groupName: group.name,
                  investmentName: campaign.name,
                  // legacy alias kept for any older template revisions still referencing it
                  investmentLink: exploreInvestmentUrl,
                  exploreInvestmentUrl,
                  groupLogoUrl,
                  groupHeaderBranding,
                  firstName: member.first_name || "Member",
                  groupPageUrl,
                  targetAmount: formatTargetAmount(campaign.target),
                  investmentDescription: campaign.description || "",
                  unsubscribeUrl,
                }).catch((emailErr) => {
                  console.error(`[EMAIL] Failed to send group investment notification to ${member.email}:`, emailErr);
                });
              }
            }
          }
        }
      }

      if (removedIds.length > 0) {
        const campaignsToNotify = await fetchCampaigns(removedIds);
        if (campaignsToNotify.length > 0) {
          const members = await fetchMembers();
          for (const campaign of campaignsToNotify) {
            for (const member of members) {
              try {
                await pool.query(
                  `INSERT INTO user_notifications (title, description, url_to_redirect, is_read, target_user_id, picture_file_name)
                   VALUES ($1, $2, $3, false, $4, $5)`,
                  [
                    `Investment Removed from ${group.name}`,
                    `${campaign.name} has been removed from ${group.name}`,
                    `/group/${groupSlug}`,
                    member.user_id,
                    groupPicturePath,
                  ]
                );
              } catch (notifErr) {
                console.error(`Failed to create removal notification for user ${member.user_id}:`, notifErr);
              }

              if (member.email) {
                sendTemplateEmail(35, member.email, {
                  groupName: group.name,
                  investmentName: campaign.name,
                  firstName: member.first_name || "Member",
                  groupPageUrl,
                  targetAmount: formatTargetAmount(campaign.target),
                  investmentDescription: campaign.description || "",
                  unsubscribeUrl,
                }).catch((emailErr) => {
                  console.error(`[EMAIL] Failed to send group investment removed notification to ${member.email}:`, emailErr);
                });
              }
            }
          }
        }
      }
    }

    res.json({ success: true, message: "Group investments updated successfully." });
  } catch (err) {
    console.error("Update group investments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:groupId/leaders", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt(String(req.params.groupId), 10);
    const groupResult = await pool.query(
      `SELECT id, leaders, owner_id FROM groups WHERE id = $1`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];
    const leaders = await processGroupMembers(group.leaders, group.owner_id);
    res.json({ leaders });
  } catch (err) {
    console.error("Get group leaders error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:groupId/champions", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt(String(req.params.groupId), 10);
    const groupResult = await pool.query(
      `SELECT id, champions_and_catalysts FROM groups WHERE id = $1`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const group = groupResult.rows[0];
    const champions = await processGroupMembers(group.champions_and_catalysts);
    res.json({ champions });
  } catch (err) {
    console.error("Get group champions error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/settings", async (req: Request, res: Response) => {
  try {
    const id = parseInt((req.query.id as string) || "0", 10);
    const featuredGroup = req.query.featuredGroup as string | undefined;
    const isCorporateGroup = req.query.isCorporateGroup as string | undefined;

    if (id <= 0) {
      res.json({ success: false, message: "Group id is required." });
      return;
    }

    const groupResult = await pool.query(`SELECT id, featured_group, is_corporate_group FROM groups WHERE id = $1`, [id]);
    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const currentGroup = groupResult.rows[0];
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (featuredGroup !== undefined && featuredGroup !== "undefined") {
      const nextFeatured = featuredGroup === "true";
      // Cap featured groups at 3. Only need to check when turning ON and the
      // group isn't already featured (idempotent re-saves stay allowed).
      if (nextFeatured && !currentGroup.featured_group) {
        const countResult = await pool.query(
          `SELECT COUNT(*)::int AS count FROM groups WHERE featured_group = TRUE AND id <> $1`,
          [id]
        );
        const currentFeaturedCount = countResult.rows[0]?.count ?? 0;
        if (currentFeaturedCount >= 3) {
          res.json({
            success: false,
            message: "Only 3 groups can be featured at a time. Please unselect another featured group first.",
          });
          return;
        }
      }
      updates.push(`featured_group = $${paramIdx++}`);
      values.push(nextFeatured);
      oldValues.featured_group = currentGroup.featured_group;
      newValues.featured_group = nextFeatured;
    }

    if (isCorporateGroup !== undefined && isCorporateGroup !== "undefined") {
      updates.push(`is_corporate_group = $${paramIdx++}`);
      values.push(isCorporateGroup === "true");
      oldValues.is_corporate_group = currentGroup.is_corporate_group;
      newValues.is_corporate_group = isCorporateGroup === "true";
    }

    if (updates.length === 0) {
      res.status(200).send();
      return;
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE groups SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    if (result.rowCount && result.rowCount > 0) {
      await logAudit({
        tableName: "groups",
        recordId: String(id),
        actionType: "Modified",
        oldValues,
        newValues,
        updatedBy: req.user?.id || null,
      });
      res.status(200).send();
    } else {
      res.status(400).send();
    }
  } catch (err) {
    console.error("Update group settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:identifier", async (req: Request, res: Response) => {
  try {
    const identifier = String(req.params.identifier);

    if (identifier === "export" || identifier === "leaders-and-champions" || identifier === "settings") {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const isGroupId = /^\d+$/.test(identifier);
    const groupId = isGroupId ? parseInt(identifier, 10) : null;

    let groupResult = await pool.query(
      `SELECT g.*, u.first_name as owner_first_name, u.last_name as owner_last_name, u.id as owner_user_id
       FROM groups g
       LEFT JOIN users u ON g.owner_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       WHERE g.identifier = $1 ${isGroupId ? "OR g.id = $2" : ""}`,
      isGroupId ? [identifier, groupId] : [identifier]
    );

    if (groupResult.rows.length === 0) {
      const slugResult = await pool.query(
        `SELECT reference_id FROM slugs WHERE type = 1 AND value = $1`,
        [identifier]
      );
      if (slugResult.rows.length > 0 && slugResult.rows[0].reference_id) {
        groupResult = await pool.query(
          `SELECT g.*, u.first_name as owner_first_name, u.last_name as owner_last_name, u.id as owner_user_id
           FROM groups g
           LEFT JOIN users u ON g.owner_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
           WHERE g.id = $1`,
          [slugResult.rows[0].reference_id]
        );
      }
    }

    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found" });
      return;
    }

    const group = groupResult.rows[0];

    const leaders = await processGroupMembers(group.leaders, group.owner_user_id);
    const champions = await processGroupMembers(group.champions_and_catalysts);

    const cgResult = await pool.query(
      `SELECT c.id, c.name, c.image_file_name, c.stage, c.is_active
       FROM campaign_groups cg
       JOIN campaigns c ON cg.campaigns_id = c.id
       WHERE cg.groups_id = $1
         AND (c.is_deleted IS NULL OR c.is_deleted = false)
       UNION
       SELECT c.id, c.name, c.image_file_name, c.stage, c.is_active
       FROM campaigns c
       WHERE c.group_for_private_access_id = $1
         AND (c.is_deleted IS NULL OR c.is_deleted = false)`,
      [group.id]
    );

    const campaigns = cgResult.rows;
    const activeCampaigns = campaigns.filter((c: any) => c.is_active === true);
    const completedCampaigns = campaigns.filter((c: any) => COMPLETED_STAGES.includes(c.stage));

    let currentBalance: number | null = null;
    if (group.original_balance != null) {
      const allocResult = await pool.query(
        `SELECT COALESCE(SUM(balance), 0) as total FROM group_account_balances WHERE group_id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
        [group.id]
      );
      const allocatedTotal = parseFloat(allocResult.rows[0].total) || 0;

      const investedResult = await pool.query(
        `SELECT COALESCE(SUM(old_value - new_value), 0) as total
         FROM account_balance_change_logs
         WHERE group_id = $1
           AND investment_name IS NOT NULL
           AND (transaction_status IS NULL OR transaction_status != 'Rejected')
           AND (is_deleted IS NULL OR is_deleted = false)`,
        [group.id]
      );
      const investedTotal = parseFloat(investedResult.rows[0].total) || 0;

      currentBalance = parseFloat(group.original_balance) - (allocatedTotal + investedTotal);
    }

    const groupCampaignIds = campaigns.map((c: any) => c.id);

    let totalMembers = 0;
    let totalInvestmentAmount = 0;

    if (groupCampaignIds.length > 0) {
      const placeholders = groupCampaignIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const totalMembersResult = await pool.query(
        `SELECT COUNT(DISTINCT r.user_email) as total
         FROM recommendations r
         WHERE r.campaign_id IN (${placeholders})
           AND (LOWER(r.status) = 'approved' OR LOWER(r.status) = 'pending')
           AND r.amount > 0
           AND r.user_email IS NOT NULL AND r.user_email != ''`,
        groupCampaignIds
      );
      totalMembers = parseInt(totalMembersResult.rows[0]?.total) || 0;

      const totalInvestmentResult = await pool.query(
        `SELECT COALESCE(SUM(r.amount), 0) as total
         FROM recommendations r
         WHERE r.campaign_id IN (${placeholders})
           AND (LOWER(r.status) = 'approved' OR LOWER(r.status) = 'pending')
           AND r.amount > 0
           AND r.user_email IS NOT NULL AND r.user_email != ''`,
        groupCampaignIds
      );
      totalInvestmentAmount = parseFloat(totalInvestmentResult.rows[0]?.total) || 0;
    }

    const userRoleResult = await pool.query(`SELECT id FROM roles WHERE name = 'User'`);
    const userRoleId = userRoleResult.rows[0]?.id;
    let totalUsersAccountBalance = 0;
    if (userRoleId) {
      const balResult = await pool.query(
        `SELECT COALESCE(SUM(u.account_balance), 0) as total
         FROM users u
         WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = $1)
           AND (u.is_deleted IS NULL OR u.is_deleted = false)`,
        [userRoleId]
      );
      totalUsersAccountBalance = parseFloat(balResult.rows[0]?.total) || 0;
    }

    const completedInvResult = await pool.query(
      `SELECT COUNT(*) as total FROM completed_investment_details`
    ).catch(() => ({ rows: [{ total: 0 }] }));
    const completedInvestments = parseInt(completedInvResult.rows[0]?.total) || 0;

    const groupData = {
      id: group.id,
      name: group.name,
      identifier: group.identifier,
      description: group.description,
      website: group.website,
      didYouKnow: group.did_you_know,
      videoLink: group.video_link,
      ourWhyDescription: group.our_why_description,
      isApprouveRequired: group.is_approuve_required,
      isPrivateGroup: group.is_private_group,
      isDeactivated: group.is_deactivated,
      pictureFileName: resolveFileUrl(group.picture_file_name, "groups"),
      backgroundPictureFileName: resolveFileUrl(group.background_picture_file_name, "groups"),
      originalBalance: group.original_balance ? parseFloat(group.original_balance) : null,
      currentBalance,
      isCorporateGroup: group.is_corporate_group,
      featuredGroup: group.featured_group,
      groupThemes: group.group_themes,
      metaTitle: group.meta_title,
      metaDescription: group.meta_description,
      isOwner: false,
      isFollowing: false,
      isFollowPending: false,
      isLeader: false,
      activeCampaigns: activeCampaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        imageFileName: resolveFileUrl(c.image_file_name, "campaigns"),
        stage: STAGE_LABELS[c.stage] || String(c.stage),
      })),
      completedCampaigns: completedCampaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        imageFileName: resolveFileUrl(c.image_file_name, "campaigns"),
        stage: STAGE_LABELS[c.stage] || String(c.stage),
      })),
      campaigns: campaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        imageFileName: resolveFileUrl(c.image_file_name, "campaigns"),
        stage: c.stage,
      })),
    };

    res.json({
      group: groupData,
      leaders: leaders || [],
      champions: champions || [],
      totalMembers,
      totalInvestedByMembers: Math.round(totalInvestmentAmount + totalUsersAccountBalance),
      completedInvestments,
    });
  } catch (err) {
    console.error("Get group by identifier error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  try {
    const ids: number[] = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    const groupsResult = await pool.query(
      `SELECT id FROM groups WHERE id = ANY($1) AND is_deleted = true`,
      [ids]
    );

    if (groupsResult.rows.length === 0) {
      res.json({ success: false, message: "No deleted groups found to restore." });
      return;
    }

    const groupIds = groupsResult.rows.map((r: any) => r.id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE requests SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE group_to_follow_id = ANY($1) AND is_deleted = true`,
        [groupIds]
      );

      await client.query(
        `UPDATE leader_groups SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE group_id = ANY($1) AND is_deleted = true`,
        [groupIds]
      );

      await client.query(
        `UPDATE group_account_balances SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE group_id = ANY($1) AND is_deleted = true`,
        [groupIds]
      );

      await client.query(
        `UPDATE groups SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1)`,
        [groupIds]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    for (const gid of groupIds) {
      await logAudit({
        tableName: "groups",
        recordId: String(gid),
        actionType: "Modified",
        oldValues: { is_deleted: true },
        newValues: { is_deleted: false },
        updatedBy: (req as any).user?.id || null,
      });
    }

    res.json({
      success: true,
      message: `${groupIds.length} group(s) restored successfully.`,
      restoredCount: groupIds.length,
      restoredUserCount: 0,
    });
  } catch (err) {
    console.error("Restore groups error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const groupData = req.body;

    if (groupData.identifier) {
      const normalized = groupData.identifier.trim().toLowerCase();

      const existsInGroup = await pool.query(
        `SELECT id FROM groups WHERE LOWER(TRIM(identifier)) = $1 AND id != $2`,
        [normalized, id]
      );
      if (existsInGroup.rows.length > 0) {
        res.status(400).json({ message: "Identifier already exists." });
        return;
      }

      const existsInSlug = await pool.query(
        `SELECT id FROM slugs WHERE type = 1 AND value = $1 AND reference_id != $2`,
        [normalized, id]
      );
      if (existsInSlug.rows.length > 0) {
        res.status(400).json({ message: "Identifier already exists." });
        return;
      }
    }

    const existingGroup = await pool.query(`SELECT * FROM groups WHERE id = $1`, [id]);
    if (existingGroup.rows.length === 0) {
      res.status(400).json({ message: "Group not found." });
      return;
    }

    const existing = existingGroup.rows[0];

    if (existing.identifier && existing.identifier.trim()) {
      await pool.query(
        `INSERT INTO slugs (reference_id, type, value, created_at) VALUES ($1, 1, $2, NOW()) ON CONFLICT DO NOTHING`,
        [id, existing.identifier]
      );
    }

    let pictureFileName = existing.picture_file_name;
    if (groupData.pictureFileName !== undefined && groupData.pictureFileName !== existing.picture_file_name) {
      if (groupData.pictureFileName && groupData.pictureFileName.startsWith("data:")) {
        const result = await uploadBase64Image(groupData.pictureFileName, "groups");
        pictureFileName = result.filePath;
      } else {
        pictureFileName = extractStoragePath(groupData.pictureFileName) || "";
      }
    }

    let backgroundPictureFileName = existing.background_picture_file_name;
    if (groupData.backgroundPictureFileName !== undefined && groupData.backgroundPictureFileName !== existing.background_picture_file_name) {
      if (groupData.backgroundPictureFileName && groupData.backgroundPictureFileName.startsWith("data:")) {
        const result = await uploadBase64Image(groupData.backgroundPictureFileName, "groups");
        backgroundPictureFileName = result.filePath;
      } else {
        backgroundPictureFileName = extractStoragePath(groupData.backgroundPictureFileName) || "";
      }
    }

    const oldValues = {
      name: existing.name,
      website: existing.website,
      description: existing.description,
      our_why_description: existing.our_why_description,
      did_you_know: existing.did_you_know,
      video_link: existing.video_link,
      is_approuve_required: existing.is_approuve_required,
      is_deactivated: existing.is_deactivated,
      identifier: existing.identifier,
      is_corporate_group: existing.is_corporate_group,
      is_private_group: existing.is_private_group,
      group_themes: existing.group_themes,
      meta_title: existing.meta_title,
      meta_description: existing.meta_description,
    };

    const updatedFields = {
      name: groupData.name ?? existing.name,
      website: groupData.website ?? existing.website,
      description: groupData.description ?? existing.description,
      our_why_description: groupData.ourWhyDescription ?? existing.our_why_description,
      did_you_know: groupData.didYouKnow ?? existing.did_you_know,
      video_link: groupData.videoLink ?? existing.video_link,
      is_approuve_required: groupData.isApprouveRequired ?? existing.is_approuve_required,
      is_deactivated: groupData.isDeactivated ?? existing.is_deactivated,
      identifier: groupData.identifier ?? existing.identifier,
      is_corporate_group: groupData.isCorporateGroup ?? existing.is_corporate_group,
      is_private_group: groupData.isPrivateGroup ?? existing.is_private_group,
      group_themes: groupData.groupThemes ?? existing.group_themes,
      meta_title: groupData.metaTitle ?? existing.meta_title,
      meta_description: groupData.metaDescription ?? existing.meta_description,
    };

    await pool.query(
      `UPDATE groups SET
        name = $1,
        website = $2,
        description = $3,
        our_why_description = $4,
        did_you_know = $5,
        video_link = $6,
        is_approuve_required = $7,
        is_deactivated = $8,
        identifier = $9,
        is_corporate_group = $10,
        is_private_group = $11,
        group_themes = $12,
        meta_title = $13,
        meta_description = $14,
        picture_file_name = $15,
        background_picture_file_name = $16,
        modified_at = NOW()
      WHERE id = $17`,
      [
        updatedFields.name,
        updatedFields.website,
        updatedFields.description,
        updatedFields.our_why_description,
        updatedFields.did_you_know,
        updatedFields.video_link,
        updatedFields.is_approuve_required,
        updatedFields.is_deactivated,
        updatedFields.identifier,
        updatedFields.is_corporate_group,
        updatedFields.is_private_group,
        updatedFields.group_themes,
        updatedFields.meta_title,
        updatedFields.meta_description,
        pictureFileName,
        backgroundPictureFileName,
        id,
      ]
    );

    await logAudit({
      tableName: "groups",
      recordId: String(id),
      actionType: "Modified",
      oldValues,
      newValues: updatedFields,
      updatedBy: req.user?.id || null,
    });

    res.status(200).send();
  } catch (err) {
    console.error("Update group error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const adminUser = (req as any).user;
    if (!adminUser?.isSuperAdmin) {
      res.status(403).json({ message: "Only SuperAdmin can delete groups." });
      return;
    }

    const id = parseInt(String(req.params.id), 10);

    const entity = await pool.query(`SELECT id FROM groups WHERE id = $1`, [id]);
    if (entity.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }

    const deletedBy = adminUser?.id || null;
    const now = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE requests SET is_deleted = true, deleted_at = $1, deleted_by = $2
         WHERE group_to_follow_id = $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [now, deletedBy, id]
      );

      await client.query(
        `UPDATE leader_groups SET is_deleted = true, deleted_at = $1, deleted_by = $2
         WHERE group_id = $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [now, deletedBy, id]
      );

      await client.query(
        `UPDATE group_account_balances SET is_deleted = true, deleted_at = $1, deleted_by = $2
         WHERE group_id = $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [now, deletedBy, id]
      );

      await client.query(
        `UPDATE campaigns SET group_for_private_access_id = NULL
         WHERE group_for_private_access_id = $1`,
        [id]
      );

      await client.query(
        `UPDATE groups SET is_deleted = true, deleted_at = $1, deleted_by = $2 WHERE id = $3`,
        [now, deletedBy, id]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    await logAudit({
      tableName: "groups",
      recordId: String(id),
      actionType: "Deleted",
      oldValues: { id },
      updatedBy: deletedBy,
    });

    res.json({ success: true, message: "Group deleted successfully." });
  } catch (err) {
    console.error("Delete group error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/all-members", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid group id" });
      return;
    }

    const groupResult = await pool.query(
      `SELECT id, name, owner_id, leaders FROM groups WHERE id = $1`,
      [id]
    );
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found" });
      return;
    }
    const group = groupResult.rows[0];

    const memberResult = await pool.query(
      `SELECT DISTINCT request_owner_id
       FROM requests
       WHERE group_to_follow_id = $1
         AND status = 'accepted'
         AND (is_deleted IS NULL OR is_deleted = false)
         AND request_owner_id IS NOT NULL`,
      [id]
    );
    const memberIds = new Set<string>(
      memberResult.rows.map((r: any) => r.request_owner_id)
    );

    const leaderIds = new Set<string>();
    if (group.leaders) {
      try {
        const parsed = JSON.parse(group.leaders);
        for (const l of parsed) {
          const uid = l.UserId || l.userId;
          if (uid) leaderIds.add(uid);
        }
      } catch {}
    }

    // Role priority (highest wins): Owner > Leader > Member.
    const roleByUserId = new Map<string, "Owner" | "Leader" | "Member">();
    for (const uid of memberIds) roleByUserId.set(uid, "Member");
    for (const uid of leaderIds) roleByUserId.set(uid, "Leader");
    if (group.owner_id) roleByUserId.set(group.owner_id, "Owner");

    const allUserIds = [...roleByUserId.keys()];
    if (allUserIds.length === 0) {
      res.json({ groupId: id, groupName: group.name, members: [] });
      return;
    }

    const placeholders = allUserIds.map((_, i) => `$${i + 1}`).join(", ");
    const usersResult = await pool.query(
      `SELECT id,
              COALESCE(first_name, '') AS first_name,
              COALESCE(last_name, '') AS last_name,
              COALESCE(email, '') AS email
       FROM users
       WHERE id IN (${placeholders})
         AND (is_deleted IS NULL OR is_deleted = false)`,
      allUserIds
    );

    const members = usersResult.rows.map((u: any) => ({
      id: u.id,
      fullName: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      role: roleByUserId.get(u.id) || "Member",
    }));

    const rolePriority: Record<string, number> = { Owner: 0, Leader: 1, Member: 2 };
    members.sort((a: any, b: any) => {
      const r = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (r !== 0) return r;
      return (a.fullName || "").localeCompare(b.fullName || "");
    });

    res.json({ groupId: id, groupName: group.name, members });
  } catch (err) {
    console.error("Get group all-members error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/users", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const searchValue = ((req.query.searchValue as string) || (req.query.SearchValue as string) || "").trim().toLowerCase();
    const sortField = ((req.query.sortField as string) || (req.query.SortField as string) || "").toLowerCase();
    const sortDirection = ((req.query.sortDirection as string) || (req.query.SortDirection as string) || "").toLowerCase();
    const isAsc = sortDirection === "asc";

    let searchCondition = "";
    const values: any[] = [id];
    let paramIdx = 2;

    if (searchValue) {
      searchCondition = `AND (LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $${paramIdx} OR LOWER(u.email) LIKE $${paramIdx})`;
      values.push(`%${searchValue}%`);
      paramIdx++;
    }

    let orderClause: string;
    switch (sortField) {
      case "fullname":
        orderClause = `u.first_name ${isAsc ? "ASC" : "DESC"}, u.last_name ${isAsc ? "ASC" : "DESC"}`;
        break;
      case "datecreated":
        orderClause = `u.date_created ${isAsc ? "ASC" : "DESC"}`;
        break;
      default:
        orderClause = `u.first_name ASC, u.last_name ASC`;
    }

    const result = await pool.query(
      `SELECT DISTINCT u.id, COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') as "fullName",
              u.user_name as "userName", u.email, u.date_created as "dateCreated",
              gab.id as gab_id, gab.balance as gab_balance
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       JOIN requests req ON req.request_owner_id = u.id
       LEFT JOIN group_account_balances gab ON gab.user_id = u.id AND gab.group_id = $1
         AND (gab.is_deleted IS NULL OR gab.is_deleted = false)
       WHERE r.name = 'User'
         AND (u.is_deleted IS NULL OR u.is_deleted = false)
         AND req.group_to_follow_id = $1
         AND req.status = 'accepted'
         AND (req.is_deleted IS NULL OR req.is_deleted = false)
         ${searchCondition}
       ORDER BY ${orderClause}`,
      values
    );

    const users = result.rows.map((row: any) => ({
      id: row.id,
      fullName: row.fullName,
      userName: row.userName,
      email: row.email,
      dateCreated: row.dateCreated,
      groupAccountBalance: row.gab_id
        ? { id: row.gab_id, balance: parseFloat(row.gab_balance) || 0 }
        : null,
    }));

    res.json(users);
  } catch (err) {
    console.error("Get group users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/transaction-history/export", async (req: Request, res: Response) => {
  try {
    const groupId = parseInt(String(req.params.id), 10);

    const result = await pool.query(
      `SELECT user_name, change_date, investment_name, payment_type, old_value, new_value, zip_code, comment
       FROM account_balance_change_logs
       WHERE group_id = $1
       ORDER BY id DESC`,
      [groupId]
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("AccountBalanceHistory");

    const headers = ["UserName", "ChangeDate", "InvestmentName", "PaymentType", "OldValue", "NewValue", "ZipCode", "Comment"];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => { cell.font = { bold: true }; });

    for (const row of result.rows) {
      const changeDate = row.change_date
        ? dayjs.utc(row.change_date).format("MM/DD/YYYY")
        : "";

      const dataRow = worksheet.addRow([
        row.user_name || "",
        changeDate,
        row.investment_name || "",
        row.payment_type || "",
        row.old_value != null ? parseFloat(row.old_value) : 0,
        row.new_value != null ? parseFloat(row.new_value) : 0,
        row.zip_code || "",
        row.comment || "",
      ]);

      dataRow.getCell(5).numFmt = "$#,##0.00";
      dataRow.getCell(6).numFmt = "$#,##0.00";
    }

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = maxLen + 10;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="AccountBalanceHistory.xlsx"');
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (err) {
    console.error("Export group transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/transaction-history", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const sortField = ((req.query.sortField as string) || (req.query.SortField as string) || "").toLowerCase();
    const sortDirection = ((req.query.sortDirection as string) || (req.query.SortDirection as string) || "").toLowerCase();
    const isAsc = sortDirection === "asc";

    let orderClause: string;
    switch (sortField) {
      case "changedate":
        orderClause = `change_date ${isAsc ? "ASC" : "DESC"}`;
        break;
      case "investmentname":
        orderClause = `investment_name ${isAsc ? "ASC" : "DESC"}`;
        break;
      default:
        orderClause = `change_date DESC`;
    }

    const result = await pool.query(
      `SELECT id, user_name as "userName", change_date as "changeDate",
              old_value as "oldValue", new_value as "newValue", investment_name as "investmentName"
       FROM account_balance_change_logs
       WHERE group_id = $1
       ORDER BY ${orderClause}`,
      [id]
    );

    const items = result.rows.map((row: any) => ({
      id: row.id,
      userName: row.userName,
      changeDate: row.changeDate
        ? dayjs.utc(row.changeDate).format("MM/DD/YYYY")
        : null,
      oldValue: row.oldValue != null ? parseFloat(row.oldValue) : null,
      newValue: row.newValue != null ? parseFloat(row.newValue) : null,
      investmentName: row.investmentName,
    }));

    res.json(items);
  } catch (err) {
    console.error("Get group transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id/transaction-history", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const email = (req.query.email as string) || "";
    const accountBalance = parseFloat((req.query.accountBalance as string) || "0");
    const comment = (req.query.comment as string) || "";

    if (!email) {
      res.json({ success: false, message: "User email required." });
      return;
    }

    const groupResult = await pool.query(`SELECT id, original_balance FROM groups WHERE id = $1`, [id]);
    if (groupResult.rows.length === 0) {
      res.json({ success: false, message: "Group not found." });
      return;
    }
    const group = groupResult.rows[0];

    const allocResult = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM group_account_balances WHERE group_id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );
    const allocatedTotal = parseFloat(allocResult.rows[0].total) || 0;

    const investedResult = await pool.query(
      `SELECT COALESCE(SUM(old_value - new_value), 0) as total
       FROM account_balance_change_logs
       WHERE group_id = $1
         AND investment_name IS NOT NULL
         AND (transaction_status IS NULL OR transaction_status != 'Rejected')
         AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );
    const investedTotal = parseFloat(investedResult.rows[0].total) || 0;

    let currentBal = group.original_balance ? parseFloat(group.original_balance) : 0;
    if (currentBal !== 0) {
      currentBal = currentBal - (allocatedTotal + investedTotal);
    }

    if (currentBal - accountBalance < 0) {
      res.json({ success: false, message: "Group current balance value can't be less than 0." });
      return;
    }

    let groupBalance = await pool.query(
      `SELECT gab.id, gab.balance, gab.user_id, u.user_name, u.id as uid
       FROM group_account_balances gab
       JOIN users u ON gab.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       WHERE u.email = $1 AND gab.group_id = $2
         AND (gab.is_deleted IS NULL OR gab.is_deleted = false)`,
      [email, id]
    );

    const userResult = await pool.query(`SELECT id, user_name FROM users WHERE email = $1`, [email]);
    if (userResult.rows.length === 0) {
      res.json({ success: false, message: "User not found." });
      return;
    }
    const user = userResult.rows[0];

    if (groupBalance.rows.length === 0) {
      await pool.query(
        `INSERT INTO group_account_balances (user_id, group_id, balance) VALUES ($1, $2, 0)`,
        [user.id, id]
      );
      groupBalance = await pool.query(
        `SELECT id, balance, user_id FROM group_account_balances WHERE user_id = $1 AND group_id = $2`,
        [user.id, id]
      );
    }

    const currentGroupBalance = parseFloat(groupBalance.rows[0].balance) || 0;

    if (currentGroupBalance + accountBalance < 0) {
      res.json({ success: false, message: "Insufficient allocated fund." });
      return;
    }

    const adminUser = (req as any).user;
    const isAdmin = adminUser?.role?.toLowerCase() === "admin" || adminUser?.role?.toLowerCase() === "superadmin" || adminUser?.isSuperAdmin;
    const adminName = isAdmin
      ? `admin user: ${(adminUser.name || adminUser.email || "admin").trim().toLowerCase()}`
      : `group leader: ${(adminUser?.name || adminUser?.email || "user").trim().toLowerCase()}`;

    await pool.query(
      `INSERT INTO user_investments (user_id, payment_type, log_triggered)
       VALUES ($1, $2, false)`,
      [user.id, `Balance updated by ${adminName}`]
    );

    await pool.query(
      `INSERT INTO account_balance_change_logs (user_id, payment_type, old_value, user_name, new_value, group_id, fees, gross_amount, net_amount, comment, change_date)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, $8, NOW())`,
      [
        user.id,
        `Balance updated by ${adminName}`,
        currentGroupBalance,
        user.user_name,
        currentGroupBalance + accountBalance,
        id,
        accountBalance,
        comment.trim() || null,
      ]
    );

    await pool.query(
      `UPDATE group_account_balances SET balance = balance + $1, last_updated = NOW() WHERE id = $2`,
      [accountBalance, groupBalance.rows[0].id]
    );

    await pool.query(
      `UPDATE users SET is_active = true, is_free_user = false WHERE id = $1`,
      [user.id]
    );

    const groupCurrentBalance = currentBal - accountBalance;

    await logAudit({
      tableName: "groups",
      recordId: String(id),
      actionType: "Modified",
      oldValues: { account_balance: currentGroupBalance },
      newValues: { account_balance: currentGroupBalance + accountBalance },
      updatedBy: adminUser?.id || null,
    });

    res.json({ success: true, message: `Group current balance is ${groupCurrentBalance}` });
  } catch (err) {
    console.error("Update group account balance error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ------------------------------------------------------------------ //
// GET /:id/campaign-investments
// Admin view: campaigns linked to this group + member investment totals
// ------------------------------------------------------------------ //
router.get("/:id/campaign-investments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "Invalid group id." });
      return;
    }

    const groupCheck = await pool.query(`SELECT id, name FROM groups WHERE id = $1`, [id]);
    if (groupCheck.rows.length === 0) {
      res.status(404).json({ message: "Group not found." });
      return;
    }

    // Campaigns linked to this group, enriched with group-member investment totals
    const result = await pool.query(
      `WITH group_members AS (
         SELECT DISTINCT request_owner_id AS user_id
           FROM requests
          WHERE group_to_follow_id = $1 AND status = 'accepted'
         UNION
         SELECT owner_id AS user_id FROM groups WHERE id = $1
       )
       SELECT c.id,
              c.name,
              c.stage,
              c.is_active,
              (c.group_for_private_access_id = $1) AS is_private_access,
              COUNT(DISTINCT r.user_id)::int         AS investor_count,
              COALESCE(SUM(r.amount), 0)             AS total_invested
         FROM campaigns c
         LEFT JOIN campaign_groups cg
           ON cg.campaigns_id = c.id AND cg.groups_id = $1
         LEFT JOIN recommendations r
           ON r.campaign_id = c.id
          AND r.user_id IN (SELECT user_id FROM group_members)
          AND r.status = 'approved'
        WHERE cg.campaigns_id IS NOT NULL
           OR c.group_for_private_access_id = $1
        GROUP BY c.id, c.name, c.stage, c.is_active, c.group_for_private_access_id
        ORDER BY c.name`,
      [id],
    );

    res.json({
      groupName: groupCheck.rows[0].name,
      campaigns: result.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        stage: r.stage,
        stageLabel: STAGE_LABELS[r.stage] || `Stage ${r.stage}`,
        isActive: r.is_active,
        isPrivateAccess: r.is_private_access === true,
        investorCount: parseInt(r.investor_count) || 0,
        totalInvested: parseFloat(r.total_invested) || 0,
      })),
    });
  } catch (err) {
    console.error("Get group campaign investments error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
});

router.get("/:id/investments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    const groupResult = await pool.query(`SELECT id FROM groups WHERE id = $1`, [id]);
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found" });
      return;
    }

    const groupCampaignsResult = await pool.query(
      `SELECT c.id, c.name, c.image_file_name as "imageFileName", c.stage
       FROM campaign_groups cg
       JOIN campaigns c ON cg.campaigns_id = c.id
       WHERE cg.groups_id = $1`,
      [id]
    );

    const groupCampaignIds = groupCampaignsResult.rows.map((c: any) => c.id);

    const allActiveCampaigns = await pool.query(
      `SELECT id, name, image_file_name as "imageFileName", stage
       FROM campaigns
       WHERE is_active = true AND (group_for_private_access_id IS NULL)`
    );

    const adminUser = (req as any).user;
    const isAdmin = adminUser?.role?.toLowerCase() === "admin" || adminUser?.role?.toLowerCase() === "superadmin" || adminUser?.isSuperAdmin;

    const publicCampaigns = allActiveCampaigns.rows
      .filter((c: any) => PUBLIC_STAGES.includes(c.stage))
      .filter((c: any) => !groupCampaignIds.includes(c.id));

    const completedCampaigns = isAdmin
      ? allActiveCampaigns.rows
          .filter((c: any) => c.stage === 3)
          .filter((c: any) => !groupCampaignIds.includes(c.id))
      : [];

    const mapStage = (c: any) => ({
      ...c,
      stage: STAGE_LABELS[c.stage] || String(c.stage),
    });

    res.json({
      groupCampaigns: groupCampaignsResult.rows.map(mapStage),
      publicCampaigns: publicCampaigns.map(mapStage),
      completedCampaigns: isAdmin ? completedCampaigns.map(mapStage) : null,
    });
  } catch (err) {
    console.error("Get group investments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id/investments", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const campaignIds: number[] = req.body || [];

    const groupResult = await pool.query(`SELECT id, name, identifier, picture_file_name FROM groups WHERE id = $1`, [id]);
    if (groupResult.rows.length === 0) {
      res.status(404).json({ message: "Group not found" });
      return;
    }

    const oldCampaignsResult = await pool.query(
      `SELECT campaigns_id FROM campaign_groups WHERE groups_id = $1`,
      [id]
    );
    const oldCampaignIds = oldCampaignsResult.rows.map((r: any) => r.campaigns_id);

    await pool.query(`DELETE FROM campaign_groups WHERE groups_id = $1`, [id]);

    if (campaignIds.length > 0) {
      const insertValues: string[] = [];
      const insertParams: number[] = [];
      let paramIdx = 1;
      for (const cid of campaignIds) {
        if (cid != null) {
          insertValues.push(`($${paramIdx}, $${paramIdx + 1})`);
          insertParams.push(cid, id);
          paramIdx += 2;
        }
      }
      if (insertValues.length > 0) {
        await pool.query(
          `INSERT INTO campaign_groups (campaigns_id, groups_id) VALUES ${insertValues.join(", ")}`,
          insertParams
        );
      }
    }

    await logAudit({
      tableName: "groups",
      recordId: String(id),
      actionType: "Modified",
      oldValues: { assigned_campaign_ids: oldCampaignIds },
      newValues: { assigned_campaign_ids: campaignIds },
      updatedBy: (req as any).user?.id || null,
    });

    res.status(200).send();
  } catch (err) {
    console.error("Save group investments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function processGroupMembers(jsonData: string | null, ownerId?: string): Promise<any[]> {
  if (!jsonData) return [];

  let members: any[];
  try {
    members = JSON.parse(jsonData);
  } catch {
    return [];
  }

  if (!members || members.length === 0) return [];

  const userIds = members.map((m: any) => m.UserId || m.userId).filter(Boolean);
  if (userIds.length === 0) return [];

  const placeholders = userIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
  const usersResult = await pool.query(
    `SELECT id, COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') as full_name, picture_file_name, email
     FROM users WHERE id IN (${placeholders}) AND (is_deleted IS NULL OR is_deleted = false)`,
    userIds
  );

  const userLookup: Record<string, any> = {};
  for (const u of usersResult.rows) {
    userLookup[u.id] = u;
  }

  return members.map((m: any) => {
    const userId = m.UserId || m.userId;
    const user = userLookup[userId];
    const result: any = {
      userId,
      roleAndTitle: m.RoleAndTitle || m.roleAndTitle,
      description: m.Description || m.description,
      fullName: user?.full_name || null,
      email: user?.email || null,
      pictureFileName: resolveFileUrl(user?.picture_file_name, "users") || null,
    };

    if (m.LinkedInUrl !== undefined || m.linkedInUrl !== undefined) {
      result.linkedInUrl = m.LinkedInUrl || m.linkedInUrl;
      result.isOwner = ownerId ? userId === ownerId : false;
    }

    if (m.MemberSince !== undefined || m.memberSince !== undefined) {
      result.memberSince = m.MemberSince || m.memberSince;
    }

    return result;
  });
}

async function enrichMembers(members: any[], ownerId?: string): Promise<any[]> {
  return processGroupMembers(JSON.stringify(members), ownerId);
}

export default router;
