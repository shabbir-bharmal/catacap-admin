import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { hashAspNetIdentityV3 } from "../utils/aspnetIdentityHash.js";
import { verifyToken } from "../utils/jwt.js";
import crypto from "crypto";
import ExcelJS from "exceljs";
import { resolveFileUrl } from "../utils/uploadBase64Image.js";
import { logAudit } from "../utils/auditLog.js";
import { restoreUsersWithCascadeInTx } from "../utils/userRestore.js";
import { cascadeSoftDeleteUserData } from "../utils/cascadeUserSoftDelete.js";

const router = Router();

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  user_name: string;
  email: string;
  account_balance: string | number | null;
  is_active: boolean;
  date_created: string;
  is_exclude_user_balance: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

interface GroupInfo {
  id: number | string;
  name: string;
  owner_id?: string;
}

interface PermissionItem {
  moduleId: number;
  moduleName: string;
  isManage: boolean;
  isDelete: boolean;
}

const INTERESTED_INVESTMENT_TYPES: Record<number, string> = {
  0: "EquityFund",
  1: "LoanFund",
  2: "DirectEquity",
  3: "DirectLoan",
};

router.get("/", async (req: Request, res: Response) => {
  try {
    const sortDirection = ((req.query.SortDirection as string) || "").toLowerCase();
    const isAsc = sortDirection === "asc";
    const page = parseInt((req.query.CurrentPage as string) || "1", 10);
    const pageSize = parseInt((req.query.PerPage as string) || "50", 10);
    const searchValue = ((req.query.SearchValue as string) || "").trim().toLowerCase();
    const sortField = ((req.query.SortField as string) || "").toLowerCase();
    const filterByGroup = (req.query.FilterByGroup as string) === "true";
    const isDeletedParam = req.query.IsDeleted as string | undefined;

    const groupAdminRoleResult = await pool.query(
      `SELECT id FROM roles WHERE name = 'GroupAdmin' LIMIT 1`
    );
    const groupAdminRoleId = groupAdminRoleResult.rows[0]?.id;

    let groupAdminUserIds: string[] = [];
    if (groupAdminRoleId) {
      const gaResult = await pool.query(
        `SELECT user_id FROM user_roles WHERE role_id = $1`,
        [groupAdminRoleId]
      );
      groupAdminUserIds = gaResult.rows.map((r: { user_id: string }) => r.user_id);
    }

    const showArchived = isDeletedParam === "true";
    const softDeleteFilter = showArchived
      ? `AND u.is_deleted = true`
      : `AND (u.is_deleted IS NULL OR u.is_deleted = false)`;

    const roleJoin = showArchived
      ? `LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id`
      : `JOIN user_roles ur ON u.id = ur.user_id
         JOIN roles r ON ur.role_id = r.id`;

    const roleFilter = showArchived
      ? ``
      : `AND r.name = 'User'
         AND (ur.is_deleted IS NULL OR ur.is_deleted = false)`;

    let baseQuery = `
      FROM users u
      ${roleJoin}
      WHERE 1=1
      ${roleFilter}
      ${softDeleteFilter}
    `;
    const params: (string | number)[] = [];

    if (searchValue) {
      params.push(`%${searchValue}%`);
      const idx = params.length;
      baseQuery += ` AND (
        LOWER(TRIM(COALESCE(u.first_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.last_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.email, ''))) LIKE $${idx}
      )`;
    }

    if (filterByGroup) {
      baseQuery += ` AND EXISTS (
        SELECT 1 FROM requests req
        WHERE req.request_owner_id = u.id
          AND req.group_to_follow_id IS NOT NULL
          AND LOWER(TRIM(req.status)) = 'accepted'
          AND (req.is_deleted IS NULL OR req.is_deleted = false)
      )`;
    }

    const dir = isAsc ? "ASC" : "DESC";
    let orderClause: string;
    const isRecSorting = sortField === "recommendations";

    switch (sortField) {
      case "fullname":
        orderClause = `ORDER BY u.first_name ${dir}, u.last_name ${dir}`;
        break;
      case "accountbalance":
        orderClause = `ORDER BY u.account_balance ${dir}`;
        break;
      case "datecreated":
        orderClause = `ORDER BY u.date_created ${dir}`;
        break;
      default:
        orderClause = `ORDER BY u.first_name ASC, u.last_name ASC`;
        break;
    }

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT u.id) as total ${baseQuery}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].total, 10);

    let dataQuery: string;
    let dataParams: (string | number)[];

    if (isRecSorting) {
      dataQuery = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.user_name, u.account_balance,
                    u.email, u.is_active, u.date_created, u.is_exclude_user_balance,
                    u.deleted_at, u.deleted_by
             ${baseQuery}
             ORDER BY u.first_name ASC, u.last_name ASC`;
      dataParams = [...params];
    } else {
      const offset = (page - 1) * pageSize;
      dataParams = [...params, pageSize, offset];
      dataQuery = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.user_name, u.account_balance,
                    u.email, u.is_active, u.date_created, u.is_exclude_user_balance,
                    u.deleted_at, u.deleted_by
             ${baseQuery}
             ${orderClause}
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
    }

    const dataResult = await pool.query(dataQuery, dataParams);
    const users = dataResult.rows;

    if (users.length === 0) {
      res.json({ success: false, message: "Data not found." });
      return;
    }

    const emails = [...new Set(users.map((u: UserRow) => (u.email || "").toLowerCase().trim()))];
    const userIds = users.map((u: UserRow) => u.id);

    const recSoftDeleteFilter = isDeletedParam === "true"
      ? `AND is_deleted = true`
      : `AND (is_deleted IS NULL OR is_deleted = false)`;

    const recCountResult = await pool.query(
      `SELECT LOWER(TRIM(user_email)) as email, COUNT(*) as count
       FROM recommendations
       WHERE amount > 0
         AND (status = 'pending' OR status = 'approved')
         AND LOWER(TRIM(user_email)) = ANY($1)
         ${recSoftDeleteFilter}
       GROUP BY LOWER(TRIM(user_email))`,
      [emails]
    );
    const recCounts: Record<string, number> = {};
    for (const r of recCountResult.rows) {
      recCounts[r.email] = parseInt(r.count, 10);
    }

    const groupsResult = await pool.query(
      `SELECT req.request_owner_id as user_id, g.id as group_id, g.name as group_name
       FROM requests req
       JOIN groups g ON req.group_to_follow_id = g.id
       WHERE req.request_owner_id = ANY($1)
         AND LOWER(TRIM(req.status)) = 'accepted'
         AND req.group_to_follow_id IS NOT NULL
         AND (req.is_deleted IS NULL OR req.is_deleted = false)`,
      [userIds]
    );
    const userGroupsMap: Record<string, GroupInfo[]> = {};
    for (const r of groupsResult.rows) {
      if (!userGroupsMap[r.user_id]) userGroupsMap[r.user_id] = [];
      const existing = userGroupsMap[r.user_id].find((g: GroupInfo) => g.id === r.group_id);
      if (!existing) {
        userGroupsMap[r.user_id].push({ id: r.group_id, name: r.group_name });
      }
    }

    const gabResult = await pool.query(
      `SELECT user_id, group_id, balance
       FROM group_account_balances
       WHERE user_id = ANY($1)
         AND (is_deleted IS NULL OR is_deleted = false)`,
      [userIds]
    );
    const gabMap: Record<string, Record<string, number>> = {};
    for (const r of gabResult.rows) {
      if (!gabMap[r.user_id]) gabMap[r.user_id] = {};
      gabMap[r.user_id][r.group_id] = parseFloat(r.balance) || 0;
    }

    let deletedByNames: Record<string, string> = {};
    const deletedByIds = [...new Set(users.filter((u: UserRow) => u.deleted_by).map((u: UserRow) => u.deleted_by))];
    if (deletedByIds.length > 0) {
      const dbResult = await pool.query(
        `SELECT id, first_name, last_name FROM users WHERE id = ANY($1)`,
        [deletedByIds]
      );
      for (const r of dbResult.rows) {
        deletedByNames[r.id] = `${r.first_name || ""} ${r.last_name || ""}`.trim();
      }
    }

    let result = users.map((u: UserRow) => {
      const emailKey = (u.email || "").toLowerCase().trim();
      const acceptedGroups: GroupInfo[] = userGroupsMap[u.id] || [];
      const userGab = gabMap[u.id] || {};

      return {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        fullName: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
        userName: u.user_name,
        accountBalance: u.account_balance != null ? parseFloat(String(u.account_balance)) : null,
        email: u.email,
        isActive: u.is_active,
        dateCreated: u.date_created,
        isGroupAdmin: groupAdminUserIds.includes(u.id),
        isExcludeUserBalance: u.is_exclude_user_balance || false,
        recommendationsCount: recCounts[emailKey] || 0,
        groupNames: acceptedGroups.map((g) => g.name).join(","),
        groupBalances: acceptedGroups
          .map((g) => {
            const bal = userGab[g.id];
            return bal != null ? bal.toFixed(2) : "0.00";
          })
          .join(","),
        deletedAt: u.deleted_at || null,
        deletedBy: u.deleted_by ? (deletedByNames[u.deleted_by] || null) : null,
      };
    });

    if (isRecSorting) {
      result.sort((a, b) => {
        if (isAsc) return a.recommendationsCount - b.recommendationsCount;
        return b.recommendationsCount - a.recommendationsCount;
      });
      result = result.slice((page - 1) * pageSize, page * pageSize);
    }

    res.json({ items: result, totalCount });
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/by-token", async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ message: "Token is required" });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    const userResult = await pool.query(
      `SELECT id, email, first_name, last_name, picture_file_name, user_name, two_factor_enabled
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      res.status(400).json({ message: "User not found" });
      return;
    }

    const user = userResult.rows[0];

    const userRoleResult = await pool.query(
      `SELECT r.id, r.name, r.is_super_admin
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1
         AND (ur.is_deleted IS NULL OR ur.is_deleted = false)`,
      [user.id]
    );

    const userRoles = userRoleResult.rows;
    const isSuperAdmin = userRoles.some((r: { is_super_admin: boolean }) => r.is_super_admin === true);

    let permissions: PermissionItem[] = [];

    if (userRoles.length > 0 && !isSuperAdmin) {
      const roleIds = userRoles.map((r: { id: string }) => r.id);
      const permResult = await pool.query(
        `SELECT m.id as module_id, m.name as module_name, map.manage, map.delete
         FROM module_access_permissions map
         JOIN modules m ON map.module_id = m.id
         WHERE map.role_id = ANY($1)`,
        [roleIds]
      );

      const permMap = new Map<number, PermissionItem>();
      for (const p of permResult.rows) {
        const moduleId = Number(p.module_id);
        const existing = permMap.get(moduleId);
        if (existing) {
          existing.isManage = existing.isManage || (p.manage === true);
          existing.isDelete = existing.isDelete || (p.delete === true);
        } else {
          permMap.set(moduleId, {
            moduleId,
            moduleName: p.module_name,
            isManage: p.manage === true,
            isDelete: p.delete === true,
          });
        }
      }
      permissions = Array.from(permMap.values());
    }

    res.json({
      email: user.email,
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      pictureFileName: resolveFileUrl(user.picture_file_name, "users") || "",
      userName: user.user_name,
      twoFactorEnabled: user.two_factor_enabled === true,
      roleName: userRoles.length > 0 ? (userRoles[0].name || "") : "",
      roles: userRoles.map((r: { name: string }) => r.name || ""),
      isSuperAdmin,
      permissions: isSuperAdmin ? [] : permissions,
    });
  } catch (err) {
    console.error("Get user by token error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/dropdown", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT u.id, u.email, COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') as full_name
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE r.name = 'User'
         AND (ur.is_deleted IS NULL OR ur.is_deleted = false)
         AND (u.is_deleted IS NULL OR u.is_deleted = false)`
    );

    const items = result.rows.map((r: { id: string; email: string; full_name: string }) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
    }));

    res.json(items);
  } catch (err) {
    console.error("Get dropdown users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Search users by email (typeahead). Returns up to `limit` matches across ALL users
// (not restricted to admins) so any user can be assigned as an "Investment Owner".
router.get("/email-search", async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || "").trim().toLowerCase();
    const limitRaw = parseInt((req.query.limit as string) || "20", 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 50);

    if (!q) {
      res.json({ items: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id, email, first_name, last_name
       FROM users
       WHERE (is_deleted IS NULL OR is_deleted = false)
         AND email IS NOT NULL
         AND TRIM(email) <> ''
         AND LOWER(email) LIKE $1
       ORDER BY
         CASE WHEN LOWER(email) = $2 THEN 0
              WHEN LOWER(email) LIKE $3 THEN 1
              ELSE 2 END,
         email ASC
       LIMIT $4`,
      [`%${q}%`, q, `${q}%`, limit]
    );

    const items = result.rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      firstName: r.first_name || null,
      lastName: r.last_name || null,
      fullName: `${r.first_name || ""} ${r.last_name || ""}`.trim() || null,
    }));

    res.json({ items });
  } catch (err) {
    console.error("Email-search users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Look up a single user by exact (case-insensitive) email. Used to validate that
// a stored Investment Owner email still corresponds to a real user.
router.get("/email-lookup", async (req: Request, res: Response) => {
  try {
    const email = ((req.query.email as string) || "").trim().toLowerCase();
    if (!email) {
      res.json({ user: null });
      return;
    }

    const result = await pool.query(
      `SELECT id, email, first_name, last_name
       FROM users
       WHERE (is_deleted IS NULL OR is_deleted = false)
         AND LOWER(TRIM(email)) = $1
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      res.json({ user: null });
      return;
    }

    const r = result.rows[0];
    res.json({
      user: {
        id: r.id,
        email: r.email,
        firstName: r.first_name || null,
        lastName: r.last_name || null,
        fullName: `${r.first_name || ""} ${r.last_name || ""}`.trim() || null,
      },
    });
  } catch (err) {
    console.error("Email-lookup user error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/admin-users-dropdown", async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    let query = `
      SELECT DISTINCT u.id, u.email, u.alternate_email, u.first_name as full_name
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'Admin'
        AND u.user_name != 'admin2'
        AND (ur.is_deleted IS NULL OR ur.is_deleted = false)
        AND (u.is_deleted IS NULL OR u.is_deleted = false)
    `;
    const params: string[] = [];

    if (currentUserId) {
      params.push(currentUserId);
      query += ` AND u.id != $${params.length}`;
    }

    const result = await pool.query(query, params);

    const items = result.rows.map((r: { id: string; email: string; alternate_email: string; full_name: string }) => ({
      id: r.id,
      email: r.email,
      alternateEmail: r.alternate_email,
      fullName: r.full_name,
    }));

    res.json(items);
  } catch (err) {
    console.error("Get admin users dropdown error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/get-all-admin-users", async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;

    let query = `
      SELECT DISTINCT u.id, u.email, u.alternate_email, u.first_name as full_name
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'Admin'
        AND u.user_name != 'admin2'
        AND (ur.is_deleted IS NULL OR ur.is_deleted = false)
        AND (u.is_deleted IS NULL OR u.is_deleted = false)
    `;
    const params: string[] = [];

    if (currentUserId) {
      params.push(currentUserId);
      query += ` AND u.id != $${params.length}`;
    }

    const result = await pool.query(query, params);

    const items = result.rows.map((r: { id: string; email: string; alternate_email: string; full_name: string }) => ({
      id: r.id,
      email: r.email,
      alternateEmail: r.alternate_email,
      fullName: r.full_name,
    }));

    res.json(items);
  } catch (err) {
    console.error("Get all admin users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const groupAdminRoleResult = await pool.query(
      `SELECT id FROM roles WHERE name = 'GroupAdmin' LIMIT 1`
    );
    const groupAdminRoleId = groupAdminRoleResult.rows[0]?.id;

    let groupAdminUserIds: string[] = [];
    if (groupAdminRoleId) {
      const gaResult = await pool.query(
        `SELECT user_id FROM user_roles WHERE role_id = $1`,
        [groupAdminRoleId]
      );
      groupAdminUserIds = gaResult.rows.map((r: { user_id: string }) => r.user_id);
    }

    const usersResult = await pool.query(
      `SELECT DISTINCT u.id, u.user_name, u.first_name, u.last_name, u.email,
              u.is_exclude_user_balance,
              LOWER(TRIM(u.email)) as normalized_email,
              u.is_active, u.account_balance, u.zip_code, u.date_created
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE r.name = 'User'
         AND (u.is_deleted IS NULL OR u.is_deleted = false)
         AND (ur.is_deleted IS NULL OR ur.is_deleted = false)`
    );
    const users = usersResult.rows;
    const userIds = users.map((u: { id: string }) => u.id);
    const userEmails = users.map((u: { email: string }) => (u.email || "").toLowerCase().trim());

    const groupsResult = await pool.query(
      `SELECT id, name, owner_id FROM groups
       WHERE owner_id IS NOT NULL
         AND (is_deleted IS NULL OR is_deleted = false)`
    );
    const groups = groupsResult.rows as GroupInfo[];

    const investmentsResult = await pool.query(
      `SELECT LOWER(TRIM(user_email)) as email, SUM(amount) as amount
       FROM recommendations
       WHERE LOWER(TRIM(user_email)) = ANY($1)
         AND (status = 'approved' OR status = 'pending')
         AND (is_deleted IS NULL OR is_deleted = false)
       GROUP BY LOWER(TRIM(user_email))`,
      [userEmails]
    );
    const investmentsDict: Record<string, number> = {};
    for (const r of investmentsResult.rows) {
      investmentsDict[r.email] = parseFloat(r.amount) || 0;
    }

    const userGroupsResult = await pool.query(
      `SELECT request_owner_id as user_id, array_agg(DISTINCT group_to_follow_id) as group_ids
       FROM requests
       WHERE request_owner_id = ANY($1)
         AND group_to_follow_id IS NOT NULL
         AND status = 'accepted'
         AND (is_deleted IS NULL OR is_deleted = false)
       GROUP BY request_owner_id`,
      [userIds]
    );
    const userGroupsDict: Record<string, number[]> = {};
    for (const r of userGroupsResult.rows) {
      userGroupsDict[r.user_id] = r.group_ids;
    }

    const themesResult = await pool.query(
      `SELECT id, name FROM themes WHERE (is_deleted IS NULL OR is_deleted = false)`
    );
    const allThemes = themesResult.rows;

    const feedbackResult = await pool.query(
      `SELECT DISTINCT ON (user_id) user_id, themes, additional_themes,
              interested_investment_type, risk_tolerance
       FROM investment_feedbacks
       WHERE (is_deleted IS NULL OR is_deleted = false)
       ORDER BY user_id, id DESC`
    );
    const feedbackDict: Record<string, any> = {};
    for (const r of feedbackResult.rows) {
      feedbackDict[r.user_id] = r;
    }

    const recCountResult = await pool.query(
      `SELECT LOWER(TRIM(user_email)) as email, COUNT(*) as count
       FROM recommendations
       WHERE amount > 0
         AND (status = 'pending' OR status = 'approved')
         AND LOWER(TRIM(user_email)) = ANY($1)
         AND (is_deleted IS NULL OR is_deleted = false)
       GROUP BY LOWER(TRIM(user_email))`,
      [userEmails]
    );
    const recCounts: Record<string, number> = {};
    for (const r of recCountResult.rows) {
      recCounts[r.email] = parseInt(r.count, 10);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Users");

    const headers = [
      "UserName", "First Name", "Last Name", "Email", "Is Active", "Recommendations",
      "Amount Invested", "Account Balance", "Following Groups",
      "Owned Group Name", "Group Admin", "Exclude User Balance", "Survey Themes",
      "Survey Additional Themes", "Survey Investment Interest", "Survey Risk Tolerance",
      "Zip Code", "Date Created",
    ];

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };

    for (const user of users) {
      const normalizedEmail = (user.email || "").toLowerCase().trim();
      const feedback = feedbackDict[user.id];
      const recCount = recCounts[normalizedEmail] || 0;
      const investedAmount = investmentsDict[normalizedEmail] || 0;
      const groupAdmin = groupAdminUserIds.includes(user.id) ? "Yes" : null;

      const followingGroupIds = userGroupsDict[user.id] || [];
      const followingNames = groups
        .filter((g) => followingGroupIds.includes(Number(g.id)))
        .map((g) => g.name)
        .join(", ");

      const ownedNames = groups
        .filter((g) => g.owner_id === user.id)
        .map((g) => g.name)
        .join(", ");

      let themeNames = "";
      if (feedback?.themes) {
        const themeIds = feedback.themes
          .split(",")
          .filter((s: string) => s.trim())
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((n: number) => !isNaN(n));
        const uniqueIds = [...new Set(themeIds)];
        themeNames = allThemes
          .filter((t: { id: number; name: string }) => uniqueIds.includes(Number(t.id)))
          .map((t: { id: number; name: string }) => t.name)
          .join(", ");
      }

      let typeNames = "";
      if (feedback?.interested_investment_type) {
        const typeIds = feedback.interested_investment_type
          .split(",")
          .filter((s: string) => s.trim())
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((n: number) => !isNaN(n));
        const uniqueTypeIds = [...new Set(typeIds)] as number[];
        typeNames = uniqueTypeIds
          .map((id) => INTERESTED_INVESTMENT_TYPES[id] || "")
          .filter(Boolean)
          .join(", ");
      }

      const row = worksheet.addRow([
        user.user_name,
        user.first_name,
        user.last_name,
        user.email,
        user.is_active === true ? "Active" : "Inactive",
        recCount,
        investedAmount,
        parseFloat(user.account_balance) || 0,
        followingNames,
        ownedNames,
        groupAdmin,
        user.is_exclude_user_balance ? "Yes" : null,
        themeNames,
        feedback?.additional_themes || null,
        typeNames,
        feedback?.risk_tolerance != null ? String(feedback.risk_tolerance) : "",
        user.zip_code,
        user.date_created ? new Date(user.date_created) : "",
      ]);

      const amountInvestedCell = row.getCell(7);
      amountInvestedCell.numFmt = "$#,##0.00";

      const amountInAccountCell = row.getCell(8);
      amountInAccountCell.numFmt = "$#,##0.00";

      const dateCreatedCell = row.getCell(18);
      dateCreatedCell.numFmt = "MM/DD/YYYY";
      dateCreatedCell.alignment = { horizontal: "left" };
    }

    worksheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const length = cell.value ? cell.value.toString().length : 0;
        if (length > maxLength) maxLength = length;
      });
      column.width = maxLength + 10;
    });

    const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="users.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/account-balance", async (req: Request, res: Response) => {
  try {
    const email = req.query.email as string;
    const accountBalance = parseFloat(req.query.accountBalance as string);
    const comment = (req.query.comment as string) || null;

    if (!email) {
      res.json({ success: false, message: "User email required." });
      return;
    }

    if (isNaN(accountBalance)) {
      res.json({ success: false, message: "Invalid account balance value." });
      return;
    }

    const userResult = await pool.query(
      `SELECT id, email, user_name, account_balance, is_free_user FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const user = userResult.rows[0];
    const currentBalance = parseFloat(user.account_balance) || 0;

    if (currentBalance + accountBalance < 0) {
      res.json({ success: false, message: "Insufficient balance in user account." });
      return;
    }

    const loginUser = req.user;
    const loginUserResult = await pool.query(
      `SELECT user_name FROM users WHERE id = $1`,
      [loginUser?.id]
    );
    const loginUserName = loginUserResult.rows[0]?.user_name || "unknown";

    const newBalance = currentBalance + accountBalance;
    const trimmedComment = comment?.trim() || null;

    await pool.query(
      `INSERT INTO account_balance_change_logs
        (user_id, payment_type, old_value, user_name, new_value, comment, change_date)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        user.id,
        `Balance updated by admin user, ${loginUserName.trim().toLowerCase()}`,
        currentBalance,
        user.user_name,
        newBalance,
        trimmedComment,
      ]
    );

    let updateQuery = `UPDATE users SET account_balance = $1`;
    const updateParams: (string | number | boolean)[] = [newBalance];

    if (user.is_free_user === true) {
      updateQuery += `, is_free_user = false`;
    }

    updateParams.push(user.id);
    updateQuery += ` WHERE id = $${updateParams.length}`;

    await pool.query(updateQuery, updateParams);

    await logAudit({
      tableName: "users",
      recordId: user.id,
      actionType: "Modified",
      oldValues: { account_balance: currentBalance },
      newValues: { account_balance: newBalance },
      updatedBy: loginUser?.id || null,
    });

    res.json({ success: true, message: "Account balance has been updated successfully!" });
  } catch (err) {
    console.error("Update account balance error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  try {
    const ids: string[] = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    const client = await pool.connect();
    let restoredUsers: { id: string; email: string | null }[] = [];
    try {
      await client.query("BEGIN");
      restoredUsers = await restoreUsersWithCascadeInTx(client, ids);
      if (restoredUsers.length === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "No deleted users found." });
        return;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    for (const user of restoredUsers) {
      await logAudit({
        tableName: "users",
        recordId: user.id,
        actionType: "Modified",
        oldValues: { is_deleted: true },
        newValues: { is_deleted: false },
        updatedBy: req.user?.id || null,
      });
    }

    res.json({ success: true, message: `${restoredUsers.length} user(s) restored successfully.` });
  } catch (err) {
    console.error("Restore users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/admin-users", async (req: Request, res: Response) => {
  try {
    const sortDirection = ((req.query.SortDirection as string) || "").toLowerCase();
    const isAsc = sortDirection === "asc";
    const page = parseInt((req.query.CurrentPage as string) || "1", 10);
    const pageSize = parseInt((req.query.PerPage as string) || "50", 10);
    const searchValue = ((req.query.SearchValue as string) || "").trim().toLowerCase();
    const sortField = ((req.query.SortField as string) || "").toLowerCase();

    let baseQuery = `
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name != 'User' AND r.name != 'GroupAdmin'
        AND (ur.is_deleted IS NULL OR ur.is_deleted = false)
    `;
    const params: (string | number)[] = [];

    if (searchValue) {
      params.push(`%${searchValue}%`);
      const idx = params.length;
      baseQuery += ` AND (
        LOWER(TRIM(COALESCE(u.first_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.last_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) LIKE $${idx}
        OR LOWER(TRIM(COALESCE(u.email, ''))) LIKE $${idx}
      )`;
    }

    let orderClause: string;
    const dir = isAsc ? "ASC" : "DESC";
    switch (sortField) {
      case "fullname":
        orderClause = `ORDER BY u.first_name ${dir}, u.last_name ${dir}`;
        break;
      case "datecreated":
        orderClause = `ORDER BY u.date_created ${dir}`;
        break;
      case "rolename":
        orderClause = `ORDER BY r.name ${dir}`;
        break;
      case "email":
        orderClause = `ORDER BY u.email ${dir}`;
        break;
      default:
        orderClause = `ORDER BY u.first_name ASC, u.last_name ASC`;
        break;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total ${baseQuery}`,
      params
    );
    const totalCount = parseInt(countResult.rows[0].total, 10);

    const offset = (page - 1) * pageSize;
    const dataParams = [...params, pageSize, offset];
    const dataResult = await pool.query(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') as full_name,
              u.user_name, u.email, u.is_active, u.two_factor_enabled, u.date_created,
              ur.role_id, r.name as role_name
       ${baseQuery}
       ${orderClause}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const items = dataResult.rows.map((row: { id: string; first_name: string; last_name: string; full_name: string; user_name: string; email: string; is_active: boolean; two_factor_enabled: boolean; date_created: string; role_id: string; role_name: string }) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: row.full_name,
      userName: row.user_name,
      email: row.email,
      isActive: row.is_active,
      twoFactorEnabled: row.two_factor_enabled === true,
      dateCreated: row.date_created,
      roleId: row.role_id,
      roleName: row.role_name,
    }));
    res.json({ items, totalCount });
  } catch (err) {
    console.error("Get admin users error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/admin-users", async (req: Request, res: Response) => {
  try {
    const { id, email, firstName, lastName, userName, password, isActive, twoFactorEnabled, roleId } = req.body;

    if (!email || !email.trim()) {
      res.json({ success: false, message: "Email is required." });
      return;
    }

    if (!firstName || !firstName.trim()) {
      res.json({ success: false, message: "First name is required." });
      return;
    }

    if (!lastName || !lastName.trim()) {
      res.json({ success: false, message: "Last name is required." });
      return;
    }

    if (!id && (!password || !password.trim())) {
      res.json({ success: false, message: "Password is required for new user." });
      return;
    }

    if (!roleId || !roleId.trim()) {
      res.json({ success: false, message: "Role is required." });
      return;
    }

    if (id) {
      const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
      if (userResult.rows.length === 0) {
        res.json({ success: false, message: "User not found." });
        return;
      }
      const user = userResult.rows[0];
      const oldValues = {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        user_name: user.user_name,
        is_active: user.is_active,
        two_factor_enabled: user.two_factor_enabled === true,
      };

      const emailDup = await pool.query(
        "SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND id != $2",
        [email, id]
      );
      if (emailDup.rows.length > 0) {
        res.json({ success: false, message: "Email already exists." });
        return;
      }

      if (userName) {
        const usernameDup = await pool.query(
          "SELECT id FROM users WHERE user_name = $1 AND id != $2",
          [userName, id]
        );
        if (usernameDup.rows.length > 0) {
          res.json({ success: false, message: "Username already exists." });
          return;
        }
      }

      let passwordHash = user.password_hash;
      if (password && password.trim()) {
        passwordHash = hashAspNetIdentityV3(password);
      }

      await pool.query(
        `UPDATE users SET first_name = $1, last_name = $2, email = $3, user_name = $4,
         is_active = $5, password_hash = $6, normalized_email = $7, normalized_user_name = $8,
         two_factor_enabled = $9
         WHERE id = $10`,
        [
          firstName,
          lastName,
          email,
          userName,
          isActive ?? false,
          passwordHash,
          email.toUpperCase().trim(),
          userName ? userName.toUpperCase() : null,
          twoFactorEnabled ?? user.two_factor_enabled === true,
          id,
        ]
      );

      const existingRole = await pool.query(
        "SELECT role_id FROM user_roles WHERE user_id = $1 AND (is_deleted IS NULL OR is_deleted = false)",
        [id]
      );

      if (existingRole.rows.length > 0) {
        if (existingRole.rows[0].role_id !== roleId) {
          await pool.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
          await pool.query(
            "INSERT INTO user_roles (user_id, role_id, discriminator, is_deleted) VALUES ($1, $2, $3, false)",
            [id, roleId, "IdentityUserRole<string>"]
          );
        }
      } else {
        await pool.query(
          "INSERT INTO user_roles (user_id, role_id, discriminator, is_deleted) VALUES ($1, $2, $3, false)",
          [id, roleId, "IdentityUserRole<string>"]
        );
      }

      await logAudit({
        tableName: "users",
        recordId: id,
        actionType: "Modified",
        oldValues,
        newValues: {
          first_name: firstName,
          last_name: lastName,
          email,
          user_name: userName,
          is_active: isActive ?? false,
          two_factor_enabled: twoFactorEnabled ?? user.two_factor_enabled === true,
        },
        updatedBy: req.user?.id || null,
      });

      res.json({ success: true, message: "Admin user updated successfully." });
    } else {
      const existsUsername = await pool.query(
        "SELECT id FROM users WHERE user_name = $1",
        [userName]
      );
      if (existsUsername.rows.length > 0) {
        res.json({ success: false, message: "Username already exists." });
        return;
      }

      const duplicateEmail = await pool.query(
        "SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))",
        [email]
      );
      if (duplicateEmail.rows.length > 0) {
        res.json({ success: false, message: "Email is already registered." });
        return;
      }

      const roleResult = await pool.query("SELECT id, name FROM roles WHERE id = $1", [roleId]);
      if (roleResult.rows.length === 0) {
        res.json({ success: false, message: "Invalid role selected." });
        return;
      }

      const userId = crypto.randomUUID();
      const passwordHash = hashAspNetIdentityV3(password);
      const securityStamp = crypto.randomUUID();
      const concurrencyStamp = crypto.randomUUID();

      await pool.query(
        `INSERT INTO users (id, first_name, last_name, email, normalized_email,
         user_name, normalized_user_name, password_hash, security_stamp,
         concurrency_stamp, is_active, date_created, email_confirmed,
         phone_number_confirmed, two_factor_enabled, lockout_enabled,
         access_failed_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), false, false, $12, true, 0)`,
        [
          userId,
          firstName,
          lastName,
          email.toLowerCase().trim(),
          email.toUpperCase().trim(),
          userName,
          userName ? userName.toUpperCase() : null,
          passwordHash,
          securityStamp,
          concurrencyStamp,
          isActive ?? false,
          twoFactorEnabled ?? false,
        ]
      );

      await pool.query(
        "INSERT INTO user_roles (user_id, role_id, discriminator, is_deleted) VALUES ($1, $2, $3, false)",
        [userId, roleId, "IdentityUserRole<string>"]
      );

      await logAudit({
        tableName: "users",
        recordId: userId,
        actionType: "Created",
        newValues: {
          first_name: firstName,
          last_name: lastName,
          email: email.toLowerCase().trim(),
          user_name: userName,
          is_active: isActive ?? false,
          two_factor_enabled: twoFactorEnabled ?? false,
        },
        updatedBy: req.user?.id || null,
      });

      res.json({ success: true, message: "Admin user created successfully." });
    }
  } catch (err) {
    console.error("Save admin user error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/", async (req: Request, res: Response) => {
  try {
    const { token, email, firstName, lastName, userName } = req.body;
    const jwtUser = req.user;

    if (!token && !jwtUser) {
      res.json({ success: false, message: "User not found" });
      return;
    }

    const userResult = await pool.query(
      `SELECT id, email, user_name, first_name, last_name FROM users WHERE id = $1`,
      [jwtUser?.id]
    );

    if (userResult.rows.length === 0) {
      res.json({ success: false, message: "User not found" });
      return;
    }

    const existingUser = userResult.rows[0];

    if (email) {
      const dupEmail = await pool.query(
        `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND id != $2`,
        [email, existingUser.id]
      );
      if (dupEmail.rows.length > 0) {
        res.json({ success: false, message: "Duplicate email exists." });
        return;
      }
    }

    if (userName) {
      const dupUsername = await pool.query(
        `SELECT id FROM users WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1)) AND id != $2`,
        [userName, existingUser.id]
      );
      if (dupUsername.rows.length > 0) {
        res.json({ success: false, message: "Duplicate username exists." });
        return;
      }
    }

    if (email && email.toLowerCase().trim() !== (existingUser.email || "").toLowerCase().trim()) {
      await pool.query(
        `UPDATE recommendations SET user_email = $1 WHERE LOWER(TRIM(user_email)) = LOWER(TRIM($2))`,
        [email, existingUser.email]
      );
    }

    const fullName = `${firstName || ""} ${lastName || ""}`.trim();
    await pool.query(
      `UPDATE recommendations SET user_full_name = $1 WHERE LOWER(TRIM(user_email)) = LOWER(TRIM($2))`,
      [fullName, existingUser.email]
    );

    if (userName && userName !== existingUser.user_name) {
      await pool.query(
        `UPDATE account_balance_change_logs SET user_name = $1 WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($2))`,
        [userName, existingUser.user_name]
      );
    }

    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, user_name = COALESCE($3, user_name), email = COALESCE($4, email) WHERE id = $5`,
      [firstName || null, lastName || null, userName || null, email || null, existingUser.id]
    );

    await logAudit({
      tableName: "users",
      recordId: existingUser.id,
      actionType: "Modified",
      oldValues: {
        first_name: existingUser.first_name,
        last_name: existingUser.last_name,
        user_name: existingUser.user_name,
        email: existingUser.email,
      },
      newValues: {
        first_name: firstName || null,
        last_name: lastName || null,
        user_name: userName || existingUser.user_name,
        email: email || existingUser.email,
      },
      updatedBy: jwtUser?.id || null,
    });

    res.json({ success: true, message: "Profile details updated successfully." });
  } catch (err) {
    console.error("Update user profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/two-factor", async (req: Request, res: Response) => {
  try {
    const jwtUser = req.user;
    if (!jwtUser?.id) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const { twoFactorEnabled } = req.body ?? {};
    if (typeof twoFactorEnabled !== "boolean") {
      res.status(400).json({ success: false, message: "twoFactorEnabled must be a boolean." });
      return;
    }

    const userResult = await pool.query(
      `SELECT id, two_factor_enabled FROM users WHERE id = $1`,
      [jwtUser.id]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const existingUser = userResult.rows[0];
    const previousValue = existingUser.two_factor_enabled === true;

    if (previousValue === twoFactorEnabled) {
      res.json({ success: true, message: "No change.", twoFactorEnabled });
      return;
    }

    await pool.query(
      `UPDATE users SET two_factor_enabled = $1 WHERE id = $2`,
      [twoFactorEnabled, existingUser.id]
    );

    await logAudit({
      tableName: "users",
      recordId: existingUser.id,
      actionType: "Modified",
      oldValues: { two_factor_enabled: previousValue },
      newValues: { two_factor_enabled: twoFactorEnabled },
      updatedBy: jwtUser.id,
    });

    res.json({
      success: true,
      message: twoFactorEnabled
        ? "Two-factor authentication enabled."
        : "Two-factor authentication disabled.",
      twoFactorEnabled,
    });
  } catch (err) {
    console.error("Update two-factor error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

router.patch("/:id/settings", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const isActive = req.query.isActive as string | undefined;
    const isExcludeUserBalance = req.query.isExcludeUserBalance as string | undefined;
    const twoFactorEnabled = req.query.twoFactorEnabled as string | undefined;

    if (!id || !(id as string).trim()) {
      res.status(400).json({ message: "User id is required." });
      return;
    }

    const userResult = await pool.query(
      "SELECT id, is_active, is_exclude_user_balance, two_factor_enabled FROM users WHERE id = $1",
      [id]
    );
    if (userResult.rows.length === 0) {
      res.status(404).json({ message: "User not found." });
      return;
    }

    const currentUser = userResult.rows[0];
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    const updates: string[] = [];
    const values: (string | boolean)[] = [];
    let paramIdx = 1;

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIdx++}`);
      values.push(isActive === "true");
      oldValues.is_active = currentUser.is_active;
      newValues.is_active = isActive === "true";
    }

    if (isExcludeUserBalance !== undefined) {
      updates.push(`is_exclude_user_balance = $${paramIdx++}`);
      values.push(isExcludeUserBalance === "true");
      oldValues.is_exclude_user_balance = currentUser.is_exclude_user_balance;
      newValues.is_exclude_user_balance = isExcludeUserBalance === "true";
    }

    if (twoFactorEnabled !== undefined) {
      updates.push(`two_factor_enabled = $${paramIdx++}`);
      values.push(twoFactorEnabled === "true");
      oldValues.two_factor_enabled = currentUser.two_factor_enabled === true;
      newValues.two_factor_enabled = twoFactorEnabled === "true";
    }

    if (updates.length === 0) {
      res.status(400).json({ message: "No settings to update." });
      return;
    }

    values.push(id as string);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    if (result.rowCount && result.rowCount > 0) {
      await logAudit({
        tableName: "users",
        recordId: id as string,
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
    console.error("Update settings error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;

    const userResult = await pool.query(
      `SELECT id, email FROM users WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const user = userResult.rows[0];
    const now = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Hard-delete access-control mappings so a deleted user cannot retain
      // admin access. These are intentionally NOT soft-deleted.
      await client.query(
        `DELETE FROM module_access_permissions WHERE updated_by = $1`,
        [id]
      );

      const userRoleIds = await client.query(
        `SELECT role_id FROM user_roles WHERE user_id = $1`,
        [id]
      );
      const roleIds = userRoleIds.rows.map((r: { role_id: string }) => r.role_id);
      if (roleIds.length > 0) {
        await client.query(
          `DELETE FROM module_access_permissions WHERE role_id = ANY($1)`,
          [roleIds]
        );
      }

      // Cascade soft-delete to all related records owned by this user so
      // they no longer appear in admin lists, dashboards, or exports.
      const cascade = await cascadeSoftDeleteUserData(
        client,
        String(id),
        user.email || null,
        currentUserId || null
      );

      await client.query(
        `UPDATE users SET is_deleted = true, deleted_at = $1, deleted_by = $2
         WHERE id = $3`,
        [now, currentUserId, id]
      );

      console.log(
        `[DELETE_USER] user=${id} cascade soft-deleted ${cascade.totalSoftDeleted} related row(s):`,
        cascade.perTable
      );

      await client.query("COMMIT");

      await logAudit({
        tableName: "users",
        recordId: String(id),
        actionType: "Deleted",
        oldValues: { email: user.email },
        updatedBy: currentUserId || null,
      });

      res.json({ success: true, message: "User deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const e = err as { message?: string; code?: string; detail?: string; hint?: string; where?: string };
    console.error("Delete user error:", err);
    console.error("Delete user error details:", {
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      hint: e?.hint,
      where: e?.where,
    });
    res.status(500).json({
      message: "Internal server error",
      error: e?.message,
      code: e?.code,
      detail: e?.detail,
    });
  }
});

export default router;
