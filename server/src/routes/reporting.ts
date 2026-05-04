import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";

const router = Router();

router.get("/donor-reporting", async (_req: Request, res: Response) => {
  try {
    const CUTOFF = '2026-01-01';

    const usersResult = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, COALESCE(u.account_balance, 0) AS account_balance
       FROM users u
       WHERE (u.is_deleted IS NULL OR u.is_deleted = false)
       ORDER BY u.last_name ASC, u.first_name ASC`
    );

    const users = usersResult.rows;
    if (users.length === 0) {
      res.json({ items: [], cutoffLabel: "12/31/2025" });
      return;
    }

    const userIds = users.map((u: any) => u.id);
    const ph = userIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
    const phOffset = userIds.map((_: any, i: number) => `$${i + 2}`).join(", ");

    const [balanceChangesResult, invCutoffResult, invTodayResult, invAmtCutoffResult, invAmtTodayResult] = await Promise.all([
      pool.query(
        `SELECT user_id, COALESCE(SUM(new_value - old_value), 0) AS net_change
         FROM account_balance_change_logs
         WHERE user_id IN (${ph})
           AND change_date >= $${userIds.length + 1}
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY user_id`,
        [...userIds, CUTOFF]
      ),
      pool.query(
        `SELECT user_id, COUNT(*) AS cnt
         FROM recommendations
         WHERE user_id IN (${phOffset})
           AND (is_deleted IS NULL OR is_deleted = false)
           AND date_created < $1
         GROUP BY user_id`,
        [CUTOFF, ...userIds]
      ),
      pool.query(
        `SELECT user_id, COUNT(*) AS cnt
         FROM recommendations
         WHERE user_id IN (${ph})
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY user_id`,
        userIds
      ),
      pool.query(
        `SELECT user_id, COALESCE(SUM(amount), 0) AS total
         FROM recommendations
         WHERE user_id IN (${phOffset})
           AND (is_deleted IS NULL OR is_deleted = false)
           AND date_created < $1
         GROUP BY user_id`,
        [CUTOFF, ...userIds]
      ),
      pool.query(
        `SELECT user_id, COALESCE(SUM(amount), 0) AS total
         FROM recommendations
         WHERE user_id IN (${ph})
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY user_id`,
        userIds
      ),
    ]);

    const balanceChanges: Record<string, number> = {};
    for (const row of balanceChangesResult.rows) {
      balanceChanges[row.user_id] = parseFloat(row.net_change) || 0;
    }

    const invBefore: Record<string, number> = {};
    for (const row of invCutoffResult.rows) {
      invBefore[row.user_id] = parseInt(row.cnt) || 0;
    }

    const invTotal: Record<string, number> = {};
    for (const row of invTodayResult.rows) {
      invTotal[row.user_id] = parseInt(row.cnt) || 0;
    }

    const invAmtBefore: Record<string, number> = {};
    for (const row of invAmtCutoffResult.rows) {
      invAmtBefore[row.user_id] = parseFloat(row.total) || 0;
    }

    const invAmtTotal: Record<string, number> = {};
    for (const row of invAmtTodayResult.rows) {
      invAmtTotal[row.user_id] = parseFloat(row.total) || 0;
    }

    const items = users.map((u: any) => {
      const balanceToday = parseFloat(u.account_balance) || 0;
      const netChange = balanceChanges[u.id] || 0;
      const balanceCutoff = Math.round((balanceToday - netChange) * 100) / 100;

      const investedCutoff = invAmtBefore[u.id] || 0;
      const investedToday = invAmtTotal[u.id] || 0;

      const totalAssetsCutoff = Math.round((balanceCutoff + investedCutoff) * 100) / 100;
      const totalAssetsToday = Math.round((balanceToday + investedToday) * 100) / 100;
      const totalAssetsIncrease = Math.round((totalAssetsToday - totalAssetsCutoff) * 100) / 100;
      const totalAssetsPctChange = totalAssetsCutoff > 0
        ? Math.round(((totalAssetsIncrease / totalAssetsCutoff) * 100) * 100) / 100
        : (totalAssetsToday > 0 ? 100 : 0);

      const investmentsCutoff = invBefore[u.id] || 0;
      const investmentsToday = invTotal[u.id] || 0;
      const investmentPctChange = investmentsCutoff > 0
        ? Math.round((((investmentsToday - investmentsCutoff) / investmentsCutoff) * 100) * 100) / 100
        : (investmentsToday > 0 ? 100 : 0);

      return {
        id: u.id,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
        email: u.email,
        totalAssetsCutoff,
        totalAssetsToday,
        totalAssetsIncrease,
        totalAssetsPctChange,
        investmentsCutoff,
        investmentsToday,
        investmentPctChange,
      };
    });

    res.json({ items, cutoffLabel: "12/31/2025" });
  } catch (err) {
    console.error("Donor reporting error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/investment-reporting", async (_req: Request, res: Response) => {
  try {
    const CUTOFF = '2026-01-01';

    const campaignsResult = await pool.query(
      `SELECT c.id, c.name, c.stage, c.is_active, c.created_date
       FROM campaigns c
       WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
       ORDER BY c.name ASC`
    );

    const campaigns = campaignsResult.rows;
    if (campaigns.length === 0) {
      res.json({ items: [], cutoffLabel: "12/31/2025" });
      return;
    }

    const campaignIds = campaigns.map((c: any) => c.id);
    const ph = campaignIds.map((_: any, i: number) => `$${i + 1}`).join(", ");
    const phOffset = campaignIds.map((_: any, i: number) => `$${i + 2}`).join(", ");

    const [cutoffResult, todayResult, donorsCutoffResult, donorsTodayResult] = await Promise.all([
      pool.query(
        `SELECT campaign_id, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
         FROM recommendations
         WHERE campaign_id IN (${phOffset})
           AND (is_deleted IS NULL OR is_deleted = false)
           AND date_created < $1
         GROUP BY campaign_id`,
        [CUTOFF, ...campaignIds]
      ),
      pool.query(
        `SELECT campaign_id, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
         FROM recommendations
         WHERE campaign_id IN (${ph})
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY campaign_id`,
        campaignIds
      ),
      pool.query(
        `SELECT campaign_id, COUNT(DISTINCT user_id) AS cnt
         FROM recommendations
         WHERE campaign_id IN (${phOffset})
           AND (is_deleted IS NULL OR is_deleted = false)
           AND date_created < $1
         GROUP BY campaign_id`,
        [CUTOFF, ...campaignIds]
      ),
      pool.query(
        `SELECT campaign_id, COUNT(DISTINCT user_id) AS cnt
         FROM recommendations
         WHERE campaign_id IN (${ph})
           AND (is_deleted IS NULL OR is_deleted = false)
         GROUP BY campaign_id`,
        campaignIds
      ),
    ]);

    const cutoffTotals: Record<number, { total: number; cnt: number }> = {};
    for (const row of cutoffResult.rows) {
      cutoffTotals[row.campaign_id] = { total: parseFloat(row.total) || 0, cnt: parseInt(row.cnt) || 0 };
    }

    const todayTotals: Record<number, { total: number; cnt: number }> = {};
    for (const row of todayResult.rows) {
      todayTotals[row.campaign_id] = { total: parseFloat(row.total) || 0, cnt: parseInt(row.cnt) || 0 };
    }

    const donorsCutoff: Record<number, number> = {};
    for (const row of donorsCutoffResult.rows) {
      donorsCutoff[row.campaign_id] = parseInt(row.cnt) || 0;
    }

    const donorsToday: Record<number, number> = {};
    for (const row of donorsTodayResult.rows) {
      donorsToday[row.campaign_id] = parseInt(row.cnt) || 0;
    }

    const items = campaigns.map((c: any) => {
      const ct = cutoffTotals[c.id] || { total: 0, cnt: 0 };
      const tt = todayTotals[c.id] || { total: 0, cnt: 0 };
      const amountIncrease = Math.round((tt.total - ct.total) * 100) / 100;
      const amountPctChange = ct.total > 0
        ? Math.round(((amountIncrease / ct.total) * 100) * 100) / 100
        : (tt.total > 0 ? 100 : 0);

      const dc = donorsCutoff[c.id] || 0;
      const dt = donorsToday[c.id] || 0;
      const donorPctChange = dc > 0
        ? Math.round((((dt - dc) / dc) * 100) * 100) / 100
        : (dt > 0 ? 100 : 0);

      return {
        id: c.id,
        name: c.name,
        stage: c.stage,
        isActive: c.is_active,
        amountCutoff: ct.total,
        amountToday: tt.total,
        amountIncrease,
        amountPctChange,
        donationsCutoff: ct.cnt,
        donationsToday: tt.cnt,
        donorsCutoff: dc,
        donorsToday: dt,
        donorPctChange,
      };
    });

    res.json({ items, cutoffLabel: "12/31/2025" });
  } catch (err) {
    console.error("Investment reporting error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
