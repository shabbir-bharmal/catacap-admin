import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { jwtUserAuthMiddleware } from "../middleware/jwtUserAuth.js";
import { parsePagination } from "../utils/softDelete.js";
import ExcelJS from "exceljs";
import crypto from "crypto";
import { sendTemplateEmail, sendTemplateEmailWithAttachments } from "../utils/emailService.js";
import { findOrCreateAnonymousUser } from "../utils/anonymousUser.js";
import QRCode from "qrcode";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uploadBase64Image, resolveFileUrl, extractStoragePath, MAX_PITCH_DECK_FILE_SIZE_BYTES } from "../utils/uploadBase64Image.js";

const router = Router();

const STAGE_CLOSED_NOT_INVESTED = 4;
const STAGE_CLOSED_INVESTED = 3;

const DisbursalRequestStatusMap: Record<number, string> = {
  1: "Pending",
  2: "Completed",
};

function getStatusName(status: number): string {
  return DisbursalRequestStatusMap[status] || "Unknown";
}

function formatDate(dateVal: any): string {
  if (!dateVal) return "";
  const d = dayjs.utc(dateVal);
  if (!d.isValid()) return "";
  return d.format("MM-DD-YYYY");
}

function formatDateSlash(dateVal: any): string {
  if (!dateVal) return "";
  const d = dayjs.utc(dateVal);
  if (!d.isValid()) return "";
  return d.format("MM/DD/YYYY");
}

function formatAmount(amount: any): string {
  const num = parseFloat(amount) || 0;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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


router.get("/get-all-investment-name-list", async (req: Request, res: Response) => {
  try {
    const investmentStage = parseInt(String(req.query.investmentStage || "0"), 10);
    const investmentId = parseInt(String(req.query.investmentId || "0"), 10) || 0;

    if (investmentStage === 4) {
      const campaignResult = await pool.query(
        `SELECT id, name, investment_instruments
         FROM campaigns
         WHERE stage != $1 AND TRIM(COALESCE(name, '')) != ''
         AND (is_deleted IS NULL OR is_deleted = false)
         ORDER BY name ASC`,
        [STAGE_CLOSED_NOT_INVESTED]
      );

      const investmentTypesResult = await pool.query(`SELECT id, name FROM investment_instruments`);
      const investmentTypes = investmentTypesResult.rows;

      const result = campaignResult.rows.map((c: any) => {
        let isPrivateDebt = false;
        if (c.investment_instruments) {
          const typeIds = c.investment_instruments
            .split(",")
            .map((s: string) => parseInt(s.trim(), 10))
            .filter((n: number) => !isNaN(n));
          isPrivateDebt = typeIds.some((typeId: number) => {
            const it = investmentTypes.find((t: any) => t.id === typeId);
            return it && it.name && it.name.includes("Private Debt");
          });
        }
        return { id: c.id, name: c.name, isPrivateDebt };
      });

      res.json(result);
    } else if (investmentStage === 3) {
      const result = await pool.query(
        `SELECT id, name
         FROM campaigns
         WHERE stage = $1 AND TRIM(COALESCE(name, '')) != ''
         AND (is_deleted IS NULL OR is_deleted = false)
         ORDER BY name ASC`,
        [STAGE_CLOSED_INVESTED]
      );

      res.json(result.rows.map((c: any) => ({ id: c.id, name: c.name })));
    } else if (investmentStage === 0) {
      let query = `SELECT id, name FROM campaigns WHERE TRIM(COALESCE(name, '')) != '' AND (is_deleted IS NULL OR is_deleted = false)`;
      const values: any[] = [];

      if (investmentId > 0) {
        query += ` AND id != $1`;
        values.push(investmentId);
      }

      query += ` ORDER BY name ASC`;

      const result = await pool.query(query, values);
      res.json(result.rows.map((c: any) => ({ id: c.id, name: c.name })));
    } else {
      res.status(400).json({ success: false, message: "Invalid investment stage." });
    }
  } catch (err: any) {
    console.error("Error fetching investment name list:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/user-disbursal-investments", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      res.status(401).json({ success: false, message: "User email not found." });
      return;
    }

    const result = await pool.query(
      `SELECT id, name, property, investment_role, impact_assets_funding_status,
              contact_info_phone_number, investment_instruments
       FROM campaigns
       WHERE is_active = true
         AND (is_deleted IS NULL OR is_deleted = false)
         AND COALESCE(TRIM(contact_info_email_address), '') = $1
       ORDER BY name ASC`,
      [email]
    );

    const campaigns = result.rows;

    if (campaigns.length === 0) {
      res.json([]);
      return;
    }

    const typeMap = await buildInvestmentTypeMap(campaigns);

    const mapped = campaigns.map((c: any) => ({
      id: c.id,
      name: c.name,
      property: c.property,
      investmentRole: c.investment_role,
      impactAssetsFundingStatus: c.impact_assets_funding_status,
      contactInfoPhoneNumber: c.contact_info_phone_number,
      investmentType: resolveInvestmentTypeString(c.investment_instruments, typeMap),
    }));

    res.json(mapped);
  } catch (err: any) {
    console.error("Error fetching user disbursal investments:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/save-disbursal", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const loginUserId = req.user?.id;
    if (!loginUserId) {
      res.status(400).json({ success: false, message: "User not found." });
      return;
    }

    const dto = req.body;

    if (dto.id && dto.id > 0) {
      const existing = await pool.query(
        `SELECT id FROM disbursal_requests WHERE id = $1 AND user_id = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.id, loginUserId]
      );

      if (existing.rows.length === 0) {
        res.json({ success: false, message: "Data not found." });
        return;
      }

      if (dto.note && dto.note.trim()) {
        await pool.query(
          `INSERT INTO disbursal_request_notes (disbursal_request_id, note, created_by, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [dto.id, dto.note.trim(), loginUserId]
        );
      }

      res.json({ success: true, message: "Disbursal request updated successfully." });
      return;
    }

    let pitchDeckFile = "";
    let investmentDocFile = "";

    if (dto.pitchDeck) {
      const result = await uploadBase64Image(dto.pitchDeck, "disbursal-requests", { maxFileSizeBytes: MAX_PITCH_DECK_FILE_SIZE_BYTES });
      pitchDeckFile = result.filePath;
    }

    if (dto.investmentDocument) {
      const result = await uploadBase64Image(dto.investmentDocument, "disbursal-requests");
      investmentDocFile = result.filePath;
    }

    const insertResult = await pool.query(
      `INSERT INTO disbursal_requests
        (user_id, campaign_id, role, mobile, quote, distributed_amount, status,
         impact_assets_funding_previously, investment_remain_open, receive_date,
         pitch_deck, pitch_deck_name, investment_document, investment_document_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, NOW())
       RETURNING id`,
      [
        loginUserId,
        dto.campaignId || null,
        dto.role || null,
        dto.mobile || null,
        dto.quote || null,
        dto.distributedAmount || 0,
        dto.impactAssetsFundingPreviously || null,
        dto.investmentRemainOpen || null,
        dto.receiveDate || null,
        pitchDeckFile || null,
        dto.pitchDeckName || null,
        investmentDocFile || null,
        dto.investmentDocumentName || null,
      ]
    );

    const disbursalId = insertResult.rows[0].id;

    const campaignResult = await pool.query(
      `SELECT name FROM campaigns WHERE id = $1`,
      [dto.campaignId]
    );
    const investmentName = campaignResult.rows[0]?.name || "";

    const formattedAmountStr = formatAmount(dto.distributedAmount);
    const formattedDate = formatDateSlash(dto.receiveDate);

    const requestOrigin = process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
    const disbursementUrl = `${requestOrigin}/disbursal-request-detail/${disbursalId}`;
    const adminEmail = process.env.CATACAP_ADMIN_EMAIL || "";
    const logoUrl = process.env.LOGO_URL || "";

    try {
      await sendTemplateEmail(22, adminEmail, {
        logoUrl,
        investmentName,
        amount: formattedAmountStr,
        date: formattedDate,
        disbursementUrl,
      });
    } catch (emailErr: any) {
      console.error("Error sending disbursal email notification:", emailErr);
    }

    res.json({ success: true, message: "Disbursal request saved successfully." });
  } catch (err: any) {
    console.error("Error saving disbursal request:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get-disbursal-request", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.query.id || "0"), 10);
    if (!id || id <= 0) {
      res.json({ success: false, message: "Id is required." });
      return;
    }

    const loginUserId = req.user?.id;

    const result = await pool.query(
      `SELECT d.id, u.first_name, u.last_name, u.email, d.role, d.mobile,
              d.status, d.quote, c.name, d.distributed_amount, c.property,
              d.investment_remain_open, d.receive_date, d.pitch_deck,
              d.pitch_deck_name, d.investment_document, d.investment_document_name,
              d.impact_assets_funding_previously, c.investment_instruments
       FROM disbursal_requests d
       JOIN campaigns c ON d.campaign_id = c.id AND (c.is_deleted IS NULL OR c.is_deleted = false)
       LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       WHERE d.id = $1 AND d.user_id = $2 AND (d.is_deleted IS NULL OR d.is_deleted = false)`,
      [id, loginUserId]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "Disbursal Request not found." });
      return;
    }

    const row = result.rows[0];
    const typeMap = await buildInvestmentTypeMap([row]);
    const investmentTypeNames = resolveInvestmentTypeString(row.investment_instruments, typeMap);

    res.json({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      role: row.role,
      mobile: row.mobile,
      name: row.name,
      distributedAmount: parseFloat(row.distributed_amount) || 0,
      property: row.property,
      investmentRemainOpen: row.investment_remain_open,
      receiveDate: formatDate(row.receive_date),
      pitchDeck: resolveFileUrl(row.pitch_deck, "disbursal-requests"),
      status: row.status,
      statusName: getStatusName(row.status),
      quote: row.quote,
      pitchDeckName: row.pitch_deck_name,
      investmentDocument: resolveFileUrl(row.investment_document, "disbursal-requests"),
      investmentDocumentName: row.investment_document_name,
      impactAssetsFundingPreviously: row.impact_assets_funding_previously,
      investmentTypeNames,
    });
  } catch (err: any) {
    console.error("Error fetching disbursal request:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get-disbursal-request-list", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = (params.sortDirection || "").toLowerCase() === "asc";
    const page = params.currentPage;
    const pageSize = params.perPage;
    const loginUserId = req.user?.id;

    const queryText = `
      SELECT d.id, d.receive_date, u.email, d.mobile, d.distributed_amount,
             d.status, d.quote, c.name, c.id AS investment_id, c.property,
             d.pitch_deck, d.pitch_deck_name, d.investment_document,
             d.investment_document_name, c.investment_instruments
      FROM disbursal_requests d
      JOIN campaigns c ON d.campaign_id = c.id AND (c.is_deleted IS NULL OR c.is_deleted = false)
      LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
      WHERE d.user_id = $1 AND (d.is_deleted IS NULL OR d.is_deleted = false)
    `;

    const allResult = await pool.query(queryText, [loginUserId]);
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
      hasNotes: notesSet.has(x.id),
    }));

    const items = mapped.slice((page - 1) * pageSize, page * pageSize);

    if (items.length > 0) {
      res.json({ items, totalCount });
    } else {
      res.json({ success: false, message: "Data not found." });
    }
  } catch (err: any) {
    console.error("Error fetching disbursal request list:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/export-disbursal-request-list", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const loginUserId = req.user?.id;
    const queryText = `
      SELECT d.id, d.receive_date, u.email, d.distributed_amount,
             c.name, d.quote, d.status, c.investment_instruments
      FROM disbursal_requests d
      JOIN campaigns c ON d.campaign_id = c.id AND (c.is_deleted IS NULL OR c.is_deleted = false)
      LEFT JOIN users u ON d.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
      WHERE d.user_id = $1 AND (d.is_deleted IS NULL OR d.is_deleted = false)
    `;
    const result = await pool.query(queryText, [loginUserId]);
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
    console.error("Error exporting disbursal request list:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get-disbursal-request-notes", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const disbursalRequestId = parseInt(String(req.query.disbursalRequestId || "0"), 10);
    if (!disbursalRequestId || disbursalRequestId <= 0) {
      res.json({ success: false, message: "Invalid disbursal request id" });
      return;
    }

    const loginUserId = req.user?.id;

    const ownerCheck = await pool.query(
      `SELECT id FROM disbursal_requests WHERE id = $1 AND user_id = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
      [disbursalRequestId, loginUserId]
    );

    if (ownerCheck.rows.length === 0) {
      res.json({ success: false, message: "Notes not found" });
      return;
    }

    const result = await pool.query(
      `SELECT n.id, n.note, u.user_name AS "userName", n.created_at AS "createdAt"
       FROM disbursal_request_notes n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.disbursal_request_id = $1
         AND (n.is_deleted IS NULL OR n.is_deleted = false)
       ORDER BY n.id DESC`,
      [disbursalRequestId]
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

function convertHtmlNoteToPlainText(htmlNote: string | null | undefined): string {
  if (!htmlNote) return "";
  let result = htmlNote.replace(/<(b|strong)>\s*(.*?)\s*<\/\1>/gi, "@$2");
  result = result.replace(/<[^>]+>/g, "");
  result = result.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return result.trim();
}

function formatDateMMDDYYYY(dateVal: any): string {
  if (!dateVal) return "";
  const d = dayjs.utc(dateVal);
  if (!d.isValid()) return "";
  return d.format("MM-DD-YYYY");
}

router.get("/send-investment-qr-code-email", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.query.id || "0"), 10);
    const investmentTag = String(req.query.investmentTag || "");

    if (!id || id <= 0) {
      res.json({ success: false, message: "Invalid investment id" });
      return;
    }

    const campaignResult = await pool.query(
      `SELECT id, name, property, contact_info_email_address, contact_info_full_name FROM campaigns WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );

    if (campaignResult.rows.length === 0) {
      res.json({ success: false, message: "Investment not found." });
      return;
    }

    const investment = campaignResult.rows[0];

    if (!investment.contact_info_email_address || !investment.contact_info_email_address.trim()) {
      res.json({ success: false, message: "You can't send QR by email because your organizational email isn't set up yet" });
      return;
    }

    const requestOrigin = process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
    const trimmedTag = investmentTag ? investmentTag.trim() : "";
    let investmentUrl = trimmedTag
      ? (trimmedTag.startsWith("http://") || trimmedTag.startsWith("https://")
        ? trimmedTag
        : `${requestOrigin}/investments?tag=${encodeURIComponent(trimmedTag)}`)
      : investment.property
        ? `${requestOrigin}/invest/${encodeURIComponent(investment.property)}`
        : null;

    if (!investmentUrl) {
      res.json({ success: false, message: "Failed to send email because investment URL is missing." });
      return;
    }

    const fullName = investment.contact_info_full_name || "";
    const parts = fullName.split(/\s+/).filter((p: string) => p.length > 0);
    const firstName = parts.length > 0 ? parts[0] : "";

    const qrPngBuffer = await QRCode.toBuffer(investmentUrl, {
      type: "png",
      width: 400,
      errorCorrectionLevel: "Q",
    });

    const logoUrl = process.env.LOGO_URL || "";
    const unsubscribeUrl = `${requestOrigin}/settings`;

    let emailSent = false;
    try {
      emailSent = await sendTemplateEmailWithAttachments(
        17,
        investment.contact_info_email_address.trim().toLowerCase(),
        {
          logoUrl,
          firstName,
          investmentName: investment.name || "",
          unsubscribeUrl,
          investmentUrl,
        },
        [
          {
            filename: `${investment.name || "investment"}.png`,
            content: qrPngBuffer,
            contentType: "image/png",
          },
        ]
      );
    } catch (emailErr: any) {
      console.error("Error sending QR code email:", emailErr);
      emailSent = false;
    }

    if (!emailSent) {
      res.json({ success: false, message: "Failed to send QR code email. Please check email configuration." });
      return;
    }

    res.json({ success: true, message: "Email sent successfully." });
  } catch (err: any) {
    console.error("Error sending QR code email:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/export-investment-notes", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(String(req.query.campaignId || "0"), 10);

    const notesResult = await pool.query(
      `SELECT n.id, n.old_status, n.new_status, n.note, n.created_at,
              u.user_name, c.name AS campaign_name
       FROM investment_notes n
       LEFT JOIN users u ON n.created_by = u.id
       LEFT JOIN campaigns c ON n.campaign_id = c.id
       WHERE n.campaign_id = $1
       ORDER BY n.id DESC`,
      [campaignId]
    );

    const notes = notesResult.rows;
    const campaignName = notes.length > 0 ? notes[0].campaign_name : "Investment Notes";

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("InvestmentNotes");

    worksheet.mergeCells("A1:E2");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "Investment Name: " + (campaignName || "Investment Notes");
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    const headerRowNum = 3;
    const headers = ["Date", "Username", "From", "To", "Note"];
    const headerRow = worksheet.getRow(headerRowNum);
    headers.forEach((h, i) => {
      headerRow.getCell(i + 1).value = h;
    });
    headerRow.font = { bold: true };

    notes.forEach((note: any, index: number) => {
      const row = worksheet.getRow(headerRowNum + 1 + index);
      row.getCell(1).value = note.created_at ? formatDateMMDDYYYY(note.created_at) : "";
      row.getCell(2).value = note.user_name || "";
      row.getCell(3).value = note.old_status || "";
      row.getCell(4).value = note.new_status || "";
      row.getCell(5).value = convertHtmlNoteToPlainText(note.note);
    });

    worksheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value || "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = maxLen + 10;
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=InvestmentNotes.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting investment notes:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get-investments-notes", jwtUserAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const investmentId = parseInt(String(req.query.investmentId || "0"), 10);
    if (!investmentId || investmentId <= 0) {
      res.json({ success: false, message: "Invalid investment id" });
      return;
    }

    const result = await pool.query(
      `SELECT n.id, n.old_status AS "oldStatus", n.new_status AS "newStatus",
              n.note, u.user_name AS "userName", n.created_at AS "createdAt"
       FROM investment_notes n
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.campaign_id = $1
       ORDER BY n.id DESC`,
      [investmentId]
    );

    if (result.rows.length > 0) {
      res.json(result.rows);
    } else {
      res.json({ success: false, message: "Notes not found" });
    }
  } catch (err: any) {
    console.error("Error fetching investment notes:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

const InvestmentStageEnum: Record<string, number> = {
  Private: 1,
  Public: 2,
  ClosedInvested: 3,
  ClosedNotInvested: 4,
  New: 5,
  ComplianceReview: 6,
  CompletedOngoing: 7,
  Vetting: 8,
  CompletedOngoingPrivate: 9,
};


async function verifyCaptcha(token: string): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET_KEY || "";
  if (!secret) {
    console.warn("[CAPTCHA] No HCAPTCHA_SECRET_KEY configured, skipping verification.");
    return true;
  }

  try {
    const params = new URLSearchParams();
    params.append("secret", secret);
    params.append("response", token);

    const response = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      body: params,
    });

    const data = await response.json() as any;
    return data.success === true;
  } catch (err) {
    console.error("[CAPTCHA] Verification request failed:", err);
    return false;
  }
}

async function handleTagMappings(campaignId: number, investmentTags: any[]): Promise<void> {
  const tagNames = investmentTags
    .map((t: any) => (typeof t === "string" ? t : t.tag || "").trim())
    .filter((t: string) => t.length > 0);

  if (tagNames.length === 0) {
    await pool.query(`DELETE FROM investment_tag_mappings WHERE campaign_id = $1`, [campaignId]);
    return;
  }

  for (const tagName of tagNames) {
    const existing = await pool.query(
      `SELECT id FROM investment_tags WHERE LOWER(TRIM(tag)) = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [tagName.toLowerCase()]
    );
    if (existing.rows.length === 0) {
      await pool.query(`INSERT INTO investment_tags (tag) VALUES ($1)`, [tagName]);
    }
  }

  const allTagsResult = await pool.query(
    `SELECT id, tag FROM investment_tags WHERE (is_deleted IS NULL OR is_deleted = false)`
  );
  const allTags = allTagsResult.rows;

  const tagNameLowerSet = new Set(tagNames.map((t: string) => t.toLowerCase()));
  const matchingTagIds = allTags
    .filter((t: any) => tagNameLowerSet.has(t.tag.trim().toLowerCase()))
    .map((t: any) => Number(t.id));

  await pool.query(`DELETE FROM investment_tag_mappings WHERE campaign_id = $1`, [campaignId]);

  for (const tagId of matchingTagIds) {
    await pool.query(
      `INSERT INTO investment_tag_mappings (tag_id, campaign_id) VALUES ($1, $2)`,
      [tagId, campaignId]
    );
  }
}

router.post("/raisemoney", async (req: Request, res: Response) => {
  try {
    const campaign = req.body;
    if (!campaign) {
      res.json({ success: false, message: "Campaign data is required." });
      return;
    }

    if (!campaign.contactInfoEmailAddress) {
      res.json({ success: false, message: "Email is required." });
      return;
    }

    if (!campaign.firstName || !(campaign.firstName || "").trim()) {
      res.json({ success: false, message: "First Name is required." });
      return;
    }

    if (!campaign.lastName || !(campaign.lastName || "").trim()) {
      res.json({ success: false, message: "Last Name is required." });
      return;
    }

    if (campaign.captchaToken && typeof campaign.captchaToken === "string" && campaign.captchaToken.trim()) {
      const captchaValid = await verifyCaptcha(campaign.captchaToken);
      if (!captchaValid) {
        res.status(400).json({ message: "CAPTCHA verification failed." });
        return;
      }
    }

    const userEmail = campaign.contactInfoEmailAddress.trim().toLowerCase();
    const { id: userId } = await findOrCreateAnonymousUser(
      userEmail,
      campaign.firstName,
      campaign.lastName
    );

    let pdfFileName = extractStoragePath(campaign.pdfFileName) || null;
    let imageFileName = extractStoragePath(campaign.imageFileName) || null;
    let tileImageFileName = extractStoragePath(campaign.tileImageFileName) || null;
    let logoFileName = extractStoragePath(campaign.logoFileName) || null;

    if (campaign.pdfPresentation || campaign.PDFPresentation) {
      const result = await uploadBase64Image(campaign.pdfPresentation || campaign.PDFPresentation, "campaigns", { maxFileSizeBytes: MAX_PITCH_DECK_FILE_SIZE_BYTES });
      pdfFileName = result.filePath;
    }
    if (campaign.image) {
      const result = await uploadBase64Image(campaign.image, "campaigns");
      imageFileName = result.filePath;
    }
    if (campaign.tileImage) {
      const result = await uploadBase64Image(campaign.tileImage, "campaigns");
      tileImageFileName = result.filePath;
    }
    if (campaign.logo) {
      const result = await uploadBase64Image(campaign.logo, "campaigns");
      logoFileName = result.filePath;
    }

    const insertResult = await pool.query(
      `INSERT INTO campaigns (
        name, description, themes, approved_by, sdgs, investment_instruments, terms,
        minimum_investment, website, network_description, contact_info_full_name,
        contact_info_address, contact_info_address_2, contact_info_email_address,
        investment_informational_email, contact_info_phone_number, country,
        other_country_address, city, state, zip_code, impact_assets_funding_status,
        investment_role, referred_to_catacap, target, status, stage, is_active,
        pdf_file_name, original_pdf_file_name, image_file_name, tile_image_file_name,
        logo_file_name, property, added_total_admin_raised, email_sends,
        group_for_private_access_id, fundraising_close_date, mission_and_vision,
        personalized_thank_you, has_existing_investors, expected_total,
        is_part_of_fund, associated_fund_id, featured_investment,
        investment_type_category, equity_valuation, equity_security_type,
        fund_term, equity_target_return, debt_payment_frequency,
        debt_maturity_date, debt_interest_rate, user_id,
        meta_title, meta_description, created_date, modified_date
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,NOW(),NOW()
      ) RETURNING id`,
      [
        campaign.name || null,
        campaign.description || null,
        campaign.themes || null,
        campaign.approvedBy || null,
        campaign.sdGs || campaign.sdgs || null,
        campaign.investmentTypes || null,
        campaign.terms || null,
        campaign.minimumInvestment || null,
        campaign.website || null,
        campaign.networkDescription || null,
        campaign.contactInfoFullName || null,
        campaign.contactInfoAddress || null,
        campaign.contactInfoAddress2 || null,
        campaign.contactInfoEmailAddress || null,
        campaign.investmentInformationalEmail || null,
        campaign.contactInfoPhoneNumber || null,
        campaign.country || null,
        campaign.otherCountryAddress || null,
        campaign.city || null,
        campaign.state || null,
        campaign.zipCode || null,
        campaign.impactAssetsFundingStatus || null,
        campaign.investmentRole || null,
        campaign.referredToCataCap || null,
        campaign.target || null,
        "0",
        InvestmentStageEnum.New,
        false,
        pdfFileName,
        campaign.originalPdfFileName || pdfFileName,
        imageFileName,
        tileImageFileName,
        logoFileName,
        campaign.property || null,
        0,
        false,
        campaign.groupForPrivateAccessDto?.id || null,
        campaign.fundraisingCloseDate || null,
        campaign.missionAndVision || null,
        campaign.personalizedThankYou || null,
        campaign.hasExistingInvestors || false,
        campaign.expectedTotal || null,
        campaign.isPartOfFund || false,
        campaign.associatedFundId || null,
        campaign.featuredInvestment || false,
        campaign.investmentTypeCategory || null,
        campaign.equityValuation || null,
        campaign.equitySecurityType || null,
        campaign.fundTerm || null,
        campaign.equityTargetReturn || null,
        campaign.debtPaymentFrequency || null,
        campaign.debtMaturityDate || null,
        campaign.debtInterestRate || null,
        userId,
        campaign.metaTitle || null,
        campaign.metaDescription || null,
      ]
    );

    const newCampaignId = insertResult.rows[0].id;

    if (campaign.investmentTag && Array.isArray(campaign.investmentTag) && campaign.investmentTag.length > 0) {
      await handleTagMappings(newCampaignId, campaign.investmentTag);
    }

    const logoUrl = process.env.LOGO_URL || "";
    const requestOrigin = process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";

    const parsIdSdgs = (campaign.sdGs || campaign.sdgs || "").split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
    const parsIdInvestmentTypes = (campaign.investmentTypes || "").split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
    const parsIdThemes = (campaign.themes || "").split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));

    let sdgNamesString = "";
    let investmentTypeNamesString = "";
    let themeNamesString = "";

    if (parsIdSdgs.length > 0) {
      const placeholders = parsIdSdgs.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const sdgResult = await pool.query(`SELECT name FROM sdgs WHERE id IN (${placeholders})`, parsIdSdgs);
      sdgNamesString = sdgResult.rows.map((r: any) => r.name).join(", ");
    }
    if (parsIdInvestmentTypes.length > 0) {
      const placeholders = parsIdInvestmentTypes.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const itResult = await pool.query(`SELECT name FROM investment_instruments WHERE id IN (${placeholders})`, parsIdInvestmentTypes);
      investmentTypeNamesString = itResult.rows.map((r: any) => r.name).join(", ");
    }
    if (parsIdThemes.length > 0) {
      const placeholders = parsIdThemes.map((_: any, i: number) => `$${i + 1}`).join(", ");
      const thResult = await pool.query(`SELECT name FROM themes WHERE id IN (${placeholders})`, parsIdThemes);
      themeNamesString = thResult.rows.map((r: any) => r.name).join(", ");
    }

    const campaignVariables: Record<string, string> = {
      logoUrl,
      userFullName: `${campaign.firstName} ${campaign.lastName}`,
      ownerEmail: campaign.contactInfoEmailAddress || "",
      informationalEmail: campaign.investmentInformationalEmail || "",
      mobileNumber: campaign.contactInfoPhoneNumber || "",
      addressLine1: campaign.contactInfoAddress || "",
      investmentName: campaign.name || "",
      investmentDescription: campaign.description || "",
      website: campaign.website || "",
      investmentTypes: investmentTypeNamesString,
      terms: campaign.terms || "",
      target: campaign.target?.toString() || "",
      fundraisingCloseDate: campaign.fundraisingCloseDate?.toString() || "",
      themes: themeNamesString,
      sdgs: sdgNamesString,
      impactAssetsFundingStatus: campaign.impactAssetsFundingStatus || "",
      investmentRole: campaign.investmentRole || "",
      addressLine2Section: !campaign.contactInfoAddress2 ? "" : `<p>Address Line 2: ${campaign.contactInfoAddress2}</p><br/>`,
      citySection: !campaign.city ? "" : `<p>City: ${campaign.city}</p><br/>`,
      stateSection: !campaign.state ? "" : `<p>State: ${campaign.state}</p><br/>`,
      zipCodeSection: !campaign.zipCode ? "" : `<p>Zip Code: ${campaign.zipCode}</p><br/>`,
    };

    try {
      await sendTemplateEmail(23, "ken@catacap.org", campaignVariables);
    } catch (emailErr: any) {
      console.error("Error sending InvestmentSubmissionNotification email:", emailErr);
    }

    const catacapAdminVariables: Record<string, string> = {
      logoUrl,
      date: dayjs.utc().format("MM/DD/YYYY"),
      campaignName: campaign.name || "",
    };

    try {
      await sendTemplateEmail(21, "catacap-admin@catacap.org", catacapAdminVariables);
    } catch (emailErr: any) {
      console.error("Error sending InvestmentPublished email:", emailErr);
    }

    const underReviewVariables: Record<string, string> = {
      logoUrl,
      fullName: `${campaign.firstName} ${campaign.lastName}`,
      investmentName: campaign.name || "",
      preLaunchToolkitUrl: "https://www.notion.so/Pre-Launch-23fc1b9e8945806796f4fa7cf38fa388?source=copy_link",
      partnerBenefitsUrl: "https://docs.google.com/document/d/13LHN3uYCsG-dsaI3GPwbo-kK2NZ4rxY2UYp2B0ZEGjo/edit?tab=t.0",
      faqPageUrl: "https://www.catacap.org/faqs/#investment",
      unsubscribeUrl: `${requestOrigin}/settings`,
    };

    try {
      await sendTemplateEmail(16, userEmail, underReviewVariables);
    } catch (emailErr: any) {
      console.error("Error sending InvestmentUnderReview email:", emailErr);
    }

    res.json({ success: true, message: "Investment has been created successfully." });
  } catch (err: any) {
    console.error("Error creating raise money campaign:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// GET /api/Campaign/cover-fees-status/:campaignId
//
// Public endpoint surfacing whether a campaign's CataCap platform fee
// is sponsor-covered. Returns a compact payload for embedding on the
// public investment page:
//   { isCovered, sponsorName, remainingEscrow }
// `remainingEscrow` is null for unlimited (non-escrow) pools.
// ------------------------------------------------------------------ //
async function lookupCoverFeesStatus(campaignId: number, res: Response) {
  // Pull every active, non-expired pool covering this campaign so we
  // can pick one that still has remaining capacity. Selecting LIMIT 1
  // by id alone could return an exhausted pool while another active
  // pool still has escrow available, leading to a false "not covered".
  const result = await pool.query(
      `SELECT ccf.id, ccf.name, ccf.total_cap, ccf.amount_used,
              ccf.reserved_amount, ccf.expires_at,
              ccf.display_sponsor_name,
              CONCAT(u.first_name, ' ', u.last_name) AS sponsor_full_name,
              u.user_name AS sponsor_user_name
         FROM campaign_cover_fees ccf
         JOIN campaign_cover_fees_campaigns ccfc
              ON ccfc.cover_fee_id = ccf.id AND ccfc.campaign_id = $1
         LEFT JOIN users u ON u.id = ccf.sponsor_user_id
        WHERE ccf.is_active = TRUE
          AND (ccf.expires_at IS NULL OR ccf.expires_at > NOW())
        ORDER BY ccf.id ASC`,
      [campaignId],
    );
    if (result.rows.length === 0) {
      res.json({ isCovered: false, sponsorName: null, remainingEscrow: null });
      return;
    }
    const computeRemaining = (r: any) => {
      const reserved = parseFloat(r.reserved_amount) || 0;
      const used = parseFloat(r.amount_used) || 0;
      const totalCap = r.total_cap != null ? parseFloat(r.total_cap) : null;
      if (reserved > 0) return Math.max(0, Math.round((reserved - used) * 100) / 100);
      if (totalCap != null) return Math.max(0, Math.round((totalCap - used) * 100) / 100);
      return null;
    };
    // Prefer the first pool with remaining capacity; fall back to the
    // first pool overall so we still surface a sponsor name when every
    // pool is technically exhausted (unlimited pools always qualify).
    const chosen =
      result.rows.find((r) => {
        const rem = computeRemaining(r);
        return rem == null || rem > 0;
      }) || result.rows[0];
    const remaining = computeRemaining(chosen);
    const isCovered = remaining == null || remaining > 0;
    // Admin-set override wins over the sponsor's real name. Falls back
    // to first/last → user_name → "Sponsor" for legacy pools that have
    // no display override configured.
    const sponsorName =
      ((chosen.display_sponsor_name || "").trim() ||
        (chosen.sponsor_full_name || "").trim() ||
        chosen.sponsor_user_name ||
        "Sponsor");
    res.json({ isCovered, sponsorName, remainingEscrow: remaining });
}

router.get("/cover-fees-status/:campaignId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.campaignId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid campaignId" });
      return;
    }
    await lookupCoverFeesStatus(id, res);
  } catch (err: any) {
    console.error("Error fetching cover-fees status:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Slug-based variant for the public donation app, which routes by
// campaign URL slug rather than numeric id.
router.get("/cover-fees-status/by-slug/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) {
      res.status(400).json({ success: false, message: "Invalid slug" });
      return;
    }
    const slugRes = await pool.query(
      `SELECT reference_id FROM slugs WHERE type = 1 AND value = $1 LIMIT 1`,
      [slug],
    );
    if (slugRes.rows.length === 0) {
      res.json({ isCovered: false, sponsorName: null, remainingEscrow: null });
      return;
    }
    await lookupCoverFeesStatus(parseInt(slugRes.rows[0].reference_id, 10), res);
  } catch (err: any) {
    console.error("Error fetching cover-fees status by slug:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/investment-request", async (req: Request, res: Response) => {
  try {
    const dto = req.body;

    if (!dto.email || !(dto.email || "").trim()) {
      res.json({ success: false, message: "Email is required." });
      return;
    }

    const userEmail = dto.email.trim().toLowerCase();
    const { id: userId } = await findOrCreateAnonymousUser(
      userEmail,
      dto.firstName || "",
      dto.lastName || ""
    );

    const status = dto.isDraft ? 0 : 1;

    let logoFileName = dto.logoFileName || null;
    let heroImageFileName = dto.heroImageFileName || null;
    let pitchDeckFileName = dto.pitchDeckFileName || null;

    let logoPath: string | null = null;
    let heroImagePath: string | null = null;
    let pitchDeckPath: string | null = null;

    if (dto.logo) {
      const result = await uploadBase64Image(dto.logo, "investment-requests");
      logoPath = result.filePath;
    }
    if (dto.heroImage) {
      const result = await uploadBase64Image(dto.heroImage, "investment-requests");
      heroImagePath = result.filePath;
    }
    if (dto.pitchDeck) {
      const result = await uploadBase64Image(dto.pitchDeck, "investment-requests", { maxFileSizeBytes: MAX_PITCH_DECK_FILE_SIZE_BYTES });
      pitchDeckPath = result.filePath;
    }

    const investmentTypes = Array.isArray(dto.investmentTypes) ? dto.investmentTypes.join(",") : (dto.investmentTypes || null);
    const investmentThemes = Array.isArray(dto.investmentThemes) ? dto.investmentThemes.join(",") : (dto.investmentThemes || null);

    const insertResult = await pool.query(
      `INSERT INTO investment_requests (
        current_step, status, country, user_id, website, organization_name,
        currently_raising, investment_types, investment_themes, theme_description,
        capital_raised, referenceable_investors, has_donor_commitment, soft_circled_amount,
        timeline, campaign_goal, role, referral_source,
        logo, logo_file_name, hero_image, hero_image_file_name,
        pitch_deck, pitch_deck_file_name, investment_terms, why_back_your_investment,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, NOW()
      ) RETURNING id`,
      [
        dto.currentStep || 0,
        status,
        dto.country || null,
        userId,
        dto.website || null,
        dto.organizationName || null,
        dto.currentlyRaising || false,
        investmentTypes,
        investmentThemes,
        dto.themeDescription || null,
        dto.capitalRaised || null,
        dto.referenceableInvestors || null,
        dto.hasDonorCommitment || false,
        dto.softCircledAmount || 0,
        dto.timeline || null,
        dto.campaignGoal || 0,
        dto.role || null,
        dto.referralSource || null,
        logoPath,
        logoFileName,
        heroImagePath,
        heroImageFileName,
        pitchDeckPath,
        pitchDeckFileName,
        dto.investmentTerms || null,
        dto.whyBackYourInvestment || null,
      ]
    );

    const newId = insertResult.rows[0].id;

    res.json({
      success: true,
      message: dto.isDraft ? "Draft saved successfully." : "Investment request submitted successfully.",
      id: newId,
    });
  } catch (err: any) {
    console.error("Error saving investment request:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
