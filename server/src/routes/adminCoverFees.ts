import { Router } from "express";
import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import pool from "../db.js";
import {
  COVER_FEE_RATE,
  fetchHeldTotalsByPool,
  reconcilePendingHoldsForAllPools,
} from "../utils/coverFees.js";
import {
  projectPendingCoverFeesForPool,
  projectPendingCoverFeeTotalsForAllPools,
} from "../utils/pendingCoverFees.js";

const router = Router();

// ------------------------------------------------------------------ //
// Helpers (mirror reserveCapFromWallet / returnUnusedFunds in adminMatching)
// ------------------------------------------------------------------ //
async function reserveCapFromWallet(
  client: any,
  sponsorUserId: string,
  capAmount: number,
  poolName: string,
): Promise<{ oldBalance: number; newBalance: number }> {
  const sponsorRes = await client.query(
    `SELECT account_balance, user_name, email FROM users WHERE id = $1 FOR UPDATE`,
    [sponsorUserId],
  );
  if (sponsorRes.rows.length === 0) throw new Error("Sponsor user not found.");

  const oldBalance = parseFloat(sponsorRes.rows[0].account_balance) || 0;
  if (oldBalance < capAmount) {
    throw new Error(
      `Sponsor balance (${oldBalance.toFixed(2)}) is insufficient for the requested pool (${capAmount.toFixed(2)}).`,
    );
  }
  const newBalance = parseFloat((oldBalance - capAmount).toFixed(2));

  await client.query(
    `UPDATE users SET account_balance = $1 WHERE id = $2`,
    [newBalance, sponsorUserId],
  );
  await client.query(
    `INSERT INTO account_balance_change_logs
       (user_id, payment_type, investment_name, old_value, user_name, new_value,
        change_date, gross_amount, fees, net_amount)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)`,
    [
      sponsorUserId,
      `Funds Assigned to Cover Fees Pool for ${poolName || "Cover Fees pool"}`,
      "-",
      oldBalance,
      sponsorRes.rows[0].user_name || sponsorRes.rows[0].email || "",
      newBalance,
      capAmount,
      0,
      capAmount,
    ],
  );

  return { oldBalance, newBalance };
}

async function returnUnusedFunds(
  client: any,
  sponsorUserId: string,
  reservedAmount: number,
  amountUsed: number,
  poolName: string,
): Promise<number> {
  const refund = Math.max(0, Math.round((reservedAmount - amountUsed) * 100) / 100);
  if (refund <= 0) return 0;

  const sponsorRes = await client.query(
    `SELECT account_balance, user_name, email FROM users WHERE id = $1 FOR UPDATE`,
    [sponsorUserId],
  );
  if (sponsorRes.rows.length === 0) return 0;

  const oldBalance = parseFloat(sponsorRes.rows[0].account_balance) || 0;
  const newBalance = parseFloat((oldBalance + refund).toFixed(2));

  await client.query(`UPDATE users SET account_balance = $1 WHERE id = $2`, [
    newBalance,
    sponsorUserId,
  ]);
  await client.query(
    `INSERT INTO account_balance_change_logs
       (user_id, payment_type, investment_name, old_value, user_name, new_value,
        change_date, gross_amount, fees, net_amount)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)`,
    [
      sponsorUserId,
      `Unused Funds Returned from Cover Fees Pool for ${poolName || "Cover Fees pool"}`,
      "-",
      oldBalance,
      sponsorRes.rows[0].user_name || sponsorRes.rows[0].email || "",
      newBalance,
      refund,
      0,
      refund,
    ],
  );

  return refund;
}

// ------------------------------------------------------------------ //
// GET /api/admin/cover-fees
// ------------------------------------------------------------------ //
router.get("/", async (_req: Request, res: Response) => {
  try {
    // The Node server does not own the create path for pending_grants /
    // asset_based_payment_requests (legacy .NET backend creates them).
    // Materialize 'held' rows for any still-Pending requests that don't
    // yet have one so the admin's "On Hold" / "Remaining" readouts
    // reflect reality. Bounded and idempotent.
    try {
      await reconcilePendingHoldsForAllPools();
    } catch (reconcileErr: any) {
      console.error("reconcilePendingHoldsForAllPools failed:", reconcileErr?.message || reconcileErr);
    }

    const [poolsResult, pendingTotals, heldTotals] = await Promise.all([
      pool.query(
        `SELECT ccf.id,
                ccf.name,
                ccf.display_sponsor_name,
                ccf.sponsor_user_id,
                u.email          AS sponsor_email,
                CONCAT(u.first_name, ' ', u.last_name) AS sponsor_full_name,
                u.user_name      AS sponsor_user_name,
                u.account_balance AS sponsor_balance,
                ccf.total_cap,
                ccf.amount_used,
                ccf.reserved_amount,
                ccf.fee_rate,
                ccf.per_investment_cap,
                ccf.cover_initial_fee,
                ccf.cover_lifecycle_fee,
                ccf.is_active,
                ccf.notes,
                ccf.expires_at,
                ccf.created_at,
                ccf.updated_at,
                (SELECT COUNT(*) FROM campaign_cover_fees_activity a
                  WHERE a.cover_fee_id = ccf.id) AS times_used
           FROM campaign_cover_fees ccf
           LEFT JOIN users u ON u.id = ccf.sponsor_user_id
          ORDER BY ccf.created_at DESC`,
      ),
      projectPendingCoverFeeTotalsForAllPools(),
      fetchHeldTotalsByPool(),
    ]);

    const items = await Promise.all(
      poolsResult.rows.map(async (g: any) => {
        const campResult = await pool.query(
          `SELECT c.id, c.name
             FROM campaign_cover_fees_campaigns ccfc
             JOIN campaigns c ON c.id = ccfc.campaign_id
            WHERE ccfc.cover_fee_id = $1
            ORDER BY c.name`,
          [g.id],
        );
        const pending = pendingTotals[g.id] || { pendingAmount: 0, pendingCount: 0 };
        const held = heldTotals[g.id] || { heldAmount: 0, heldCount: 0 };
        return {
          id: g.id,
          name: g.name || "",
          displaySponsorName: g.display_sponsor_name || "",
          sponsorUserId: g.sponsor_user_id,
          sponsorEmail: g.sponsor_email || "",
          sponsorFullName:
            (g.sponsor_full_name || "").trim() || g.sponsor_user_name || "",
          sponsorBalance: parseFloat(g.sponsor_balance) || 0,
          totalCap: g.total_cap != null ? parseFloat(g.total_cap) : null,
          amountUsed: parseFloat(g.amount_used) || 0,
          reservedAmount: parseFloat(g.reserved_amount) || 0,
          feeRate: g.fee_rate != null ? parseFloat(g.fee_rate) : COVER_FEE_RATE,
          perInvestmentCap:
            g.per_investment_cap != null ? parseFloat(g.per_investment_cap) : null,
          coverInitialFee: g.cover_initial_fee !== false,
          coverLifecycleFee: g.cover_lifecycle_fee !== false,
          isActive: g.is_active,
          notes: g.notes || "",
          expiresAt: g.expires_at || null,
          createdAt: g.created_at,
          updatedAt: g.updated_at,
          timesUsed: parseInt(g.times_used) || 0,
          pendingAmount: pending.pendingAmount,
          pendingCount: pending.pendingCount,
          heldAmount: held.heldAmount,
          heldCount: held.heldCount,
          campaigns: campResult.rows.map((c: any) => ({ id: c.id, name: c.name })),
        };
      }),
    );

    res.json({ success: true, items });
  } catch (err: any) {
    console.error("Error listing cover-fees pools:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/cover-fees/:id/activity
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
        `SELECT a.id, a.fee_amount, a.donation_amount, a.created_at,
                c.name   AS campaign_name,
                CONCAT(iu.first_name, ' ', iu.last_name) AS investor_full_name,
                iu.email AS investor_email,
                a.triggered_by_recommendation_id,
                COALESCE(tpg.status, tr.status) AS trigger_status,
                tr.amount     AS trigger_amount,
                CASE
                  WHEN tr.pending_grants_id IS NOT NULL
                       AND LOWER(TRIM(COALESCE(tpg.daf_provider, ''))) = 'foundation grant'
                    THEN 'Foundation'
                  WHEN tr.pending_grants_id IS NOT NULL THEN 'DAF Grant'
                  ELSE NULL
                END AS trigger_payment_type,
                CASE
                  WHEN tr.pending_grants_id IS NOT NULL
                       AND LOWER(TRIM(COALESCE(tpg.daf_provider, ''))) = 'foundation grant'
                    THEN tpg.created_date
                  ELSE tr.date_created
                END AS trigger_date
                ,
                a.fully_reversed_at,
                a.reversed_fee_amount,
                a.last_reversed_reason
           FROM campaign_cover_fees_activity a
           LEFT JOIN campaigns c ON c.id = a.campaign_id
           LEFT JOIN users iu ON iu.id = a.triggered_by_user_id
           LEFT JOIN recommendations tr ON tr.id = a.triggered_by_recommendation_id
           LEFT JOIN pending_grants tpg ON tpg.id = tr.pending_grants_id
          WHERE a.cover_fee_id = $1
          ORDER BY a.created_at DESC
          LIMIT 500`,
        [id],
      ),
      projectPendingCoverFeesForPool(id),
    ]);
    res.json({
      success: true,
      items: result.rows.map((r: any) => ({
        id: r.id,
        amount: parseFloat(r.fee_amount) || 0,
        donationAmount: parseFloat(r.donation_amount) || 0,
        createdAt: r.created_at,
        campaignName: r.campaign_name || "",
        investorFullName: (r.investor_full_name || "").trim(),
        investorEmail: r.investor_email || "",
        triggeringRecommendationId: r.triggered_by_recommendation_id,
        triggerStatus: r.trigger_status || "",
        triggerAmount: r.trigger_amount != null ? parseFloat(r.trigger_amount) : null,
        triggerPaymentType: r.trigger_payment_type || "",
        triggerDate: r.trigger_date || null,
        reversed: r.fully_reversed_at != null,
        reversedAt: r.fully_reversed_at || null,
        reversedAmount: parseFloat(r.reversed_fee_amount) || 0,
        reversedReason: r.last_reversed_reason || null,
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
      pendingTotal:
        Math.round(projections.reduce((s, p) => s + p.projectedAmount, 0) * 100) / 100,
    });
  } catch (err: any) {
    console.error("Error fetching cover-fees activity:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/cover-fees/sponsor-search?q=... (alias: /donor-search
// for parity with the matching API contract)
// ------------------------------------------------------------------ //
async function handleSponsorSearch(req: Request, res: Response) {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      res.json({ success: true, items: [] });
      return;
    }
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, user_name, account_balance
         FROM users
        WHERE (is_deleted IS NULL OR is_deleted = false)
          AND (
               email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
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
        fullName:
          `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
          u.user_name || u.email,
        accountBalance: parseFloat(u.account_balance) || 0,
      })),
    });
  } catch (err: any) {
    console.error("Error searching sponsors:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}
router.get("/sponsor-search", handleSponsorSearch);
router.get("/donor-search", handleSponsorSearch);

// ------------------------------------------------------------------ //
// POST /api/admin/cover-fees  — create pool + reserve funds
// ------------------------------------------------------------------ //
router.post("/", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};

    if (!b.sponsorUserId) {
      res.status(400).json({ success: false, message: "sponsorUserId is required." });
      return;
    }
    if (!Array.isArray(b.campaignIds) || b.campaignIds.length === 0) {
      res.status(400).json({ success: false, message: "At least one campaign is required." });
      return;
    }

    const totalCap =
      b.totalCap != null && b.totalCap !== "" ? parseFloat(String(b.totalCap)) : null;
    const perInvestmentCap =
      b.perInvestmentCap != null && b.perInvestmentCap !== ""
        ? parseFloat(String(b.perInvestmentCap))
        : null;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    const poolName = (b.name || "").trim();
    const feeRate = COVER_FEE_RATE;

    await client.query("BEGIN");

    const coverInitialFee = b.coverInitialFee !== false;
    const coverLifecycleFee = b.coverLifecycleFee !== false;
    if (!coverInitialFee && !coverLifecycleFee) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: "At least one of \"cover initial fee\" or \"cover fee during life of investment\" must be enabled.",
      });
      return;
    }

    const insertResult = await client.query(
      `INSERT INTO campaign_cover_fees
         (name, sponsor_user_id, total_cap, fee_rate, per_investment_cap,
          is_active, notes, expires_at, reserved_amount,
          cover_initial_fee, cover_lifecycle_fee, coverage_active_from,
          display_sponsor_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, NOW(), $11)
       RETURNING id`,
      [
        poolName,
        b.sponsorUserId,
        totalCap,
        feeRate,
        perInvestmentCap,
        b.isActive !== false,
        (b.notes || "").trim() || null,
        expiresAt,
        coverInitialFee,
        coverLifecycleFee,
        (b.displaySponsorName || "").trim() || null,
      ],
    );
    const poolId = insertResult.rows[0].id;

    const campaignIds: number[] = b.campaignIds
      .map((id: any) => parseInt(String(id), 10))
      .filter((n: number) => !isNaN(n));
    for (const campaignId of campaignIds) {
      await client.query(
        `INSERT INTO campaign_cover_fees_campaigns (cover_fee_id, campaign_id)
         VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT campaign_cover_fees_campaigns_unique DO NOTHING`,
        [poolId, campaignId],
      );
    }

    if (totalCap != null && totalCap > 0 && b.isActive !== false) {
      await reserveCapFromWallet(
        client,
        b.sponsorUserId,
        totalCap,
        poolName || `Cover Fees pool #${poolId}`,
      );
      await client.query(
        `UPDATE campaign_cover_fees SET reserved_amount = $1 WHERE id = $2`,
        [totalCap, poolId],
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Cover Fees pool created.",
      id: poolId,
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error creating cover-fees pool:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// PUT /api/admin/cover-fees/:id  — update pool, adjust reservation
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
    const newCap =
      b.totalCap != null && b.totalCap !== "" ? parseFloat(String(b.totalCap)) : null;
    const perInvestmentCap =
      b.perInvestmentCap != null && b.perInvestmentCap !== ""
        ? parseFloat(String(b.perInvestmentCap))
        : null;
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    const poolName = (b.name || "").trim();

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, sponsor_user_id, reserved_amount, amount_used, name, total_cap
         FROM campaign_cover_fees WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ success: false, message: "Cover Fees pool not found." });
      return;
    }

    const g = existing.rows[0];
    const oldReserved = parseFloat(g.reserved_amount) || 0;
    const amountUsed = parseFloat(g.amount_used) || 0;

    // Hold-aware floor: outstanding 'held' escrow counts against the
    // pool's committed funds. We must never let the admin set the cap
    // below (amount_used + held_sum), refund held money to the sponsor,
    // or change sponsor while holds are outstanding — any of those
    // would leave pending donations referencing escrow that no longer
    // exists.
    const heldSumRes = await client.query(
      `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS s
         FROM campaign_cover_fees_activity
        WHERE cover_fee_id = $1
          AND status = 'held'
          AND fully_reversed_at IS NULL`,
      [id],
    );
    const heldSum = parseFloat(heldSumRes.rows[0]?.s || "0") || 0;
    const committedFloor = parseFloat((amountUsed + heldSum).toFixed(2));

    if (newCap != null && newCap < committedFloor) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message:
          heldSum > 0
            ? `Cap cannot be set below committed funds ($${committedFloor.toFixed(2)} = $${amountUsed.toFixed(2)} covered + $${heldSum.toFixed(2)} on hold).`
            : `Cap cannot be set below amount already covered ($${amountUsed.toFixed(2)}).`,
      });
      return;
    }

    const sponsorChanged =
      b.sponsorUserId && b.sponsorUserId !== g.sponsor_user_id;
    if (sponsorChanged && heldSum > 0) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: `Cannot change sponsor while $${heldSum.toFixed(2)} of cover-fee escrow is on hold for pending donations. Release the holds (reject the pending requests) and try again.`,
      });
      return;
    }
    const poolLabel = poolName || g.name || `Cover Fees pool #${id}`;
    const isActiveAfter = b.isActive !== false;
    const newCommitted =
      newCap != null && newCap > 0 && isActiveAfter
        ? Math.max(committedFloor, newCap)
        : committedFloor;

    if (sponsorChanged) {
      // Refund only the truly-unused portion to the old sponsor
      // (reserved - used - held); held would have short-circuited
      // above if > 0 so this is equivalent to reserved - used today,
      // but we keep the formula hold-aware for clarity.
      if (oldReserved > committedFloor) {
        await returnUnusedFunds(
          client,
          g.sponsor_user_id,
          oldReserved,
          committedFloor,
          poolLabel,
        );
      }
      const newSponsorReservation = Math.max(0, newCommitted - committedFloor);
      if (newSponsorReservation > 0) {
        await reserveCapFromWallet(client, b.sponsorUserId, newSponsorReservation, poolLabel);
      }
    } else {
      const delta = newCommitted - oldReserved;
      if (delta > 0) {
        await reserveCapFromWallet(client, g.sponsor_user_id, delta, poolLabel);
      } else if (delta < 0) {
        await returnUnusedFunds(client, g.sponsor_user_id, -delta, 0, poolLabel);
      }
    }

    const coverInitialFee = b.coverInitialFee !== false;
    const coverLifecycleFee = b.coverLifecycleFee !== false;
    if (!coverInitialFee && !coverLifecycleFee) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: "At least one of \"cover initial fee\" or \"cover fee during life of investment\" must be enabled.",
      });
      return;
    }

    await client.query(
      `UPDATE campaign_cover_fees
          SET name                 = $1,
              sponsor_user_id      = $2,
              total_cap            = $3,
              per_investment_cap   = $4,
              is_active            = $5,
              notes                = $6,
              expires_at           = $7,
              reserved_amount      = $8,
              cover_initial_fee    = $10,
              cover_lifecycle_fee  = $11,
              display_sponsor_name = $12,
              updated_at           = NOW()
        WHERE id = $9`,
      [
        poolName,
        b.sponsorUserId || g.sponsor_user_id,
        newCap,
        perInvestmentCap,
        b.isActive !== false,
        (b.notes || "").trim() || null,
        expiresAt,
        newCommitted,
        id,
        coverInitialFee,
        coverLifecycleFee,
        (b.displaySponsorName || "").trim() || null,
      ],
    );

    if (Array.isArray(b.campaignIds)) {
      await client.query(
        `DELETE FROM campaign_cover_fees_campaigns WHERE cover_fee_id = $1`,
        [id],
      );
      const campaignIds: number[] = b.campaignIds
        .map((cid: any) => parseInt(String(cid), 10))
        .filter((n: number) => !isNaN(n));
      for (const campaignId of campaignIds) {
        await client.query(
          `INSERT INTO campaign_cover_fees_campaigns (cover_fee_id, campaign_id)
           VALUES ($1, $2)
           ON CONFLICT ON CONSTRAINT campaign_cover_fees_campaigns_unique DO NOTHING`,
          [id, campaignId],
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Cover Fees pool updated.",
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating cover-fees pool:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// POST /api/admin/cover-fees/:poolId/activity/:activityId/cancel
// ------------------------------------------------------------------ //
router.post(
  "/:poolId/activity/:activityId/cancel",
  async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const poolId = parseInt(req.params.poolId, 10);
      const activityId = parseInt(req.params.activityId, 10);
      if (!Number.isFinite(poolId) || !Number.isFinite(activityId)) {
        res.status(400).json({ success: false, message: "Invalid id" });
        return;
      }

      const adminUserId = (req as any).user?.id || null;

      await client.query("BEGIN");

      const poolRes = await client.query(
        `SELECT id, sponsor_user_id, name, amount_used
           FROM campaign_cover_fees
          WHERE id = $1
          FOR UPDATE`,
        [poolId],
      );
      if (poolRes.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ success: false, message: "Cover Fees pool not found." });
        return;
      }
      const poolRow = poolRes.rows[0];

      const actRes = await client.query(
        `SELECT id, cover_fee_id, triggered_by_recommendation_id, campaign_id, fee_amount
           FROM campaign_cover_fees_activity
          WHERE id = $1
          FOR UPDATE`,
        [activityId],
      );
      if (actRes.rows.length === 0) {
        await client.query("COMMIT");
        res.json({
          success: true,
          message: "Cover-fee activity already canceled.",
          alreadyCanceled: true,
        });
        return;
      }
      const activity = actRes.rows[0];
      if (activity.cover_fee_id !== poolId) {
        await client.query("ROLLBACK");
        res.status(400).json({
          success: false,
          message: "Activity does not belong to this cover-fees pool.",
        });
        return;
      }

      const feeAmount = parseFloat(activity.fee_amount) || 0;

      await client.query(
        `INSERT INTO canceled_cover_fees_pairs
           (cover_fee_id, triggered_by_recommendation_id, campaign_id,
            fee_amount, canceled_by, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cover_fee_id, triggered_by_recommendation_id)
           WHERE triggered_by_recommendation_id IS NOT NULL
           DO NOTHING`,
        [
          poolId,
          activity.triggered_by_recommendation_id,
          activity.campaign_id,
          feeAmount,
          adminUserId,
          `Canceled via admin /cover-fees activity panel (was activity #${activityId})`,
        ],
      );

      await client.query(
        `DELETE FROM campaign_cover_fees_activity WHERE id = $1`,
        [activityId],
      );

      await client.query(
        `UPDATE campaign_cover_fees
            SET amount_used = GREATEST(0, amount_used - $1),
                updated_at  = NOW()
          WHERE id = $2`,
        [feeAmount, poolId],
      );

      const sponsorRes = await client.query(
        `SELECT account_balance, user_name, email FROM users WHERE id = $1`,
        [poolRow.sponsor_user_id],
      );
      if (sponsorRes.rows.length > 0) {
        const balance = parseFloat(sponsorRes.rows[0].account_balance) || 0;
        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, old_value, user_name,
              new_value, change_date, campaign_id)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
          [
            poolRow.sponsor_user_id,
            "Cover Fee canceled – funds returned to pool",
            `${poolRow.name || `Cover Fees pool #${poolId}`} · $${feeAmount.toFixed(2)} fee`,
            balance,
            sponsorRes.rows[0].user_name || sponsorRes.rows[0].email || "",
            balance,
            activity.campaign_id,
          ],
        );
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        message: `Cover Fee canceled. $${feeAmount.toFixed(2)} returned to ${poolRow.name || `Cover Fees pool #${poolId}`} available pool.`,
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Error canceling cover-fee activity:", err);
      res.status(500).json({ success: false, message: err.message });
    } finally {
      client.release();
    }
  },
);

// ------------------------------------------------------------------ //
// DELETE /api/admin/cover-fees/:id
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
      `SELECT id, sponsor_user_id, reserved_amount, amount_used, name
         FROM campaign_cover_fees WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ success: false, message: "Cover Fees pool not found." });
      return;
    }

    const g = existing.rows[0];
    const reserved = parseFloat(g.reserved_amount) || 0;
    const used = parseFloat(g.amount_used) || 0;

    // Block delete while holds are outstanding — otherwise we would
    // refund held escrow back to the sponsor's wallet and orphan the
    // pending donations that reserved it.
    const heldSumRes = await client.query(
      `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS s
         FROM campaign_cover_fees_activity
        WHERE cover_fee_id = $1
          AND status = 'held'
          AND fully_reversed_at IS NULL`,
      [id],
    );
    const heldSum = parseFloat(heldSumRes.rows[0]?.s || "0") || 0;
    if (heldSum > 0) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: `Cannot delete pool while $${heldSum.toFixed(2)} of cover-fee escrow is on hold for pending donations. Reject the pending requests first to release the holds.`,
      });
      return;
    }

    const refunded = await returnUnusedFunds(
      client,
      g.sponsor_user_id,
      reserved,
      used,
      g.name || `Cover Fees pool #${id}`,
    );

    await client.query(`DELETE FROM campaign_cover_fees WHERE id = $1`, [id]);

    await client.query("COMMIT");
    res.json({
      success: true,
      message:
        "Cover Fees pool deleted." +
        (refunded > 0 ? ` $${refunded.toFixed(2)} returned to sponsor.` : ""),
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error deleting cover-fees pool:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------ //
// GET /api/admin/cover-fees/:id/export
// ------------------------------------------------------------------ //
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: "Invalid id" });
      return;
    }

    const poolRes = await pool.query(
      `SELECT ccf.id, ccf.name, ccf.total_cap, ccf.amount_used, ccf.reserved_amount,
              ccf.fee_rate, ccf.per_investment_cap, ccf.is_active, ccf.notes,
              ccf.expires_at, ccf.created_at, ccf.updated_at,
              u.email AS sponsor_email,
              CONCAT(u.first_name, ' ', u.last_name) AS sponsor_full_name,
              u.user_name AS sponsor_user_name
         FROM campaign_cover_fees ccf
         LEFT JOIN users u ON u.id = ccf.sponsor_user_id
        WHERE ccf.id = $1`,
      [id],
    );
    if (poolRes.rows.length === 0) {
      res.status(404).json({ success: false, message: "Cover Fees pool not found." });
      return;
    }
    const g = poolRes.rows[0];

    const campsRes = await pool.query(
      `SELECT c.name FROM campaign_cover_fees_campaigns ccfc
         JOIN campaigns c ON c.id = ccfc.campaign_id
        WHERE ccfc.cover_fee_id = $1 ORDER BY c.name`,
      [id],
    );

    const activityRes = await pool.query(
      `SELECT a.id, a.fee_amount, a.donation_amount, a.created_at,
              c.name AS campaign_name,
              CONCAT(iu.first_name, ' ', iu.last_name) AS investor_full_name,
              iu.email AS investor_email,
              iu.user_name AS investor_user_name,
              tr.status AS investment_status,
              a.triggered_by_recommendation_id
         FROM campaign_cover_fees_activity a
         LEFT JOIN campaigns c ON c.id = a.campaign_id
         LEFT JOIN users iu ON iu.id = a.triggered_by_user_id
         LEFT JOIN recommendations tr ON tr.id = a.triggered_by_recommendation_id
        WHERE a.cover_fee_id = $1
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
    const totalDonationCovered = activityRes.rows.reduce(
      (s: number, r: any) => s + (parseFloat(r.donation_amount) || 0),
      0,
    );

    const poolName = (g.name || `Cover Fees pool #${id}`).trim() || `Cover Fees pool #${id}`;
    const sponsorName =
      (g.sponsor_full_name || "").trim() ||
      g.sponsor_user_name ||
      g.sponsor_email ||
      "";

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CataCap Admin";
    workbook.created = new Date();

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
    summary.addRow(["Cover Fees Pool Report"]).getCell(1).font = { bold: true, size: 14 };
    summary.addRow([]);
    addRow("Pool Name", poolName);
    addRow("Status", g.is_active ? "Active" : "Inactive");
    addRow("Sponsor", sponsorName);
    addRow("Sponsor Email", g.sponsor_email || "");
    addRow("Fee Rate", `${(parseFloat(g.fee_rate) * 100).toFixed(2)}%`);
    if (g.per_investment_cap != null) {
      addRow("Per-Investment Fee Cap", parseFloat(g.per_investment_cap), "$#,##0.00");
    }
    addRow(
      "Total Funds Allocated (Cap)",
      totalCap != null ? totalCap : "Unlimited",
      totalCap != null ? "$#,##0.00" : undefined,
    );
    if (reserved > 0) addRow("Reserved in Escrow", reserved, "$#,##0.00");
    addRow("Total Fees Covered So Far", amountUsed, "$#,##0.00");
    if (remaining != null) addRow("Remaining Available", remaining, "$#,##0.00");
    addRow("Number of Donations Covered", activityRes.rows.length);
    addRow("Total Donation Amount Covered", totalDonationCovered, "$#,##0.00");
    if (g.expires_at) addRow("Expires", new Date(g.expires_at), "MM/dd/yyyy");
    addRow("Created", new Date(g.created_at), "MM/dd/yy HH:mm");
    addRow("Updated", new Date(g.updated_at), "MM/dd/yy HH:mm");
    if (g.notes) addRow("Notes", g.notes);
    summary.addRow([]);
    addRow(
      "Eligible Campaigns",
      campsRes.rows.map((c: any) => c.name).join(", ") || "(none)",
    );

    summary.addRow([]);
    const sectionHeader = summary.addRow(["Fees Covered by Venture"]);
    sectionHeader.getCell(1).font = { bold: true, size: 12 };

    const ventureTotals = new Map<string, number>();
    for (const r of activityRes.rows) {
      const name = (r.campaign_name || "(Unknown campaign)").trim() || "(Unknown campaign)";
      const amt = parseFloat(r.fee_amount) || 0;
      ventureTotals.set(name, (ventureTotals.get(name) || 0) + amt);
    }

    if (ventureTotals.size === 0) {
      summary.addRow(["(no covered fees yet)"]);
    } else {
      const breakdownHeader = summary.addRow(["Venture", "Fees Covered $", "% of Total"]);
      breakdownHeader.eachCell((cell) => { cell.font = { bold: true }; });
      const sorted = Array.from(ventureTotals.entries()).sort((a, b) => b[1] - a[1]);
      const denom = amountUsed > 0 ? amountUsed : sorted.reduce((s, [, v]) => s + v, 0);
      for (const [name, amt] of sorted) {
        const pct = denom > 0 ? amt / denom : 0;
        const row = summary.addRow([name, amt, pct]);
        row.getCell(2).numFmt = "$#,##0.00";
        row.getCell(3).numFmt = "0.00%";
      }
    }

    const detail = workbook.addWorksheet("Covered Fees");
    const headers = [
      "Date Covered",
      "Investor Name",
      "Investor Email",
      "Campaign",
      "Donation Amount",
      "Fee Covered",
      "Investment Status",
      "Investment Rec ID",
    ];
    const headerRow = detail.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "left" };
    });

    for (const r of activityRes.rows) {
      const investorName =
        (r.investor_full_name || "").trim() || r.investor_user_name || "";
      const donationAmt =
        r.donation_amount != null ? parseFloat(r.donation_amount) : null;
      const feeAmt = r.fee_amount != null ? parseFloat(r.fee_amount) : null;
      const dataRow = detail.addRow([
        r.created_at ? new Date(r.created_at) : null,
        investorName,
        r.investor_email || "",
        r.campaign_name || "",
        donationAmt,
        feeAmt,
        r.investment_status || "",
        r.triggered_by_recommendation_id ?? "",
      ]);
      if (r.created_at) dataRow.getCell(1).numFmt = "MM/dd/yy HH:mm";
      if (donationAmt != null) dataRow.getCell(5).numFmt = "$#,##0.00";
      if (feeAmt != null) dataRow.getCell(6).numFmt = "$#,##0.00";
    }

    if (activityRes.rows.length > 0) {
      const totalsRow = detail.addRow([
        "", "", "", "TOTAL",
        totalDonationCovered, amountUsed, "", "",
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

    const safeName = poolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const dateStamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=CoverFees_${safeName}_${dateStamp}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error("Error exporting cover-fees pool:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
