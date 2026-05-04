import { Router } from "express";
import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import pool from "../db.js";
import { runRetroactiveSweep } from "../utils/matchingGrants.js";
import {
  projectPendingMatchesForGrant,
  projectPendingTotalsForAllGrants,
} from "../utils/pendingMatches.js";

const router = Router();

// ------------------------------------------------------------------ //
// Shared helper: reserve cap from donor wallet inside an open txn
// ------------------------------------------------------------------ //
async function reserveCapFromWallet(
  client: any,
  donorUserId: string,
  capAmount: number,
  grantName: string,
): Promise<{ oldBalance: number; newBalance: number }> {
  const donorRes = await client.query(
    `SELECT account_balance, user_name, email FROM users WHERE id = $1 FOR UPDATE`,
    [donorUserId],
  );
  if (donorRes.rows.length === 0) throw new Error("Donor user not found.");

  const oldBalance = parseFloat(donorRes.rows[0].account_balance) || 0;
  if (oldBalance < capAmount) {
    throw new Error(
      `Donor balance (${oldBalance.toFixed(2)}) is insufficient for the requested cap (${capAmount.toFixed(2)}).`,
    );
  }
  const newBalance = parseFloat((oldBalance - capAmount).toFixed(2));

  await client.query(
    `UPDATE users SET account_balance = $1 WHERE id = $2`,
    [newBalance, donorUserId],
  );

  await client.query(
    `INSERT INTO account_balance_change_logs
       (user_id, payment_type, investment_name, old_value, user_name, new_value, change_date)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      donorUserId,
      "Match grant – funds reserved",
      grantName || "Match grant",
      oldBalance,
      donorRes.rows[0].user_name || donorRes.rows[0].email || "",
      newBalance,
    ],
  );

  return { oldBalance, newBalance };
}

// ------------------------------------------------------------------ //
// Shared helper: return unused reserved funds to donor wallet
// ------------------------------------------------------------------ //
async function returnUnusedFunds(
  client: any,
  donorUserId: string,
  reservedAmount: number,
  amountUsed: number,
  grantName: string,
): Promise<number> {
  const refund = Math.max(
    0,
    Math.round((reservedAmount - amountUsed) * 100) / 100,
  );
  if (refund <= 0) return 0;

  const donorRes = await client.query(
    `SELECT account_balance, user_name, email FROM users WHERE id = $1 FOR UPDATE`,
    [donorUserId],
  );
  if (donorRes.rows.length === 0) return 0;

  const oldBalance = parseFloat(donorRes.rows[0].account_balance) || 0;
  const newBalance = parseFloat((oldBalance + refund).toFixed(2));

  await client.query(
    `UPDATE users SET account_balance = $1 WHERE id = $2`,
    [newBalance, donorUserId],
  );

  await client.query(
    `INSERT INTO account_balance_change_logs
       (user_id, payment_type, investment_name, old_value, user_name, new_value, change_date)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      donorUserId,
      "Match grant – unused funds returned",
      grantName || "Match grant",
      oldBalance,
      donorRes.rows[0].user_name || donorRes.rows[0].email || "",
      newBalance,
    ],
  );

  return refund;
}

// ------------------------------------------------------------------ //
// GET /api/admin/matching
// ------------------------------------------------------------------ //
router.get("/", async (req: Request, res: Response) => {
  try {
    const [grantsResult, pendingTotals] = await Promise.all([
      pool.query(
        `SELECT cmg.id,
                cmg.name,
                cmg.donor_user_id,
                u.email          AS donor_email,
                CONCAT(u.first_name, ' ', u.last_name) AS donor_full_name,
                u.user_name      AS donor_user_name,
                u.account_balance AS donor_balance,
                cmg.total_cap,
                cmg.amount_used,
                cmg.reserved_amount,
                cmg.match_type,
                cmg.per_investment_cap,
                cmg.is_active,
                cmg.notes,
                cmg.expires_at,
                cmg.retroactive_from,
                cmg.created_at,
                cmg.updated_at,
                (SELECT COUNT(*) FROM campaign_match_grant_activity a
                  WHERE a.match_grant_id = cmg.id) AS times_used
           FROM campaign_match_grants cmg
           LEFT JOIN users u ON u.id = cmg.donor_user_id
          ORDER BY cmg.created_at DESC`,
      ),
      projectPendingTotalsForAllGrants(),
    ]);

    const grants = await Promise.all(
      grantsResult.rows.map(async (g: any) => {
        const campResult = await pool.query(
          `SELECT c.id, c.name
             FROM campaign_match_grant_campaigns cmgc
             JOIN campaigns c ON c.id = cmgc.campaign_id
            WHERE cmgc.match_grant_id = $1
            ORDER BY c.name`,
          [g.id],
        );
        const pending = pendingTotals[g.id] || { pendingAmount: 0, pendingCount: 0 };
        return {
          id: g.id,
          name: g.name || "",
          donorUserId: g.donor_user_id,
          donorEmail: g.donor_email || "",
          donorFullName: (g.donor_full_name || "").trim() || g.donor_user_name || "",
          donorBalance: parseFloat(g.donor_balance) || 0,
          totalCap: g.total_cap != null ? parseFloat(g.total_cap) : null,
          amountUsed: parseFloat(g.amount_used) || 0,
          reservedAmount: parseFloat(g.reserved_amount) || 0,
          matchType: g.match_type || "full",
          perInvestmentCap: g.per_investment_cap != null ? parseFloat(g.per_investment_cap) : null,
          isActive: g.is_active,
          notes: g.notes || "",
          expiresAt: g.expires_at || null,
          retroactiveFrom: g.retroactive_from || null,
          createdAt: g.created_at,
          updatedAt: g.updated_at,
          timesUsed: parseInt(g.times_used) || 0,
          pendingAmount: pending.pendingAmount,
          pendingCount: pending.pendingCount,
          campaigns: campResult.rows.map((c: any) => ({ id: c.id, name: c.name })),
        };
      }),
    );

    res.json({ success: true, items: grants });
  } catch (err: any) {
    console.error("Error listing match grants:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/matching/:id/activity
// ------------------------------------------------------------------ //
router.get("/:id/activity", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid id" });
      return;
    }
    const [result, projections] = await Promise.all([
      pool.query(
        `SELECT a.id, a.amount, a.created_at,
                c.name   AS campaign_name,
                CONCAT(iu.first_name, ' ', iu.last_name) AS investor_full_name,
                iu.email AS investor_email,
                a.triggered_by_recommendation_id,
                a.donor_recommendation_id
           FROM campaign_match_grant_activity a
           LEFT JOIN campaigns c ON c.id = a.campaign_id
           LEFT JOIN users iu ON iu.id = a.triggered_by_user_id
          WHERE a.match_grant_id = $1
          ORDER BY a.created_at DESC
          LIMIT 500`,
        [id],
      ),
      projectPendingMatchesForGrant(id),
    ]);
    res.json({
      success: true,
      items: result.rows.map((r: any) => ({
        id: r.id,
        amount: parseFloat(r.amount) || 0,
        createdAt: r.created_at,
        campaignName: r.campaign_name || "",
        investorFullName: (r.investor_full_name || "").trim(),
        investorEmail: r.investor_email || "",
        triggeringRecommendationId: r.triggered_by_recommendation_id,
        donorRecommendationId: r.donor_recommendation_id,
      })),
      pendingItems: projections.map((p, idx) => ({
        id: `pending-${id}-${idx}`,
        amount: p.projectedAmount,
        triggerDate: p.trigger.triggerDate,
        campaignName: p.trigger.campaignName,
        investorFullName: p.trigger.triggerName,
        investorEmail: p.trigger.triggerEmail,
        triggerType: p.trigger.triggerType,
        triggerStatus: p.trigger.triggerStatus,
        triggerAmount: p.trigger.triggerAmount,
      })),
      pendingTotal: Math.round(projections.reduce((s, p) => s + p.projectedAmount, 0) * 100) / 100,
    });
  } catch (err: any) {
    console.error("Error fetching match grant activity:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/matching/donor-search?q=...
// ------------------------------------------------------------------ //
router.get("/donor-search", async (req: Request, res: Response) => {
  try {
    const q = (String(req.query.q || "")).trim();
    if (q.length < 2) {
      res.json({ success: true, items: [] });
      return;
    }
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, user_name, account_balance
         FROM users
        WHERE (is_deleted IS NULL OR is_deleted = false)
          AND (
               email ILIKE $1
            OR first_name ILIKE $1
            OR last_name ILIKE $1
            OR user_name ILIKE $1
            OR CONCAT(first_name, ' ', last_name) ILIKE $1
          )
        ORDER BY first_name, last_name
        LIMIT 20`,
      [`%${q}%`],
    );
    res.json({
      success: true,
      items: result.rows.map((u: any) => ({
        id: u.id,
        email: u.email,
        fullName: `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.user_name || u.email,
        accountBalance: parseFloat(u.account_balance) || 0,
      })),
    });
  } catch (err: any) {
    console.error("Error searching donors:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// POST /api/admin/matching  — create grant + reserve funds
// ------------------------------------------------------------------ //
router.post("/", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};

    if (!b.donorUserId) {
      res.status(400).json({ success: false, message: "donorUserId is required." });
      return;
    }
    if (!Array.isArray(b.campaignIds) || b.campaignIds.length === 0) {
      res.status(400).json({ success: false, message: "At least one campaign is required." });
      return;
    }

    const matchType: string = b.matchType === "capped" ? "capped" : "full";
    const totalCap =
      b.totalCap != null && b.totalCap !== "" ? parseFloat(String(b.totalCap)) : null;
    const perInvestmentCap =
      matchType === "capped" && b.perInvestmentCap != null && b.perInvestmentCap !== ""
        ? parseFloat(String(b.perInvestmentCap))
        : null;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    const retroactiveFrom = b.retroactiveFrom ? new Date(b.retroactiveFrom) : null;
    const grantName = (b.name || "").trim();

    await client.query("BEGIN");

    // Insert grant (reserved_amount will be updated below if cap is set)
    const grantResult = await client.query(
      `INSERT INTO campaign_match_grants
         (name, donor_user_id, total_cap, match_type, per_investment_cap,
          is_active, notes, expires_at, retroactive_from, reserved_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
       RETURNING id`,
      [
        grantName,
        b.donorUserId,
        totalCap,
        matchType,
        perInvestmentCap,
        b.isActive !== false,
        (b.notes || "").trim() || null,
        expiresAt,
        retroactiveFrom,
      ],
    );
    const grantId = grantResult.rows[0].id;

    // Add campaign links
    const campaignIds: number[] = b.campaignIds
      .map((id: any) => parseInt(String(id), 10))
      .filter((n: number) => !isNaN(n));
    for (const campaignId of campaignIds) {
      await client.query(
        `INSERT INTO campaign_match_grant_campaigns (match_grant_id, campaign_id)
         VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT campaign_match_grant_campaigns_unique DO NOTHING`,
        [grantId, campaignId],
      );
    }

    // Reserve funds from donor wallet if a cap is set
    if (totalCap != null && totalCap > 0 && b.isActive !== false) {
      await reserveCapFromWallet(client, b.donorUserId, totalCap, grantName || `Grant #${grantId}`);
      await client.query(
        `UPDATE campaign_match_grants SET reserved_amount = $1 WHERE id = $2`,
        [totalCap, grantId],
      );
    }

    await client.query("COMMIT");

    // Run retroactive sweep AFTER commit so that the grant + campaign links
    // are visible to the sweep query and any errors don't roll back the grant.
    let retroSummary = { matched: 0, totalAmount: 0, scanned: 0, skipped: 0 };
    if (retroactiveFrom && b.isActive !== false) {
      retroSummary = await runRetroactiveSweep(grantId);
    }

    res.json({
      success: true,
      message: "Match grant created.",
      id: grantId,
      retroactive: retroSummary,
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error creating match grant:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// PUT /api/admin/matching/:id  — update grant, adjust reservation
// ------------------------------------------------------------------ //
router.put("/:id", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid id" });
      return;
    }

    const b = req.body || {};
    const matchType: string = b.matchType === "capped" ? "capped" : "full";
    const newCap =
      b.totalCap != null && b.totalCap !== "" ? parseFloat(String(b.totalCap)) : null;
    const perInvestmentCap =
      matchType === "capped" && b.perInvestmentCap != null && b.perInvestmentCap !== ""
        ? parseFloat(String(b.perInvestmentCap))
        : null;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    const retroactiveFrom = b.retroactiveFrom ? new Date(b.retroactiveFrom) : null;
    const grantName = (b.name || "").trim();

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, donor_user_id, reserved_amount, amount_used, name, total_cap, retroactive_from
         FROM campaign_match_grants WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ success: false, message: "Match grant not found." });
      return;
    }

    const g = existing.rows[0];
    const oldReserved = parseFloat(g.reserved_amount) || 0;
    const amountUsed = parseFloat(g.amount_used) || 0;
    const newCapVal = newCap ?? 0;

    // Validate new cap doesn't go below what's already matched
    if (newCap != null && newCap < amountUsed) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: `Cap cannot be set below amount already matched ($${amountUsed.toFixed(2)}).`,
      });
      return;
    }

    // ── Reservation adjustment ────────────────────────────────────
    // The donor's wallet has historically been debited `oldReserved` for
    // this grant. The `amountUsed` portion has already been disbursed as
    // matches and CANNOT be returned to the donor. Only the prospective
    // (unused) portion is mobile.
    //
    // newCommitted = the amount this grant must keep locked AFTER the edit
    //   - active + capped:    max(amountUsed, newCap)
    //   - paused / unlimited: amountUsed    (we can never release used funds)
    const donorChanged =
      b.donorUserId && b.donorUserId !== g.donor_user_id;
    const grantLabel = grantName || g.name || `Grant #${id}`;
    const isActiveAfter = b.isActive !== false;
    const newCommitted =
      newCap != null && newCap > 0 && isActiveAfter
        ? Math.max(amountUsed, newCap)
        : amountUsed;

    if (donorChanged) {
      // Donor change: refund ALL prospective (unused) to old donor; new
      // donor reserves the prospective portion only (they are not on the
      // hook for matches the old donor already funded).
      if (oldReserved > amountUsed) {
        await returnUnusedFunds(
          client,
          g.donor_user_id,
          oldReserved,
          amountUsed,
          grantLabel,
        );
      }
      const newDonorReservation = Math.max(0, newCommitted - amountUsed);
      if (newDonorReservation > 0) {
        await reserveCapFromWallet(
          client,
          b.donorUserId,
          newDonorReservation,
          grantLabel,
        );
      }
    } else {
      // Same donor: apply the net delta only.
      const delta = newCommitted - oldReserved;
      if (delta > 0) {
        await reserveCapFromWallet(client, g.donor_user_id, delta, grantLabel);
      } else if (delta < 0) {
        await returnUnusedFunds(client, g.donor_user_id, -delta, 0, grantLabel);
      }
    }

    await client.query(
      `UPDATE campaign_match_grants
          SET name               = $1,
              donor_user_id      = $2,
              total_cap          = $3,
              match_type         = $4,
              per_investment_cap = $5,
              is_active          = $6,
              notes              = $7,
              expires_at         = $8,
              retroactive_from   = $9,
              reserved_amount    = $10,
              updated_at         = NOW()
        WHERE id = $11`,
      [
        grantName,
        b.donorUserId || g.donor_user_id,
        newCap,
        matchType,
        perInvestmentCap,
        b.isActive !== false,
        (b.notes || "").trim() || null,
        expiresAt,
        retroactiveFrom,
        newCommitted,
        id,
      ],
    );

    // Replace campaign list
    if (Array.isArray(b.campaignIds)) {
      await client.query(
        `DELETE FROM campaign_match_grant_campaigns WHERE match_grant_id = $1`,
        [id],
      );
      const campaignIds: number[] = b.campaignIds
        .map((cid: any) => parseInt(String(cid), 10))
        .filter((n: number) => !isNaN(n));
      for (const campaignId of campaignIds) {
        await client.query(
          `INSERT INTO campaign_match_grant_campaigns (match_grant_id, campaign_id)
           VALUES ($1, $2)
           ON CONFLICT ON CONSTRAINT campaign_match_grant_campaigns_unique DO NOTHING`,
          [id, campaignId],
        );
      }
    }

    await client.query("COMMIT");

    // If retroactive_from is set (or was changed), run a sweep. The sweep
    // itself dedups via the unique index, so re-running on edit is safe and
    // will only pick up newly eligible recommendations (e.g. campaigns added
    // to the grant on this edit, or recs created since the last sweep).
    let retroSummary = { matched: 0, totalAmount: 0, scanned: 0, skipped: 0 };
    if (retroactiveFrom && b.isActive !== false) {
      retroSummary = await runRetroactiveSweep(id);
    }

    res.json({
      success: true,
      message: "Match grant updated.",
      retroactive: retroSummary,
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating match grant:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// DELETE /api/admin/matching/:id  — return unused funds then delete
// ------------------------------------------------------------------ //
router.delete("/:id", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid id" });
      return;
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, donor_user_id, reserved_amount, amount_used, name
         FROM campaign_match_grants WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ success: false, message: "Match grant not found." });
      return;
    }

    const g = existing.rows[0];
    const reserved = parseFloat(g.reserved_amount) || 0;
    const used = parseFloat(g.amount_used) || 0;

    // Return unused reserved funds to donor
    const refunded = await returnUnusedFunds(
      client,
      g.donor_user_id,
      reserved,
      used,
      g.name || `Grant #${id}`,
    );

    await client.query(`DELETE FROM campaign_match_grants WHERE id = $1`, [id]);

    await client.query("COMMIT");
    res.json({
      success: true,
      message: "Match grant deleted." + (refunded > 0 ? ` $${refunded.toFixed(2)} returned to donor.` : ""),
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error deleting match grant:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/matching/:id/export — per-grant Excel report
// ------------------------------------------------------------------ //
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid id" });
      return;
    }

    // Grant header
    const grantRes = await pool.query(
      `SELECT cmg.id, cmg.name, cmg.total_cap, cmg.amount_used, cmg.reserved_amount,
              cmg.match_type, cmg.per_investment_cap, cmg.is_active, cmg.notes,
              cmg.expires_at, cmg.retroactive_from, cmg.created_at, cmg.updated_at,
              u.email AS donor_email,
              CONCAT(u.first_name, ' ', u.last_name) AS donor_full_name,
              u.user_name AS donor_user_name
         FROM campaign_match_grants cmg
         LEFT JOIN users u ON u.id = cmg.donor_user_id
        WHERE cmg.id = $1`,
      [id],
    );
    if (grantRes.rows.length === 0) {
      res.status(404).json({ success: false, message: "Match grant not found." });
      return;
    }
    const g = grantRes.rows[0];

    // Eligible campaigns
    const campsRes = await pool.query(
      `SELECT c.name
         FROM campaign_match_grant_campaigns cmgc
         JOIN campaigns c ON c.id = cmgc.campaign_id
        WHERE cmgc.match_grant_id = $1
        ORDER BY c.name`,
      [id],
    );

    // Activity rows: each match this grant has applied, with the original
    // investment amount from the triggering recommendation.
    const activityRes = await pool.query(
      `SELECT a.id, a.amount AS match_amount, a.created_at,
              c.name AS campaign_name,
              CONCAT(iu.first_name, ' ', iu.last_name) AS investor_full_name,
              iu.email AS investor_email,
              iu.user_name AS investor_user_name,
              tr.amount AS investment_amount,
              tr.date_created AS investment_date,
              tr.status AS investment_status,
              dr.status AS donor_rec_status,
              a.triggered_by_recommendation_id,
              a.donor_recommendation_id
         FROM campaign_match_grant_activity a
         LEFT JOIN campaigns c ON c.id = a.campaign_id
         LEFT JOIN users iu ON iu.id = a.triggered_by_user_id
         LEFT JOIN recommendations tr ON tr.id = a.triggered_by_recommendation_id
         LEFT JOIN recommendations dr ON dr.id = a.donor_recommendation_id
        WHERE a.match_grant_id = $1
        ORDER BY a.created_at ASC, a.id ASC`,
      [id],
    );

    const totalCap = g.total_cap != null ? parseFloat(g.total_cap) : null;
    const amountUsed = parseFloat(g.amount_used) || 0;
    const reserved = parseFloat(g.reserved_amount) || 0;
    const remaining =
      totalCap != null
        ? Math.max(0, totalCap - amountUsed)
        : reserved > 0
          ? Math.max(0, reserved - amountUsed)
          : null;
    const totalInvestmentMatched = activityRes.rows.reduce(
      (s: number, r: any) => s + (parseFloat(r.investment_amount) || 0),
      0,
    );

    const grantName = (g.name || `Grant #${id}`).trim() || `Grant #${id}`;
    const donorName =
      (g.donor_full_name || "").trim() ||
      g.donor_user_name ||
      g.donor_email ||
      "";

    // ── Build workbook ────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CataCap Admin";
    workbook.created = new Date();

    // -- Sheet 1: Summary --
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { key: "label", width: 28 },
      { key: "value", width: 60 },
    ];
    const addRow = (label: string, value: any, fmt?: string) => {
      const r = summary.addRow([label, value]);
      r.getCell(1).font = { bold: true };
      if (fmt) r.getCell(2).numFmt = fmt;
    };
    summary.addRow(["Match Grant Report"]).getCell(1).font = { bold: true, size: 14 };
    summary.addRow([]);
    addRow("Grant Name", grantName);
    addRow("Status", g.is_active ? "Active" : "Inactive");
    addRow("Donor", donorName);
    addRow("Donor Email", g.donor_email || "");
    addRow("Match Type", g.match_type === "capped" ? "Capped per investment" : "1:1 Full match");
    if (g.match_type === "capped" && g.per_investment_cap != null) {
      addRow("Per-Investment Cap", parseFloat(g.per_investment_cap), "$#,##0.00");
    }
    addRow("Total Funds Allocated (Cap)", totalCap != null ? totalCap : "Unlimited",
      totalCap != null ? "$#,##0.00" : undefined);
    if (reserved > 0) addRow("Reserved in Escrow", reserved, "$#,##0.00");
    addRow("Total Matched So Far", amountUsed, "$#,##0.00");
    if (remaining != null) addRow("Remaining Available", remaining, "$#,##0.00");
    addRow("Number of Investments Matched", activityRes.rows.length);
    addRow("Total Investment Amount Matched", totalInvestmentMatched, "$#,##0.00");
    if (g.expires_at) addRow("Expires", new Date(g.expires_at), "MM/dd/yyyy");
    if (g.retroactive_from) addRow("Retroactive From", new Date(g.retroactive_from), "MM/dd/yyyy");
    addRow("Created", new Date(g.created_at), "MM/dd/yy HH:mm");
    addRow("Updated", new Date(g.updated_at), "MM/dd/yy HH:mm");
    if (g.notes) addRow("Notes", g.notes);
    summary.addRow([]);
    addRow("Eligible Campaigns", campsRes.rows.map((c: any) => c.name).join(", ") || "(none)");

    // -- Sheet 2: Matched Investments --
    const detail = workbook.addWorksheet("Matched Investments");
    const headers = [
      "Date Matched",
      "Investor Name",
      "Investor Email",
      "Campaign",
      "Investment Amount",
      "Match Amount",
      "Investment Status",
      "Match Rec Status",
      "Investment Rec ID",
      "Donor Rec ID",
    ];
    const headerRow = detail.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "left" };
    });

    for (const r of activityRes.rows) {
      const investorName =
        (r.investor_full_name || "").trim() || r.investor_user_name || "";
      const investAmt = r.investment_amount != null ? parseFloat(r.investment_amount) : null;
      const matchAmt = r.match_amount != null ? parseFloat(r.match_amount) : null;
      const dataRow = detail.addRow([
        r.created_at ? new Date(r.created_at) : null,
        investorName,
        r.investor_email || "",
        r.campaign_name || "",
        investAmt,
        matchAmt,
        r.investment_status || "",
        r.donor_rec_status || "",
        r.triggered_by_recommendation_id ?? "",
        r.donor_recommendation_id ?? "",
      ]);
      if (r.created_at) dataRow.getCell(1).numFmt = "MM/dd/yy HH:mm";
      if (investAmt != null) dataRow.getCell(5).numFmt = "$#,##0.00";
      if (matchAmt != null) dataRow.getCell(6).numFmt = "$#,##0.00";
    }

    // Totals row
    if (activityRes.rows.length > 0) {
      const totalsRow = detail.addRow([
        "",
        "",
        "",
        "TOTAL",
        totalInvestmentMatched,
        amountUsed,
        "",
        "",
        "",
        "",
      ]);
      totalsRow.eachCell((cell) => { cell.font = { bold: true }; });
      totalsRow.getCell(5).numFmt = "$#,##0.00";
      totalsRow.getCell(6).numFmt = "$#,##0.00";
    }

    detail.columns.forEach((col) => {
      col.alignment = { horizontal: "left" };
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 50);
    });

    const safeName = grantName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=MatchGrant_${safeName}_${dateStamp}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting match grant:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
