import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, buildSortClause } from "../utils/softDelete.js";
import { restoreOwningUsersForRecordsInTx } from "../utils/userRestore.js";
import { autoEnrollInvestorIfApplicable } from "../utils/autoEnrollGroupMembership.js";
import { backfillCampaignUpdateNotifications } from "../utils/backfillCampaignUpdateNotifications.js";
import { applyMatchGrants } from "../utils/matchingGrants.js";
import { applyCoverFees } from "../utils/coverFees.js";
import ExcelJS from "exceljs";

const router = Router();
const USER_ROLE = "User";

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const page = params.currentPage;
    const pageSize = params.perPage;

    const investmentIdRaw = req.query.InvestmentId || req.query.investmentId;
    const investmentIds = investmentIdRaw
      ? String(investmentIdRaw).split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
      : null;

    const statusList = params.status
      ? params.status.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    softDeleteFilter("r", params.isDeleted, conditions);

    const archivedView = params.isDeleted === true;

    if (!archivedView) {
      values.push(USER_ROLE);
      paramIdx++;
    }

    if (investmentIds && investmentIds.length > 0) {
      conditions.push(`r.campaign_id = ANY($${paramIdx}::int[])`);
      values.push(investmentIds);
      paramIdx++;
    }

    if (statusList && statusList.length > 0) {
      conditions.push(`r.status IS NOT NULL AND LOWER(r.status) = ANY($${paramIdx})`);
      values.push(statusList);
      paramIdx++;
    }

    const searchValue = (params.searchValue || "").trim();
    if (searchValue.length > 0) {
      conditions.push(
        `(r.user_full_name ILIKE $${paramIdx} OR r.user_email ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`
      );
      values.push(`%${searchValue}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const columnMap: Record<string, string> = {
      id: "r.id",
      userfullname: "r.user_full_name",
      status: "r.status",
      campaignname: "c.name",
      amount: "r.amount",
      datecreated: "r.date_created",
    };
    const sortClause = buildSortClause(params.sortField, isAsc, columnMap, "r.date_created");
    const orderBy = `${sortClause}, r.id ASC`;

    // For the archived view, we must surface every soft-deleted recommendation so
    // the count matches the recycle-bin summary even when the recommending user
    // was hard-deleted, has no "User" role, or had their email changed.
    const userRoleJoin = archivedView
      ? ``
      : `
       INNER JOIN users u_role ON LOWER(r.user_email) = LOWER(u_role.email)
         AND (u_role.is_deleted IS NULL OR u_role.is_deleted = false)
       INNER JOIN user_roles ur_role ON u_role.id = ur_role.user_id
       INNER JOIN roles rl_role ON ur_role.role_id = rl_role.id AND rl_role.name = $1`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM recommendations r
       ${userRoleJoin}
       LEFT JOIN campaigns c ON r.campaign_id = c.id
       ${whereClause}`,
      values
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT r.id, r.user_email AS "userEmail", r.user_full_name AS "userFullName",
              r.status, CAST(r.amount AS float) AS amount, r.rejection_memo AS "rejectionMemo",
              r.date_created AS "dateCreated", r.deleted_at AS "deletedAt",
              c.id AS "campaignId", c.name AS "campaignName",
              rej.first_name AS "rejectedBy",
              CASE WHEN del.id IS NOT NULL THEN CONCAT(del.first_name, ' ', del.last_name) ELSE NULL END AS "deletedBy",
              (
                EXISTS (
                  SELECT 1 FROM campaign_match_grant_activity a
                   WHERE a.donor_recommendation_id = r.id
                )
                OR EXISTS (
                  SELECT 1 FROM campaign_match_grants g
                   WHERE g.donor_user_id = r.user_id
                )
              ) AS "isMatch"
       FROM recommendations r
       ${userRoleJoin}
       LEFT JOIN campaigns c ON r.campaign_id = c.id
       LEFT JOIN users rej ON r.rejected_by = rej.id
       LEFT JOIN users del ON r.deleted_by = del.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, pageSize, (page - 1) * pageSize]
    );

    const statsResult = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN LOWER(TRIM(r.status)) = 'pending' THEN r.amount ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN LOWER(TRIM(r.status)) = 'approved' THEN r.amount ELSE 0 END), 0) AS approved
       FROM recommendations r
       ${userRoleJoin}
       LEFT JOIN campaigns c ON r.campaign_id = c.id
       ${whereClause}`,
      values
    );

    const pending = parseFloat(statsResult.rows[0].pending) || 0;
    const approved = parseFloat(statsResult.rows[0].approved) || 0;

    if (dataResult.rows.length > 0) {
      res.json({
        items: dataResult.rows,
        totalCount,
        pending,
        approved,
        total: pending + approved,
      });
    } else {
      res.json({ success: false, message: "Data not found." });
    }
  } catch (err: any) {
    console.error("Error fetching recommendations:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/by-user/:userId", async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId);

    const userResult = await pool.query(
      `SELECT id, email FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const userEmail = userResult.rows[0].email;

    const dataResult = await pool.query(
      `SELECT r.id,
              CAST(r.amount AS float) AS amount,
              r.status,
              r.date_created AS "dateCreated",
              c.id AS "campaignId",
              c.name AS "campaignName"
       FROM recommendations r
       LEFT JOIN campaigns c ON r.campaign_id = c.id
       WHERE LOWER(r.user_email) = LOWER($1)
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
       ORDER BY r.date_created DESC, r.id DESC`,
      [userEmail]
    );

    res.json({ success: true, items: dataResult.rows });
  } catch (err: any) {
    console.error("Error fetching user recommendations:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const ids: number[] = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    let restoredCount = 0;
    let restoredUserCount = 0;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE recommendations SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1) AND is_deleted = true
         RETURNING id, user_id, user_email`,
        [ids]
      );
      restoredCount = result.rowCount ?? 0;

      if (restoredCount === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "No deleted recommendations found." });
        return;
      }

      const ownerIds = result.rows.map((r: { user_id: string | null }) => r.user_id);
      const lookupEmails = result.rows
        .filter((r: { user_id: string | null; user_email: string | null }) => !r.user_id && r.user_email)
        .map((r: { user_email: string }) => r.user_email.trim().toLowerCase())
        .filter((e: string) => e.length > 0);
      if (lookupEmails.length > 0) {
        const lookup = await client.query(
          `SELECT id FROM users WHERE LOWER(TRIM(email)) = ANY($1)`,
          [Array.from(new Set(lookupEmails))]
        );
        for (const row of lookup.rows) ownerIds.push(row.id);
      }
      const restoredUsers = await restoreOwningUsersForRecordsInTx(client, ownerIds, req.user?.id || null);
      restoredUserCount = restoredUsers.length;

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    }

    res.json({
      success: true,
      message: `${restoredCount} recommendation(s) restored successfully.`,
      restoredCount,
      restoredUserCount,
    });
  } catch (err: any) {
    console.error("Error restoring recommendations:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = parseInt(String(req.params.id), 10);
    const data = req.body;

    if (!data) {
      res.status(400).json({ success: false, message: "Data type is invalid" });
      return;
    }

    const recResult = await client.query(
      `SELECT r.*, c.name AS campaign_name, c.id AS camp_id
       FROM recommendations r
       LEFT JOIN campaigns c ON r.campaign_id = c.id
       WHERE r.id = $1`,
      [id]
    );

    if (recResult.rows.length === 0) {
      res.json({ success: false, message: "Recommendation data not found" });
      return;
    }

    const recommendation = recResult.rows[0];

    const userResult = await client.query(
      `SELECT id, email, account_balance, user_name, first_name FROM users WHERE email = $1`,
      [recommendation.user_email]
    );

    if (userResult.rows.length === 0) {
      res.json({ success: false, message: "Recommendation cannot be rejected because the user does not exist" });
      return;
    }

    const user = userResult.rows[0];
    const loginUserId = req.user?.id;

    await client.query("BEGIN");

    await client.query(
      `UPDATE recommendations SET amount = $1, status = $2, user_email = $3 WHERE id = $4`,
      [data.amount, data.status, data.userEmail, id]
    );

    if (data.status === "rejected") {
      const oldBalance = parseFloat(user.account_balance) || 0;
      const amount = parseFloat(recommendation.amount) || 0;
      const newBalance = oldBalance + amount;

      await client.query(
        `INSERT INTO account_balance_change_logs (user_id, payment_type, investment_name, campaign_id, old_value, user_name, new_value, change_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          user.id,
          `Recommendation reverted, Id = ${id}`,
          recommendation.campaign_name,
          recommendation.campaign_id,
          oldBalance,
          user.user_name,
          newBalance,
        ]
      );

      await client.query(
        `UPDATE users SET account_balance = $1 WHERE id = $2`,
        [newBalance, user.id]
      );

      const rejectionMemo = data.rejectionMemo && data.rejectionMemo.trim() !== "" ? data.rejectionMemo.trim() : null;
      await client.query(
        `UPDATE recommendations SET rejection_memo = $1, rejected_by = $2, rejection_date = NOW() WHERE id = $3`,
        [rejectionMemo, loginUserId, id]
      );

      // Cascade-reject any pending match recommendations triggered by this one
      const pendingMatches = await client.query(
        `SELECT a.id AS activity_id, a.donor_recommendation_id, a.match_grant_id, a.amount,
                cmg.reserved_amount, cmg.donor_user_id,
                u.account_balance AS donor_balance, u.user_name AS donor_user_name
           FROM campaign_match_grant_activity a
           JOIN campaign_match_grants cmg ON cmg.id = a.match_grant_id
           JOIN users u ON u.id = cmg.donor_user_id
          WHERE a.triggered_by_recommendation_id = $1
            AND a.donor_recommendation_id IS NOT NULL`,
        [id]
      );
      for (const m of pendingMatches.rows) {
        // Reject the donor's pending match recommendation
        await client.query(
          `UPDATE recommendations SET status = 'rejected', rejection_date = NOW() WHERE id = $1`,
          [m.donor_recommendation_id]
        );
        // Unwind amount_used on the grant
        const matchAmt = parseFloat(m.amount) || 0;
        await client.query(
          `UPDATE campaign_match_grants SET amount_used = GREATEST(0, amount_used - $1), updated_at = NOW() WHERE id = $2`,
          [matchAmt, m.match_grant_id]
        );
        // For live-wallet grants (no escrow), restore funds to donor
        const isLiveWallet = parseFloat(m.reserved_amount) <= 0;
        if (isLiveWallet && matchAmt > 0) {
          const donorBal = parseFloat(m.donor_balance) || 0;
          const restored = parseFloat((donorBal + matchAmt).toFixed(2));
          await client.query(`UPDATE users SET account_balance = $1 WHERE id = $2`, [restored, m.donor_user_id]);
          await client.query(
            `INSERT INTO account_balance_change_logs
               (user_id, payment_type, investment_name, campaign_id, old_value, user_name, new_value, change_date, comment)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
            [
              m.donor_user_id,
              "Match grant – match cancelled",
              recommendation.campaign_name,
              recommendation.campaign_id,
              donorBal,
              m.donor_user_name,
              restored,
              `Pending match of $${matchAmt.toFixed(2)} cancelled because investor's recommendation was rejected`,
            ]
          );
        }
      }
    } else if (data.status === "approved" && recommendation.status !== "approved") {
      await autoEnrollInvestorIfApplicable(client, user.id, recommendation.camp_id);
      // Investor just transitioned into an active state on this campaign;
      // backfill any past, still-active in-app update notifications they
      // missed before approval.
      await backfillCampaignUpdateNotifications(client, user.id, recommendation.camp_id);

      // Cascade-approve any pending match recommendations triggered by this one
      const pendingMatches = await client.query(
        `SELECT a.donor_recommendation_id, a.match_grant_id, a.amount,
                cmg.reserved_amount, cmg.donor_user_id,
                u.account_balance AS donor_balance, u.user_name AS donor_user_name
           FROM campaign_match_grant_activity a
           JOIN campaign_match_grants cmg ON cmg.id = a.match_grant_id
           JOIN users u ON u.id = cmg.donor_user_id
          WHERE a.triggered_by_recommendation_id = $1
            AND a.donor_recommendation_id IS NOT NULL`,
        [id]
      );
      for (const m of pendingMatches.rows) {
        await client.query(
          `UPDATE recommendations SET status = 'approved' WHERE id = $1`,
          [m.donor_recommendation_id]
        );
        const matchAmt = parseFloat(m.amount) || 0;
        const isEscrow = parseFloat(m.reserved_amount) > 0;
        if (isEscrow) {
          // Log the escrow match being confirmed
          await client.query(
            `INSERT INTO account_balance_change_logs
               (user_id, payment_type, investment_name, campaign_id, old_value, user_name, new_value, change_date, comment)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
            [
              m.donor_user_id,
              "Match grant – escrow applied",
              recommendation.campaign_name,
              recommendation.campaign_id,
              parseFloat(m.donor_balance) || 0,
              m.donor_user_name,
              parseFloat(m.donor_balance) || 0,
              `$${matchAmt.toFixed(2)} escrow match confirmed for ${recommendation.campaign_name}`,
            ]
          );
        }
      }
    }

    const wasNewlyApproved =
      data.status === "approved" && recommendation.status !== "approved";
    const wasNewlyPending =
      data.status === "pending" && recommendation.status !== "pending";

    await client.query("COMMIT");

    // Fire matching when investment first becomes pending OR approved (if not already matched)
    if ((wasNewlyPending || wasNewlyApproved) && recommendation.camp_id) {
      // Only fire if there's no existing pending/approved match for this recommendation
      applyMatchGrants({
        campaignId: recommendation.camp_id,
        investorUserId: user.id,
        triggeringRecommendationId: id,
        investmentAmount: parseFloat(data.amount || recommendation.amount) || 0,
        investorEmail: recommendation.user_email || "",
        campaignName: recommendation.campaign_name || "",
      }).catch((err) =>
        console.error(
          "applyMatchGrants fire-and-forget error:",
          err?.message || err,
        ),
      );
      applyCoverFees({
        campaignId: recommendation.camp_id,
        investorUserId: user.id,
        triggeringRecommendationId: id,
        investmentAmount: parseFloat(data.amount || recommendation.amount) || 0,
        investorEmail: recommendation.user_email || "",
        campaignName: recommendation.campaign_name || "",
      }).catch((err) =>
        console.error(
          "applyCoverFees fire-and-forget error:",
          err?.message || err,
        ),
      );
    }

    const rejectingUserResult = await pool.query(
      `SELECT first_name FROM users WHERE id = $1`,
      [loginUserId]
    );
    const rejectedByName = rejectingUserResult.rows[0]?.first_name?.trim().toLowerCase() || "";

    const updatedRec = await pool.query(
      `SELECT rejection_memo FROM recommendations WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: "Recommendation status updated successfully.",
      data: {
        status: data.status,
        rejectedBy: rejectedByName,
        rejectionMemo: updatedRec.rows[0]?.rejection_memo || null,
      },
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating recommendation:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get("/export", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.user_full_name, r.user_email, r.amount, r.date_created,
              r.status, r.rejection_memo, r.rejection_date,
              c.name AS campaign_name,
              rej.first_name AS rejected_by_name
       FROM recommendations r
       INNER JOIN users u_role ON LOWER(r.user_email) = LOWER(u_role.email)
         AND (u_role.is_deleted IS NULL OR u_role.is_deleted = false)
       INNER JOIN user_roles ur_role ON u_role.id = ur_role.user_id
       INNER JOIN roles rl_role ON ur_role.role_id = rl_role.id AND rl_role.name = $1
       LEFT JOIN campaigns c ON r.campaign_id = c.id AND (c.is_deleted IS NULL OR c.is_deleted = false)
       LEFT JOIN users rej ON r.rejected_by = rej.id AND (rej.is_deleted IS NULL OR rej.is_deleted = false)
       WHERE (r.is_deleted IS NULL OR r.is_deleted = false)
       ORDER BY r.id DESC`,
      [USER_ROLE]
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Recommendations");

    const headers = [
      "Id", "UserFullName", "UserEmail", "InvestmentName", "Amount",
      "DateCreated", "Status", "RejectionMemo", "RejectedBy", "RejectionDate",
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
    });

    for (const row of result.rows) {
      const dataRow = worksheet.addRow([
        row.id,
        row.user_full_name,
        row.user_email,
        row.campaign_name,
        row.amount != null ? Math.round(parseFloat(row.amount) * 100) / 100 : row.amount,
        row.date_created ? new Date(row.date_created) : row.date_created,
        row.status,
        row.rejection_memo,
        row.rejected_by_name,
        row.rejection_date,
      ]);
      const amountCell = dataRow.getCell(5);
      if (row.amount != null) {
        amountCell.numFmt = "$#,##0.00";
      }
      const dateCreatedCell = dataRow.getCell(6);
      if (row.date_created) {
        dateCreatedCell.numFmt = "MM/dd/yy HH:mm";
      }
      const rejectionDateCell = dataRow.getCell(10);
      if (row.rejection_date) {
        rejectionDateCell.value = new Date(row.rejection_date);
        rejectionDateCell.numFmt = "MM/dd/yyyy";
      }
    }

    worksheet.columns.forEach((col) => {
      col.alignment = { horizontal: "left" };
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = maxLen + 10;
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=Recommendations.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting recommendations:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loginUserId = req.user?.id || null;

    const result = await pool.query(
      `UPDATE recommendations SET is_deleted = true, deleted_at = NOW(), deleted_by = $1
       WHERE id = $2 AND (is_deleted IS NULL OR is_deleted = false)
       RETURNING id`,
      [loginUserId, id]
    );

    if (result.rowCount === 0) {
      res.json({ success: false, message: "Recommendation not found." });
      return;
    }

    res.json({ success: true, message: "Recommendation deleted successfully." });
  } catch (err: any) {
    console.error("Error deleting recommendation:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
