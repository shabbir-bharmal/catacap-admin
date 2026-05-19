import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, handleMissingTableError } from "../utils/softDelete.js";
import { restoreOwningUsersForRecordsInTx } from "../utils/userRestore.js";
import {
  uploadNoteAttachments,
  rollbackUploadedAttachments,
  insertNoteAttachmentRows,
  buildAttachmentPublicUrl,
  type UploadedAttachment,
} from "../utils/noteAttachments.js";
import { autoEnrollInvestorIfApplicable } from "../utils/autoEnrollGroupMembership.js";
import { backfillCampaignUpdateNotifications } from "../utils/backfillCampaignUpdateNotifications.js";
import { sendCampaignOwnerFundingNotification } from "../utils/investmentNotifications.js";
import { applyMatchGrants } from "../utils/matchingGrants.js";
import { applyCoverFees } from "../utils/coverFees.js";
import ExcelJS from "exceljs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const page = params.currentPage;
    const pageSize = params.perPage;

    const statusList = params.status
      ? params.status.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    softDeleteFilter("abpr", params.isDeleted, conditions);
    conditions.push("(u.is_deleted IS NULL OR u.is_deleted = false)");

    if (statusList && statusList.length > 0) {
      if (statusList.includes("pending")) {
        const otherStatuses = statusList.filter((s) => s !== "pending");
        if (otherStatuses.length > 0) {
          conditions.push(`(abpr.status IS NULL OR abpr.status = '' OR LOWER(abpr.status) = ANY($${paramIdx}))`);
          values.push(statusList);
          paramIdx++;
        } else {
          conditions.push(`(abpr.status IS NULL OR abpr.status = '' OR LOWER(abpr.status) = 'pending')`);
        }
      } else {
        conditions.push(`abpr.status IS NOT NULL AND abpr.status != '' AND LOWER(abpr.status) = ANY($${paramIdx})`);
        values.push(statusList);
        paramIdx++;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let orderBy: string;
    switch (params.sortField?.toLowerCase()) {
      case "name":
        orderBy = `CONCAT(u.first_name, ' ', u.last_name) ${isAsc ? "ASC" : "DESC"}`;
        break;
      case "status":
        orderBy = `abpr.status ${isAsc ? "ASC" : "DESC"}`;
        break;
      case "assettype":
        orderBy = `COALESCE(NULLIF(abpr.asset_description, ''), at.type) ${isAsc ? "ASC" : "DESC"}`;
        break;
      case "createdat":
        orderBy = `abpr.created_at ${isAsc ? "ASC" : "DESC"}`;
        break;
      default:
        orderBy = `abpr.id DESC`;
        break;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)
       FROM asset_based_payment_requests abpr
       JOIN users u ON abpr.user_id = u.id
       LEFT JOIN campaigns c ON abpr.campaign_id = c.id
       LEFT JOIN asset_types at ON abpr.asset_type_id = at.id
       ${whereClause}`,
      values
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT abpr.id,
              CONCAT(u.first_name, ' ', u.last_name) AS name,
              u.email,
              CASE WHEN c.name IS NOT NULL AND TRIM(c.name) != '' THEN c.name ELSE NULL END AS "investmentName",
              COALESCE(NULLIF(TRIM(abpr.asset_description), ''), at.type) AS "assetType",
              CAST(abpr.approximate_amount AS float) AS "approximateAmount",
              CAST(abpr.received_amount AS float) AS "receivedAmount",
              abpr.contact_method AS "contactMethod",
              abpr.contact_value AS "contactValue",
              COALESCE(NULLIF(TRIM(abpr.status), ''), 'Pending') AS status,
              abpr.created_at AS "createdAt",
              EXISTS(SELECT 1 FROM asset_based_payment_request_notes n WHERE n.request_id = abpr.id) AS "hasNotes",
              abpr.deleted_at AS "deletedAt",
              CASE WHEN del.id IS NOT NULL THEN CONCAT(del.first_name, ' ', del.last_name) ELSE NULL END AS "deletedBy"
       FROM asset_based_payment_requests abpr
       JOIN users u ON abpr.user_id = u.id
       LEFT JOIN campaigns c ON abpr.campaign_id = c.id
       LEFT JOIN asset_types at ON abpr.asset_type_id = at.id
       LEFT JOIN users del ON abpr.deleted_by = del.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, pageSize, (page - 1) * pageSize]
    );

    if (totalCount > 0) {
      res.json({ items: dataResult.rows, totalCount });
    } else {
      res.json({ success: false, message: "Data not found." });
    }
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("Error fetching other assets:", err);
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

    const assetsResult = await pool.query(
      `SELECT id, user_id FROM asset_based_payment_requests WHERE id = ANY($1) AND is_deleted = true`,
      [ids]
    );

    if (assetsResult.rows.length === 0) {
      res.json({ success: false, message: "No deleted assets found to restore." });
      return;
    }

    const assetIds = assetsResult.rows.map((r: any) => r.id);
    const ownerIds = assetsResult.rows.map((r: any) => r.user_id);
    let restoredUserCount = 0;

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE asset_based_payment_requests SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1)`,
        [assetIds]
      );

      await client.query(
        `UPDATE account_balance_change_logs SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE asset_based_payment_request_id = ANY($1) AND is_deleted = true`,
        [assetIds]
      );

      const restoredUsers = await restoreOwningUsersForRecordsInTx(client, ownerIds, req.user?.id || null);
      restoredUserCount = restoredUsers.length;

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    }

    res.json({
      success: true,
      message: `${assetIds.length} other asset(s) restored successfully.`,
      restoredCount: assetIds.length,
      restoredUserCount,
    });
  } catch (err: any) {
    console.error("Error restoring other assets:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.put("/:id/status", async (req: Request, res: Response) => {
  const client = await pool.connect();
  let uploadedAttachments: UploadedAttachment[] = [];
  try {
    const incomingAttachments = Array.isArray((req.body as any)?.attachments)
      ? ((req.body as any).attachments as Array<{
          fileName?: string;
          mimeType?: string;
          base64Data?: string;
        }>)
      : [];
    if (incomingAttachments.length > 0) {
      uploadedAttachments = await uploadNoteAttachments(
        incomingAttachments,
        "notes/other-assets",
      );
    }
  } catch (err: any) {
    client.release();
    console.error("Error uploading other asset note attachments:", err);
    res.status(400).json({ success: false, message: err.message || "Failed to upload attachments." });
    return;
  }

  try {
    const id = parseInt(String(req.params.id), 10);
    const data = req.body;

    const assetResult = await client.query(
      `SELECT abpr.*, u.id AS uid, u.email AS user_email, u.first_name, u.last_name,
              u.account_balance, u.user_name, u.is_free_user, u.is_active,
              c.id AS camp_id, c.name AS campaign_name,
              at.type AS asset_type_name
       FROM asset_based_payment_requests abpr
       JOIN users u ON abpr.user_id = u.id
       LEFT JOIN campaigns c ON abpr.campaign_id = c.id
       LEFT JOIN asset_types at ON abpr.asset_type_id = at.id
       WHERE abpr.id = $1`,
      [id]
    );

    if (assetResult.rows.length === 0) {
      res.status(400).json({ success: false, message: "Asset payment request not found." });
      return;
    }

    const asset = assetResult.rows[0];
    const loginUserId = req.user?.id;

    if (!loginUserId) {
      res.status(401).json({ success: false, message: "Unauthorized access." });
      return;
    }

    const loginUserResult = await client.query(
      `SELECT user_name FROM users WHERE id = $1`,
      [loginUserId]
    );

    if (loginUserResult.rows.length === 0) {
      res.status(401).json({ success: false, message: "Logged-in user not found." });
      return;
    }

    const loginUserName = loginUserResult.rows[0].user_name?.trim().toLowerCase() || "";

    const oldStatus = asset.status || "Pending";
    const newStatus = data.status || "Pending";

    let notifyAfterCommit:
      | { campaignId: number; donorDisplayName: string; amount: number }
      | null = null;
    let fundingAfterCommit:
      | { campaignId: number; recommendationAmount: number; donorUserId: string | number | null }
      | null = null;
    let matchAfterCommit: {
      campaignId: number; userId: string; recId: number;
      amount: number; email: string; campaignName: string;
    } | null = null;

    await client.query("BEGIN");

    let insertedNoteId: number | null = null;
    if (data.note && data.note.trim()) {
      const noteResult = await client.query(
        `INSERT INTO asset_based_payment_request_notes (request_id, note, old_status, new_status, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
        [id, data.note.trim(), oldStatus, newStatus, loginUserId]
      );
      insertedNoteId = noteResult.rows[0]?.id ?? null;
    } else if (uploadedAttachments.length > 0) {
      throw new Error("A note is required when adding attachments.");
    }

    if (insertedNoteId && uploadedAttachments.length > 0) {
      await insertNoteAttachmentRows(
        client,
        "asset_based_payment_request_note_attachments",
        insertedNoteId,
        uploadedAttachments,
        loginUserId,
      );
    }

    if (oldStatus === "Pending" && newStatus === "In Transit") {
      await client.query(`UPDATE asset_based_payment_requests SET status = $1 WHERE id = $2`, [newStatus, id]);
      if (asset.camp_id) {
        await autoEnrollInvestorIfApplicable(client, asset.uid, asset.camp_id);
      }
    } else if (oldStatus === "In Transit" && newStatus === "Received") {
      const receivedAmount = data.amount > 0 ? data.amount : parseFloat(asset.received_amount) || 0;

      await client.query(
        `UPDATE asset_based_payment_requests SET received_amount = $1, status = $2 WHERE id = $3`,
        [receivedAmount, newStatus, id]
      );

      const grossAmount = parseFloat(asset.approximate_amount) || 0;
      const netAmount = receivedAmount;
      const fees = grossAmount - netAmount;

      const paymentType = asset.asset_description && asset.asset_description.trim()
        ? `${asset.asset_description}, ${loginUserName}`
        : `${asset.asset_type_name}, ${loginUserName}`;

      const userBalance = parseFloat(asset.account_balance) || 0;
      const newBalance = userBalance + receivedAmount;

      await client.query(
        `INSERT INTO account_balance_change_logs
         (user_id, payment_type, old_value, user_name, new_value, change_date, asset_based_payment_request_id, fees, gross_amount, net_amount)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)`,
        [asset.uid, paymentType, userBalance, asset.user_name, newBalance, id, fees, grossAmount, netAmount]
      );

      await client.query(`UPDATE users SET account_balance = $1, is_free_user = false, is_active = true WHERE id = $2`, [newBalance, asset.uid]);

      if (asset.campaign_id) {
        const updatedBalanceResult = await client.query(`SELECT account_balance FROM users WHERE id = $1`, [asset.uid]);
        let currentBalance = parseFloat(updatedBalanceResult.rows[0].account_balance) || 0;

        let recAmount = currentBalance;
        if (currentBalance < recAmount) {
          recAmount = currentBalance;
        }

        const newRecResult = await client.query(
          `INSERT INTO recommendations (user_email, user_full_name, campaign_id, status, amount, date_created, user_id)
           VALUES ($1, $2, $3, 'pending', $4, NOW(), $5) RETURNING id`,
          [
            asset.user_email,
            `${asset.first_name || ""} ${asset.last_name || ""}`.trim(),
            asset.camp_id,
            recAmount,
            asset.uid,
          ]
        );
        const newRecId = newRecResult.rows[0]?.id ?? null;
        if (newRecId) {
          matchAfterCommit = {
            campaignId: Number(asset.camp_id),
            userId: asset.uid,
            recId: newRecId,
            amount: recAmount,
            email: asset.user_email,
            campaignName: asset.campaign_name || "",
          };
        }

        await autoEnrollInvestorIfApplicable(client, asset.uid, asset.camp_id);

        if (recAmount > 0) {
          await client.query(
            `INSERT INTO account_balance_change_logs
             (user_id, payment_type, old_value, user_name, new_value, change_date, investment_name, campaign_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
            [
              asset.uid,
              "Manually",
              currentBalance,
              asset.user_name,
              currentBalance - recAmount,
              asset.campaign_name,
              asset.camp_id,
            ]
          );

          await client.query(
            `UPDATE users SET account_balance = account_balance - $1 WHERE id = $2`,
            [recAmount, asset.uid]
          );
        }

        await client.query(
          `INSERT INTO user_investments (user_id, payment_type, campaign_name, campaign_id, log_triggered)
           VALUES ($1, $2, $3, $4, true)`,
          [asset.uid, paymentType, asset.campaign_name, asset.camp_id]
        );

        // The investor just joined this campaign — give them in-app
        // notifications for any past, still-active updates that fired
        // before they showed up in user_investments.
        await backfillCampaignUpdateNotifications(client, asset.uid, asset.camp_id);

        // Defer the email until after COMMIT so we never notify
        // recipients of an investment that ends up rolled back.
        const donorDisplayNameApproved =
          `${asset.first_name || ""} ${asset.last_name || ""}`.trim() ||
          asset.user_name ||
          asset.user_email ||
          "An investor";
        notifyAfterCommit = {
          campaignId: Number(asset.camp_id),
          donorDisplayName: donorDisplayNameApproved,
          amount: recAmount,
        };
        fundingAfterCommit = {
          campaignId: Number(asset.camp_id),
          recommendationAmount: recAmount,
          donorUserId: asset.uid,
        };
      }
    } else if ((oldStatus === "Pending" || oldStatus === "In Transit") && newStatus === "Rejected") {
      await client.query(`UPDATE asset_based_payment_requests SET status = $1 WHERE id = $2`, [newStatus, id]);
    }

    await client.query("COMMIT");

    // CampaignInvestmentNotification (template 30, "👀 ... Just Invested in ...")
    // is intentionally disabled per product request — only the
    // CampaignOwnerFundingNotification ("You Got Funded!") email should fire on
    // Pending → In Transit transitions.
    void notifyAfterCommit;
    if (fundingAfterCommit) {
      sendCampaignOwnerFundingNotification(fundingAfterCommit).catch((err) =>
        console.error("Campaign owner funding email failed:", err?.message || err),
      );
    }
    if (matchAfterCommit) {
      applyMatchGrants({
        campaignId: matchAfterCommit.campaignId,
        investorUserId: matchAfterCommit.userId,
        triggeringRecommendationId: matchAfterCommit.recId,
        investmentAmount: matchAfterCommit.amount,
        investorEmail: matchAfterCommit.email,
        campaignName: matchAfterCommit.campaignName,
      }).catch((err) => console.error("applyMatchGrants (otherAssets) error:", err?.message || err));
      applyCoverFees({
        campaignId: matchAfterCommit.campaignId,
        investorUserId: matchAfterCommit.userId,
        triggeringRecommendationId: matchAfterCommit.recId,
        investmentAmount: matchAfterCommit.amount,
        investorEmail: matchAfterCommit.email,
        campaignName: matchAfterCommit.campaignName,
        kind: "initial",
      }).catch((err) => console.error("applyCoverFees (otherAssets) error:", err?.message || err));
    }

    res.json({ success: true, message: "Asset payment status updated successfully." });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    await rollbackUploadedAttachments(uploadedAttachments);
    console.error("Error updating other asset status:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get("/:id/notes", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);

    if (id <= 0) {
      res.json({ success: false, message: "Invalid asset payment id" });
      return;
    }

    const result = await pool.query(
      `SELECT n.id, n.old_status AS "oldStatus", n.new_status AS "newStatus",
              n.note, u.user_name AS "userName", n.created_at AS "createdAt"
       FROM asset_based_payment_request_notes n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.request_id = $1
       ORDER BY n.id DESC`,
      [id]
    );

    const noteIds = result.rows.map((r: any) => r.id);
    let attachmentsByNoteId: Record<number, any[]> = {};
    if (noteIds.length > 0) {
      try {
        const attResult = await pool.query(
          `SELECT id, note_id, file_name AS "fileName", storage_path AS "storagePath",
                  mime_type AS "mimeType", size_bytes AS "sizeBytes"
           FROM asset_based_payment_request_note_attachments
           WHERE note_id = ANY($1)
           ORDER BY id ASC`,
          [noteIds]
        );
        for (const att of attResult.rows) {
          const url = buildAttachmentPublicUrl(att.storagePath);
          if (!attachmentsByNoteId[att.note_id]) attachmentsByNoteId[att.note_id] = [];
          attachmentsByNoteId[att.note_id].push({
            id: att.id,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes ? Number(att.sizeBytes) : 0,
            url,
          });
        }
      } catch (err: any) {
        if (err?.code !== "42P01") {
          console.error("Error fetching other asset note attachments:", err);
        }
      }
    }

    const rowsWithAttachments = result.rows.map((row: any) => ({
      ...row,
      attachments: attachmentsByNoteId[row.id] || [],
    }));

    res.json(rowsWithAttachments);
  } catch (err: any) {
    console.error("Error fetching other asset notes:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT abpr.id, abpr.approximate_amount, abpr.received_amount, abpr.contact_method,
              abpr.contact_value, abpr.status, abpr.created_at, abpr.asset_description,
              u.first_name, u.last_name, u.email,
              c.name AS campaign_name,
              at.type AS asset_type_name
       FROM asset_based_payment_requests abpr
       JOIN users u ON abpr.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       LEFT JOIN campaigns c ON abpr.campaign_id = c.id AND (c.is_deleted IS NULL OR c.is_deleted = false)
       LEFT JOIN asset_types at ON abpr.asset_type_id = at.id
       WHERE (abpr.is_deleted IS NULL OR abpr.is_deleted = false)`
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("AssetPaymentRequests");

    const headers = [
      "Name", "Email", "Investment Name", "Asset Type", "Approximate Amount",
      "Received Amount", "Contact Method", "Contact Value", "Status", "Date Created",
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
    });

    for (const row of result.rows) {
      const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
      const assetType = row.asset_description && row.asset_description.trim()
        ? row.asset_description
        : row.asset_type_name;
      const approxAmount = parseFloat(row.approximate_amount) || 0;
      const receivedAmount = parseFloat(row.received_amount) || 0;
      const dateStr = row.created_at
        ? dayjs.utc(row.created_at).format("MM-DD-YYYY HH:mm")
        : "";

      const dataRow = worksheet.addRow([
        fullName,
        row.email,
        row.campaign_name,
        assetType,
        approxAmount,
        receivedAmount,
        row.contact_method,
        row.contact_value,
        row.status,
        dateStr,
      ]);

      dataRow.getCell(5).numFmt = "$#,##0.00";
      dataRow.getCell(6).numFmt = "$#,##0.00";
      dataRow.getCell(5).alignment = { horizontal: "right" };
      dataRow.getCell(6).alignment = { horizontal: "right" };
    }

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = maxLen + 4;
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=AssetPaymentRequests.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting other assets:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const loginUserId = req.user?.id || null;

    const entityResult = await pool.query(
      `SELECT id FROM asset_based_payment_requests WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (entityResult.rows.length === 0) {
      res.json({ success: false, message: "Other asset not found." });
      return;
    }

    await pool.query(
      `UPDATE account_balance_change_logs SET is_deleted = true, deleted_at = NOW(), deleted_by = $1
       WHERE asset_based_payment_request_id = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
      [loginUserId, id]
    );
    await pool.query(
      `UPDATE asset_based_payment_requests SET is_deleted = true, deleted_at = NOW(), deleted_by = $1
       WHERE id = $2`,
      [loginUserId, id]
    );

    res.json({ success: true, message: "Other asset deleted successfully." });
  } catch (err: any) {
    console.error("Error deleting other asset:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
