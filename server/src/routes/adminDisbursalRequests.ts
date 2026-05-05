import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, handleMissingTableError } from "../utils/softDelete.js";
import { restoreOwningUsersForRecordsInTx } from "../utils/userRestore.js";
import { resolveFileUrl } from "../utils/uploadBase64Image.js";
import ExcelJS from "exceljs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

const router = Router();

const DisbursalRequestStatusMap: Record<number, string> = {
  1: "Pending",
  2: "Completed",
  3: "Cancelled",
};

function getStatusName(status: number): string {
  return DisbursalRequestStatusMap[status] || "Unknown";
}

async function resolveInvestmentTypeNames(investmentTypes: string | null | undefined): Promise<string> {
  if (!investmentTypes) return "";
  const ids = investmentTypes
    .split(",")
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => !isNaN(n));
  if (ids.length === 0) return "";

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id, name FROM investment_instruments WHERE id IN (${placeholders})`,
    ids
  );
  const map: Record<number, string> = {};
  for (const row of result.rows) {
    map[row.id] = row.name;
  }
  return ids
    .map((id) => map[id])
    .filter(Boolean)
    .join(", ");
}

async function buildInvestmentTypeMap(rows: any[]): Promise<Record<number, string>> {
  const allIds = new Set<number>();
  for (const row of rows) {
    if (row.investment_instruments) {
      const ids = row.investment_instruments
        .split(",")
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n));
      for (const id of ids) allIds.add(id);
    }
  }
  if (allIds.size === 0) return {};

  const idArr = Array.from(allIds);
  const placeholders = idArr.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT id, name FROM investment_instruments WHERE id IN (${placeholders})`,
    idArr
  );
  const map: Record<number, string> = {};
  for (const row of result.rows) {
    map[row.id] = row.name;
  }
  return map;
}

function resolveInvestmentTypeString(investmentTypes: string | null | undefined, typeMap: Record<number, string>): string {
  if (!investmentTypes) return "";
  return investmentTypes
    .split(",")
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => !isNaN(n))
    .map((id) => typeMap[id])
    .filter(Boolean)
    .join(", ");
}

function formatDate(dateVal: any): string {
  if (!dateVal) return "";
  const d = dayjs.utc(dateVal);
  if (!d.isValid()) return "";
  return d.format("MM-DD-YYYY");
}

function parseMetricsPairs(raw: any): Array<{ key: string; value: string }> | null {
  if (raw === null || raw === undefined) return null;
  let parsed: any = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const out: Array<{ key: string; value: string }> = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;
    const key = (item as any).key ?? (item as any).Key ?? "";
    const value = (item as any).value ?? (item as any).Value ?? "";
    out.push({ key: String(key ?? ""), value: String(value ?? "") });
  }
  return out.length > 0 ? out : null;
}

function formatDateSlash(dateVal: any): string {
  if (!dateVal) return "";
  const d = dayjs.utc(dateVal);
  if (!d.isValid()) return "";
  return d.format("MM/DD/YYYY");
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = (params.sortDirection || "").toLowerCase() === "asc";
    const page = params.currentPage;
    const pageSize = params.perPage;
    const disbursalRequestStatus = req.query.Status || req.query.status || req.query.disbursalRequestStatus || req.query.DisbursalRequestStatus;

    const conditions: string[] = [];
    const values: any[] = [];

    if (params.isDeleted === true) {
      conditions.push(`d.is_deleted = true`);
    } else {
      conditions.push(`(d.is_deleted IS NULL OR d.is_deleted = false)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const queryText = `
      SELECT d.id, d.receive_date, u.email, d.mobile, d.distributed_amount,
             c.name, c.id AS investment_id, c.property, d.quote, d.status,
             d.pitch_deck, d.pitch_deck_name, d.investment_document, d.investment_document_name,
             d.tracks_metrics, d.metrics_report, d.metrics_report_name, d.metrics_pairs,
             c.investment_instruments, d.deleted_at,
             du.first_name AS deleted_by_first_name, du.last_name AS deleted_by_last_name
      FROM disbursal_requests d
      LEFT JOIN campaigns c ON d.campaign_id = c.id
      LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
      LEFT JOIN users du ON d.deleted_by = du.id
      ${whereClause}
    `;

    const allResult = await pool.query(queryText, values);
    let rows = allResult.rows;

    const totalCount = rows.length;

    if (params.searchValue) {
      const sv = params.searchValue.trim().toLowerCase();
      rows = rows.filter(
        (r: any) =>
          (r.name || "").trim().toLowerCase().includes(sv) ||
          (r.email || "").toLowerCase().includes(sv)
      );
    }

    if (disbursalRequestStatus) {
      const statusVal = parseInt(String(disbursalRequestStatus), 10);
      if (!isNaN(statusVal)) {
        rows = rows.filter((r: any) => r.status === statusVal);
      }
    }

    const sortCol = (params.sortField || "").toLowerCase();
    rows.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "email":
          cmp = (a.email || "").localeCompare(b.email || "");
          break;
        case "amount":
          cmp = (parseFloat(a.distributed_amount) || 0) - (parseFloat(b.distributed_amount) || 0);
          break;
        case "date":
          cmp = new Date(a.receive_date || 0).getTime() - new Date(b.receive_date || 0).getTime();
          break;
        default:
          cmp = (a.id || 0) - (b.id || 0);
          return isAsc ? cmp : -cmp;
      }
      return isAsc ? cmp : -cmp;
    });

    const typeMap = await buildInvestmentTypeMap(rows);

    const noteCheckIds = rows.map((r: any) => r.id);
    let notesSet = new Set<number>();
    if (noteCheckIds.length > 0) {
      const notePlaceholders = noteCheckIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const notesResult = await pool.query(
        `SELECT DISTINCT disbursal_request_id FROM disbursal_request_notes WHERE disbursal_request_id IN (${notePlaceholders})`,
        noteCheckIds
      );
      notesSet = new Set(notesResult.rows.map((r: any) => r.disbursal_request_id));
    }

    const mapped = rows.map((x: any) => ({
      id: x.id,
      name: x.name,
      investmentId: x.investment_id,
      property: x.property,
      email: x.email,
      mobile: x.mobile,
      quote: x.quote,
      status: x.status,
      statusName: getStatusName(x.status),
      receiveDate: formatDate(x.receive_date),
      distributedAmount: parseFloat(x.distributed_amount) || 0,
      investmentType: resolveInvestmentTypeString(x.investment_instruments, typeMap),
      pitchDeck: resolveFileUrl(x.pitch_deck, "disbursal-requests"),
      pitchDeckName: x.pitch_deck_name,
      investmentDocument: resolveFileUrl(x.investment_document, "disbursal-requests"),
      investmentDocumentName: x.investment_document_name,
      tracksMetrics: x.tracks_metrics,
      metricsReport: resolveFileUrl(x.metrics_report, "disbursal-requests"),
      metricsReportName: x.metrics_report_name,
      metricsPairs: parseMetricsPairs(x.metrics_pairs),
      hasNotes: notesSet.has(x.id),
      deletedAt: x.deleted_at,
      deletedBy: x.deleted_by_first_name
        ? `${x.deleted_by_first_name} ${x.deleted_by_last_name || ""}`.trim()
        : null,
    }));

    const items = mapped.slice((page - 1) * pageSize, page * pageSize);

    if (items.length > 0) {
      res.json({ items, totalCount });
    } else {
      res.json({ success: false, message: "Data not found." });
    }
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("Error fetching disbursal requests:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const queryText = `
      SELECT d.id, d.receive_date, u.email, d.distributed_amount,
             c.name, d.quote, d.status, c.investment_instruments
      FROM disbursal_requests d
      JOIN campaigns c ON d.campaign_id = c.id
      LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
      WHERE (d.is_deleted IS NULL OR d.is_deleted = false)
    `;
    const result = await pool.query(queryText);
    const data = result.rows;

    const typeMap = await buildInvestmentTypeMap(data);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("DisbursalRequest");

    const headers = ["Investment", "Email", "Disbursement Date", "Amount", "Investment Instruments", "Status", "Quote"];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
    });

    for (const row of data) {
      const dataRow = worksheet.addRow([
        row.name || "",
        row.email || "",
        row.receive_date ? row.receive_date : "",
        parseFloat(row.distributed_amount) || 0,
        resolveInvestmentTypeString(row.investment_instruments, typeMap),
        getStatusName(row.status),
        row.quote || "",
      ]);
      dataRow.getCell(4).numFmt = "$#,##0.00";
    }

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = maxLen + 10;
    });

    const amountColIndex = 4;
    worksheet.getColumn(amountColIndex).alignment = { horizontal: "right" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DisbursalRequest.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting disbursal requests:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id/notes", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      res.json({ success: false, message: "Invalid disbursal request id" });
      return;
    }

    const parentCheck = await pool.query(
      `SELECT id FROM disbursal_requests WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (parentCheck.rows.length === 0) {
      res.json({ success: false, message: "Invalid disbursal request id" });
      return;
    }

    const result = await pool.query(
      `SELECT n.id, n.note, u.user_name AS "userName", n.created_at AS "createdAt"
       FROM disbursal_request_notes n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.disbursal_request_id = $1
       ORDER BY n.id DESC`,
      [id]
    );

    if (result.rows.length > 0) {
      res.json(result.rows);
    } else {
      res.json({ success: false, message: "Notes not found" });
    }
  } catch (err: any) {
    console.error("Error fetching disbursal request notes:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      res.json({ success: false, message: "Id is required." });
      return;
    }

    const result = await pool.query(
      `SELECT d.id, u.first_name, u.last_name, u.email, d.role, d.mobile,
              d.status, d.quote, c.name, d.distributed_amount, c.property,
              d.investment_remain_open, d.receive_date, d.pitch_deck, d.pitch_deck_name,
              d.investment_document, d.investment_document_name,
              d.tracks_metrics, d.metrics_report, d.metrics_report_name, d.metrics_pairs,
              d.impact_assets_funding_previously, c.investment_instruments
       FROM disbursal_requests d
       JOIN campaigns c ON d.campaign_id = c.id
       LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       WHERE d.id = $1 AND (d.is_deleted IS NULL OR d.is_deleted = false)`,
      [id]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "Disbursal Request not found." });
      return;
    }

    const row = result.rows[0];
    const investmentTypeNames = await resolveInvestmentTypeNames(row.investment_instruments);

    res.json({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      role: row.role,
      mobile: row.mobile,
      name: row.name,
      quote: row.quote,
      status: row.status,
      statusName: getStatusName(row.status),
      distributedAmount: parseFloat(row.distributed_amount) || 0,
      property: row.property,
      investmentRemainOpen: row.investment_remain_open,
      receiveDate: formatDate(row.receive_date),
      pitchDeck: resolveFileUrl(row.pitch_deck, "disbursal-requests"),
      pitchDeckName: row.pitch_deck_name,
      investmentDocument: resolveFileUrl(row.investment_document, "disbursal-requests"),
      investmentDocumentName: row.investment_document_name,
      tracksMetrics: row.tracks_metrics,
      metricsReport: resolveFileUrl(row.metrics_report, "disbursal-requests"),
      metricsReportName: row.metrics_report_name,
      metricsPairs: parseMetricsPairs(row.metrics_pairs),
      impactAssetsFundingPreviously: row.impact_assets_funding_previously,
      investmentTypeNames,
    });
  } catch (err: any) {
    console.error("Error fetching disbursal request:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = parseInt(String(req.query.status || req.body?.status), 10);

    if (![1, 2, 3].includes(status)) {
      res.json({ success: false, message: "Invalid status value." });
      return;
    }

    const result = await pool.query(
      `UPDATE disbursal_requests SET status = $1 WHERE id = $2 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id`,
      [status, id]
    );

    if (result.rowCount === 0) {
      res.json({ success: false, message: "Disbursal request not found." });
      return;
    }

    res.json({ success: true, message: "Disbursal request status updated successfully." });
  } catch (err: any) {
    console.error("Error updating disbursal request status:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/notes", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const note = typeof req.body === "string" ? req.body : req.body?.note || req.body;
    const loginUserId = req.user?.id;

    if (!loginUserId) {
      res.status(400).json({ success: false, message: "User not found." });
      return;
    }

    const disbursalResult = await pool.query(
      `SELECT id FROM disbursal_requests WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (disbursalResult.rows.length === 0) {
      res.json({ success: false, message: "Disbursal Request not found." });
      return;
    }

    const noteText = typeof note === "string" ? note.trim() : String(note).trim();

    await pool.query(
      `INSERT INTO disbursal_request_notes (disbursal_request_id, note, created_by, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [id, noteText, loginUserId]
    );

    res.json({ success: true, message: "Note saved successfully." });
  } catch (err: any) {
    console.error("Error saving disbursal request note:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loginUserId = req.user?.id;

    const result = await pool.query(
      `SELECT id FROM disbursal_requests WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "Disbursal request not found." });
      return;
    }

    await pool.query(
      `UPDATE disbursal_requests SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
      [loginUserId, id]
    );

    res.json({ success: true, message: "Disbursal request deleted successfully." });
  } catch (err: any) {
    console.error("Error deleting disbursal request:", err);
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
        `UPDATE disbursal_requests SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1) AND is_deleted = true
         RETURNING id, user_id`,
        [ids]
      );
      restoredCount = result.rowCount ?? 0;

      if (restoredCount === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "No deleted records found to restore." });
        return;
      }

      const ownerIds = result.rows.map((r: any) => r.user_id);
      const restoredUsers = await restoreOwningUsersForRecordsInTx(client, ownerIds, req.user?.id || null);
      restoredUserCount = restoredUsers.length;

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    }

    res.json({
      success: true,
      message: `${restoredCount} disbursal request(s) restored successfully.`,
      restoredCount,
      restoredUserCount,
    });
  } catch (err: any) {
    console.error("Error restoring disbursal requests:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

export default router;
