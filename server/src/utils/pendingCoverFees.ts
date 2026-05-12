/**
 * Pending Cover-Fee Projections — read-only projection of what each
 * cover-fees pool *would* cover when pending DAF / Foundation
 * donations actually land. Mirrors pendingMatches.ts (campaign_match_grants
 * → campaign_cover_fees substitution; per-investment cap and 5% fee_rate).
 *
 * We only project for capped/escrowed pools (reserved_amount > 0). Live
 * unlimited pools are too volatile to project safely.
 */

import pool from "../db.js";

export type CoverFeeProjectionTrigger = {
  triggerType: "recommendation" | "pending_grant";
  triggerId: number;
  campaignId: number;
  campaignName: string;
  triggerUserId: string | null;
  triggerName: string;
  triggerEmail: string;
  triggerAmount: number;
  triggerDate: Date | string | null;
  triggerStatus: "pending" | "in transit";
  pendingGrantId: number | null;
};

export type CoverFeeProjectionEntry = {
  coverFeeId: number;
  poolName: string;
  sponsorUserId: string;
  sponsorEmail: string;
  sponsorName: string;
  trigger: CoverFeeProjectionTrigger;
  projectedAmount: number;
};

type PoolRow = {
  id: number;
  name: string;
  sponsor_user_id: string;
  sponsor_email: string | null;
  sponsor_first_name: string | null;
  sponsor_last_name: string | null;
  sponsor_user_name: string | null;
  total_cap: string | null;
  amount_used: string | null;
  reserved_amount: string | null;
  fee_rate: string | null;
  per_investment_cap: string | null;
  is_active: boolean;
  expires_at: Date | null;
  coverage_active_from: Date | null;
};

function sponsorDisplayName(p: PoolRow): string {
  const composed = `${p.sponsor_first_name ?? ""} ${p.sponsor_last_name ?? ""}`.trim();
  return composed || p.sponsor_user_name || p.sponsor_email || "Sponsor";
}

function isPoolUsable(p: PoolRow): boolean {
  if (!p.is_active) return false;
  if (p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) return false;
  const reserved = parseFloat(p.reserved_amount || "0") || 0;
  if (reserved <= 0) return false;
  const used = parseFloat(p.amount_used || "0") || 0;
  return reserved - used > 0;
}

function computeFeeAmount(triggerAmount: number, p: PoolRow, remaining: number): number {
  const rate = parseFloat(p.fee_rate || "0.05") || 0.05;
  let amt = triggerAmount * rate;
  if (p.per_investment_cap != null) {
    amt = Math.min(amt, parseFloat(p.per_investment_cap) || 0);
  }
  amt = Math.min(amt, remaining);
  amt = Math.round(amt * 100) / 100;
  return amt > 0 ? amt : 0;
}

async function fetchPendingTriggers(
  campaignIds: number[],
  excludeForCoverFeeId?: number,
): Promise<CoverFeeProjectionTrigger[]> {
  if (campaignIds.length === 0) return [];

  const params: any[] = [campaignIds];
  let cancelExclusion = "";
  if (excludeForCoverFeeId != null) {
    params.push(excludeForCoverFeeId);
    cancelExclusion = `
        AND NOT EXISTS (
          SELECT 1 FROM canceled_cover_fees_pairs cmp
           WHERE cmp.cover_fee_id = $${params.length}
             AND cmp.triggered_by_recommendation_id = r.id
        )`;
  }

  const recResult = await pool.query(
    `SELECT r.id, r.user_id, r.user_email, r.user_full_name,
            r.amount::numeric AS amount, r.date_created,
            r.campaign_id, c.name AS campaign_name,
            r.pending_grants_id, pg.status AS pg_status,
            pg.created_date AS pg_created_date,
            pg.daf_provider AS pg_daf_provider
       FROM recommendations r
       JOIN pending_grants pg ON pg.id = r.pending_grants_id
       JOIN campaigns c        ON c.id = r.campaign_id
      WHERE r.campaign_id = ANY($1::int[])
        AND COALESCE(r.is_deleted, false) = false
        AND COALESCE(pg.is_deleted, false) = false
        AND LOWER(COALESCE(pg.status, '')) IN ('pending', 'in transit')
        AND r.amount::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM campaign_cover_fees_activity a
           WHERE a.triggered_by_recommendation_id = r.id
        )${cancelExclusion}
      ORDER BY r.date_created ASC, r.id ASC`,
    params,
  );

  const orphanResult = await pool.query(
    `SELECT pg.id, pg.user_id, u.email, u.first_name, u.last_name,
            COALESCE(NULLIF(pg.amount, ''), '0')::numeric AS amount,
            pg.created_date AS date_created,
            pg.campaign_id, c.name AS campaign_name
       FROM pending_grants pg
       JOIN campaigns c ON c.id = pg.campaign_id
       LEFT JOIN users u ON u.id = pg.user_id
      WHERE pg.campaign_id = ANY($1::int[])
        AND COALESCE(pg.is_deleted, false) = false
        AND LOWER(COALESCE(pg.status, '')) = 'pending'
        AND COALESCE(NULLIF(pg.amount, ''), '0')::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM recommendations r2
           WHERE r2.pending_grants_id = pg.id
             AND COALESCE(r2.is_deleted, false) = false
        )
      ORDER BY pg.created_date ASC, pg.id ASC`,
    [campaignIds],
  );

  const triggers: CoverFeeProjectionTrigger[] = [];

  for (const r of recResult.rows) {
    triggers.push({
      triggerType: "recommendation",
      triggerId: Number(r.id),
      campaignId: Number(r.campaign_id),
      campaignName: r.campaign_name || "",
      triggerUserId: r.user_id || null,
      triggerName: (r.user_full_name || "").trim() || r.user_email || "Anonymous",
      triggerEmail: r.user_email || "",
      triggerAmount: parseFloat(r.amount) || 0,
      triggerDate:
        String(r.pg_daf_provider || "").trim().toLowerCase() === "foundation grant"
          ? r.pg_created_date || r.date_created || null
          : r.date_created || null,
      triggerStatus: String(r.pg_status || "").toLowerCase() === "in transit" ? "in transit" : "pending",
      pendingGrantId: r.pending_grants_id != null ? Number(r.pending_grants_id) : null,
    });
  }

  for (const p of orphanResult.rows) {
    const composedName =
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "Anonymous";
    triggers.push({
      triggerType: "pending_grant",
      triggerId: Number(p.id),
      campaignId: Number(p.campaign_id),
      campaignName: p.campaign_name || "",
      triggerUserId: p.user_id || null,
      triggerName: composedName,
      triggerEmail: p.email || "",
      triggerAmount: parseFloat(p.amount) || 0,
      triggerDate: p.date_created || null,
      triggerStatus: "pending",
      pendingGrantId: Number(p.id),
    });
  }

  triggers.sort((a, b) => {
    const da = a.triggerDate ? new Date(a.triggerDate).getTime() : 0;
    const db = b.triggerDate ? new Date(b.triggerDate).getTime() : 0;
    if (da !== db) return da - db;
    return a.triggerId - b.triggerId;
  });

  return triggers;
}

async function fetchPoolsForCampaigns(campaignIds: number[]): Promise<PoolRow[]> {
  if (campaignIds.length === 0) return [];
  const result = await pool.query(
    `SELECT DISTINCT ccf.id,
            ccf.name,
            ccf.sponsor_user_id,
            u.email      AS sponsor_email,
            u.first_name AS sponsor_first_name,
            u.last_name  AS sponsor_last_name,
            u.user_name  AS sponsor_user_name,
            ccf.total_cap, ccf.amount_used, ccf.reserved_amount,
            ccf.fee_rate, ccf.per_investment_cap,
            ccf.is_active, ccf.expires_at, ccf.coverage_active_from
       FROM campaign_cover_fees ccf
       JOIN campaign_cover_fees_campaigns ccfc
            ON ccfc.cover_fee_id = ccf.id
       LEFT JOIN users u ON u.id = ccf.sponsor_user_id
      WHERE ccfc.campaign_id = ANY($1::int[])
      ORDER BY ccf.id ASC`,
    [campaignIds],
  );
  return result.rows as PoolRow[];
}

function project(pools: PoolRow[], triggers: CoverFeeProjectionTrigger[]): CoverFeeProjectionEntry[] {
  const remainingByPool = new Map<number, number>();
  for (const p of pools) {
    if (!isPoolUsable(p)) continue;
    const reserved = parseFloat(p.reserved_amount || "0") || 0;
    const used = parseFloat(p.amount_used || "0") || 0;
    remainingByPool.set(p.id, Math.max(0, reserved - used));
  }

  const entries: CoverFeeProjectionEntry[] = [];
  for (const trig of triggers) {
    for (const p of pools) {
      if (!remainingByPool.has(p.id)) continue;
      const remaining = remainingByPool.get(p.id) || 0;
      if (remaining <= 0) continue;
      // Coverage activation cutoff: a pool only projects coverage on
      // triggers dated on/after its coverage_active_from. This prevents
      // a freshly-created pool from "claiming" pre-existing pending
      // donations that landed in the system before the sponsor funded
      // the pool.
      if (p.coverage_active_from && trig.triggerDate) {
        const activeFromMs = new Date(p.coverage_active_from).getTime();
        const triggerMs = new Date(trig.triggerDate).getTime();
        if (Number.isFinite(activeFromMs) && Number.isFinite(triggerMs) && triggerMs < activeFromMs) {
          continue;
        }
      }
      const amount = computeFeeAmount(trig.triggerAmount, p, remaining);
      if (amount <= 0) continue;
      entries.push({
        coverFeeId: p.id,
        poolName: p.name || `Pool #${p.id}`,
        sponsorUserId: p.sponsor_user_id,
        sponsorEmail: p.sponsor_email || "",
        sponsorName: sponsorDisplayName(p),
        trigger: trig,
        projectedAmount: amount,
      });
      remainingByPool.set(p.id, Math.max(0, remaining - amount));
    }
  }
  return entries;
}

export async function projectPendingCoverFeesForCampaign(
  campaignId: number,
): Promise<CoverFeeProjectionEntry[]> {
  const pools = await fetchPoolsForCampaigns([campaignId]);
  if (pools.length === 0) return [];
  const triggers = await fetchPendingTriggers([campaignId]);
  if (triggers.length === 0) return [];
  return project(pools, triggers);
}

export async function projectPendingCoverFeesForPool(
  coverFeeId: number,
): Promise<CoverFeeProjectionEntry[]> {
  const campResult = await pool.query(
    `SELECT campaign_id FROM campaign_cover_fees_campaigns WHERE cover_fee_id = $1`,
    [coverFeeId],
  );
  const campaignIds = campResult.rows.map((r: any) => Number(r.campaign_id));
  if (campaignIds.length === 0) return [];

  const pools = (await fetchPoolsForCampaigns(campaignIds)).filter((p) => p.id === coverFeeId);
  if (pools.length === 0) return [];
  const triggers = await fetchPendingTriggers(campaignIds, coverFeeId);
  if (triggers.length === 0) return [];
  return project(pools, triggers);
}

export async function projectPendingCoverFeeTotalsForAllPools(): Promise<
  Record<number, { pendingAmount: number; pendingCount: number }>
> {
  const poolsResult = await pool.query(
    `SELECT ccf.id, ccf.name, ccf.sponsor_user_id,
            u.email AS sponsor_email, u.first_name AS sponsor_first_name,
            u.last_name AS sponsor_last_name, u.user_name AS sponsor_user_name,
            ccf.total_cap, ccf.amount_used, ccf.reserved_amount,
            ccf.fee_rate, ccf.per_investment_cap,
            ccf.is_active, ccf.expires_at, ccf.coverage_active_from
       FROM campaign_cover_fees ccf
       LEFT JOIN users u ON u.id = ccf.sponsor_user_id`,
  );
  const pools = poolsResult.rows as PoolRow[];
  const poolsById = new Map<number, PoolRow>(pools.map((p) => [p.id, p]));

  const linkResult = await pool.query(
    `SELECT cover_fee_id, campaign_id FROM campaign_cover_fees_campaigns`,
  );
  const poolToCampaigns = new Map<number, number[]>();
  for (const row of linkResult.rows) {
    const pid = Number(row.cover_fee_id);
    if (!poolToCampaigns.has(pid)) poolToCampaigns.set(pid, []);
    poolToCampaigns.get(pid)!.push(Number(row.campaign_id));
  }

  const totals: Record<number, { pendingAmount: number; pendingCount: number }> = {};

  for (const [pid, campaignIds] of poolToCampaigns.entries()) {
    const p = poolsById.get(pid);
    if (!p || !isPoolUsable(p)) continue;
    // Pass the pool id so fetchPendingTriggers excludes any
    // (pool, recommendation) pairs that have been tombstoned by an
    // admin cancel — otherwise list-view pending totals would
    // overstate the amount after cancellations.
    const triggers = await fetchPendingTriggers(campaignIds, pid);
    const entries = project([p], triggers);
    let sum = 0;
    for (const e of entries) sum += e.projectedAmount;
    if (entries.length > 0) {
      totals[pid] = {
        pendingAmount: Math.round(sum * 100) / 100,
        pendingCount: entries.length,
      };
    }
  }

  return totals;
}
