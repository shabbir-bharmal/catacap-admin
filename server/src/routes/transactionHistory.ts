import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, buildSortClause } from "../utils/softDelete.js";
import { restoreOwningUsersForRecordsInTx } from "../utils/userRestore.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import ExcelJS from "exceljs";
dayjs.extend(utc);

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    softDeleteFilter("a", params.isDeleted, conditions);

    if (params.searchValue) {
      const searchParam = `%${params.searchValue.toLowerCase()}%`;
      conditions.push(
        `(LOWER(a.user_name) LIKE $${paramIdx} OR LOWER(u.email) LIKE $${paramIdx} OR LOWER(a.payment_type) LIKE $${paramIdx} OR LOWER(a.investment_name) LIKE $${paramIdx})`
      );
      values.push(searchParam);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortColumns: Record<string, string> = {
      changedate: "a.change_date",
      investmentname: "a.investment_name",
    };
    const hasExplicitSort = params.sortField && sortColumns[params.sortField.toLowerCase()];
    const orderClause = hasExplicitSort
      ? buildSortClause(params.sortField, isAsc, sortColumns, "a.change_date")
      : "a.id DESC";

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM account_balance_change_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereClause}`,
      values
    );
    const totalCount = parseInt(countResult.rows[0].total) || 0;

    if (totalCount === 0) {
      res.json({ success: false, message: "Data not found." });
      return;
    }

    const dataResult = await pool.query(
      `SELECT
         a.id,
         a.user_name AS "userName",
         u.email,
         a.change_date AS "changeDate",
         a.old_value AS "oldValue",
         a.new_value AS "newValue",
         a.payment_type AS "paymentType",
         a.investment_name AS "investmentName",
         a.comment,
         a.fees,
         a.net_amount AS "netAmount",
         a.gross_amount AS "grossAmount",
         a.deleted_at AS "deletedAt",
         CASE WHEN a.deleted_by IS NOT NULL
           THEN (SELECT COALESCE(du.first_name || ' ' || du.last_name, '') FROM users du WHERE du.id = a.deleted_by)
           ELSE NULL
         END AS "deletedBy"
       FROM account_balance_change_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((row) => ({
      id: row.id,
      userName: row.userName,
      email: row.email,
      changeDate: row.changeDate
        ? dayjs.utc(row.changeDate).format("MM/DD/YYYY")
        : null,
      oldValue: row.oldValue !== null ? parseFloat(row.oldValue) : null,
      newValue: row.newValue !== null ? parseFloat(row.newValue) : null,
      paymentType: row.paymentType,
      investmentName: row.investmentName,
      comment: row.comment,
      grossAmount: row.grossAmount !== null ? parseFloat(row.grossAmount) : null,
      fees: row.fees !== null ? parseFloat(row.fees) : null,
      netAmount: row.netAmount !== null ? parseFloat(row.netAmount) : null,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
    }));

    res.json({ items, totalCount });
  } catch (err) {
    console.error("Transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.json({ success: false, message: "Invalid ID." });
      return;
    }

    const entity = await pool.query(
      `SELECT id FROM account_balance_change_logs WHERE id = $1`,
      [id]
    );

    if (entity.rows.length === 0) {
      res.json({ success: false, message: "Account history not found." });
      return;
    }

    const adminUser = (req as any).user;
    const deletedBy = adminUser?.id || null;

    await pool.query(
      `UPDATE account_balance_change_logs
       SET is_deleted = true, deleted_at = NOW(), deleted_by = $2
       WHERE id = $1`,
      [id, deletedBy]
    );

    res.json({ success: true, message: "Account history deleted successfully." });
  } catch (err) {
    console.error("Delete transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const ids: number[] = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    let restoredCount = 0;
    let restoredUserCount = 0;
    try {
      await client.query("BEGIN");

      const logs = await client.query(
        `SELECT id, user_id, is_deleted FROM account_balance_change_logs WHERE id = ANY($1)`,
        [ids]
      );
      if (logs.rows.length === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "Account history not found." });
        return;
      }
      const deletedRows = logs.rows.filter((r) => r.is_deleted === true);
      const deletedIds = deletedRows.map((r) => r.id);
      if (deletedIds.length === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "No deleted account history found." });
        return;
      }

      await client.query(
        `UPDATE account_balance_change_logs
         SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1)`,
        [deletedIds]
      );

      const ownerIds = deletedRows.map((r) => r.user_id);
      const restoredUsers = await restoreOwningUsersForRecordsInTx(client, ownerIds, req.user?.id || null);
      restoredUserCount = restoredUsers.length;

      await client.query("COMMIT");
      restoredCount = deletedIds.length;
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    }

    res.json({
      success: true,
      message: `${restoredCount} account history record(s) restored successfully.`,
      restoredCount,
      restoredUserCount,
    });
  } catch (err) {
    console.error("Restore transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         a.user_name,
         a.change_date,
         a.investment_name,
         a.payment_type,
         a.old_value,
         a.new_value,
         a.gross_amount,
         a.fees,
         a.net_amount,
         a.zip_code,
         a.comment
       FROM account_balance_change_logs a
       WHERE (a.is_deleted IS NULL OR a.is_deleted = false)
       ORDER BY a.id DESC`
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("AccountBalanceHistory");

    const headers = [
      "User Name",
      "Change Date",
      "Investment Name",
      "Payment Type",
      "Old Value",
      "New Value",
      "Gross Amount",
      "Fees",
      "Net Amount",
      "Zip Code",
      "Comment",
    ];
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
        parseFloat(row.gross_amount || 0),
        parseFloat(row.fees || 0),
        parseFloat(row.net_amount || 0),
        row.zip_code || "",
        row.comment || "",
      ]);

      dataRow.getCell(5).numFmt = "$#,##0.00";
      dataRow.getCell(6).numFmt = "$#,##0.00";
      dataRow.getCell(7).numFmt = "$#,##0.00";
      dataRow.getCell(8).numFmt = "$#,##0.00";
      dataRow.getCell(9).numFmt = "$#,##0.00";
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
    console.error("Export transaction history error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
