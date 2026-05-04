/**
 * Pending Match Projections
 * ─────────────────────────
 * Read-only projections of what each match grant *would* contribute when
 * pending DAF / Foundation investments actually land. Used by the admin
 * investors page and the matching page to surface pending matches without
 * touching escrow balances or grant counters.
 *
 * Triggers we project:
 *   1. Recommendations linked to a `pending_grants` row whose status is
 *      NOT 'Received' (i.e. money still in flight) AND for which no
 *      `campaign_match_grant_activity` row already exists.
 *   2. `pending_grants` rows in status 'Pending' with no recommendation
 *      yet (orphan DAF commitments — these appear in the investors list
 *      via the unified CTE and need projections too).
 *
 * Algorithm (mirrors `applySingleGrant` in matchingGrants.ts):
 *   - Skip grant if expired, inactive, or donor is the trigger investor.
 *   - matchAmount = trigger.amount
 *     - if match_type='capped': min(matchAmount, per_investment_cap)
 *     - cap by remaining budget (reserved_amount - amount_used minus prior
 *       projections for this grant)
 *   - Process triggers chronologically (oldest first) so the projection
 *     reflects the order in which money would actually arrive.
 *
 * Donor wallet balance is intentionally NOT consulted here. The donor
 * already has the funds escrowed (reserved_amount > 0) for capped grants,
 * which is the only case where we project. Live-wallet/unlimited grants
 * (reserved_amount = 0, no total_cap) cannot be safely projected because
 * the donor balance can change before the trigger lands — we skip them.
 */

import pool from "../db.js";

export type ProjectionTrigger = {
  triggerType: "recommendation" | "pending_grant";
  /** Recommendation id, or `pending_grants.id` for orphan DAFs. */
  triggerId: number;
  campaignId: number;
  campaignName: string;
  triggerUserId: string | null;
  triggerName: string;
  triggerEmail: string;
  triggerAmount: number;
  triggerDate: Date | string | null;
  /** 'pending' | 'in transit' | 'pending' (orphan pgs are always pending). */
  triggerStatus: "pending" | "in transit";
  pendingGrantId: number | null;
};

export type ProjectionEntry = {
  grantId: number;
  grantName: string;
  donorUserId: string;
  donorEmail: string;
  donorName: string;
  trigger: ProjectionTrigger;
  projectedAmount: number;
};

type GrantRow = {
  id: number;
  name: string;
  donor_user_id: string;
  donor_email: string | null;
  donor_first_name: string | null;
  donor_last_name: string | null;
  donor_user_name: string | null;
  total_cap: string | null;
  amount_used: string | null;
  reserved_amount: string | null;
  match_type: string | null;
  per_investment_cap: string | null;
  is_active: boolean;
  expires_at: Date | null;
};

function donorDisplayName(g: GrantRow): string {
  const composed = `${g.donor_first_name ?? ""} ${g.donor_last_name ?? ""}`.trim();
  return composed || g.donor_user_name || g.donor_email || "Donor";
}

function isGrantUsable(g: GrantRow): boolean {
  if (!g.is_active) return false;
  if (g.expires_at && new Date(g.expires_at).getTime() <= Date.now()) return false;
  // We only project for capped/escrowed grants. Unlimited live-wallet grants
  // are too volatile to project safely and would mislead admins.
  const reserved = parseFloat(g.reserved_amount || "0") || 0;
  if (reserved <= 0) return false;
  const used = parseFloat(g.amount_used || "0") || 0;
  return reserved - used > 0;
}

function computeMatchAmount(triggerAmount: number, grant: GrantRow, remaining: number): number {
  let amt = triggerAmount;
  if (grant.match_type === "capped" && grant.per_investment_cap != null) {
    amt = Math.min(amt, parseFloat(grant.per_investment_cap) || 0);
  }
  amt = Math.min(amt, remaining);
  amt = Math.round(amt * 100) / 100;
  return amt > 0 ? amt : 0;
}

/**
 * Pending trigger investments for a set of campaigns.
 */
async function fetchPendingTriggers(campaignIds: number[]): Promise<ProjectionTrigger[]> {
  if (campaignIds.length === 0) return [];

  const recResult = await pool.query(
    `SELECT r.id, r.user_id, r.user_email, r.user_full_name,
            r.amount::numeric AS amount, r.date_created,
            r.campaign_id, c.name AS campaign_name,
            r.pending_grants_id, pg.status AS pg_status
       FROM recommendations r
       JOIN pending_grants pg ON pg.id = r.pending_grants_id
       JOIN campaigns c        ON c.id = r.campaign_id
      WHERE r.campaign_id = ANY($1::int[])
        AND COALESCE(r.is_deleted, false) = false
        AND COALESCE(pg.is_deleted, false) = false
        AND LOWER(COALESCE(pg.status, '')) IN ('pending', 'in transit')
        AND r.amount::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM campaign_match_grant_activity a
           WHERE a.triggered_by_recommendation_id = r.id
        )
      ORDER BY r.date_created ASC, r.id ASC`,
    [campaignIds],
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

  const triggers: ProjectionTrigger[] = [];

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
      triggerDate: r.date_created || null,
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

  // Global chronological order so projections drain remaining budget FIFO,
  // matching how real matches would fire as the money lands.
  triggers.sort((a, b) => {
    const da = a.triggerDate ? new Date(a.triggerDate).getTime() : 0;
    const db = b.triggerDate ? new Date(b.triggerDate).getTime() : 0;
    if (da !== db) return da - db;
    return a.triggerId - b.triggerId;
  });

  return triggers;
}

/**
 * All grants covering the given campaigns (de-duplicated).
 */
async function fetchGrantsForCampaigns(campaignIds: number[]): Promise<GrantRow[]> {
  if (campaignIds.length === 0) return [];
  const result = await pool.query(
    `SELECT DISTINCT cmg.id,
            cmg.name,
            cmg.donor_user_id,
            u.email      AS donor_email,
            u.first_name AS donor_first_name,
            u.last_name  AS donor_last_name,
            u.user_name  AS donor_user_name,
            cmg.total_cap, cmg.amount_used, cmg.reserved_amount,
            cmg.match_type, cmg.per_investment_cap,
            cmg.is_active, cmg.expires_at
       FROM campaign_match_grants cmg
       JOIN campaign_match_grant_campaigns cmgc
            ON cmgc.match_grant_id = cmg.id
       LEFT JOIN users u ON u.id = cmg.donor_user_id
      WHERE cmgc.campaign_id = ANY($1::int[])
      ORDER BY cmg.id ASC`,
    [campaignIds],
  );
  return result.rows as GrantRow[];
}

/**
 * Build all projections for a set of grants over a set of triggers,
 * decrementing each grant's virtual remaining budget as we go.
 */
function project(grants: GrantRow[], triggers: ProjectionTrigger[]): ProjectionEntry[] {
  const remainingByGrant = new Map<number, number>();
  for (const g of grants) {
    if (!isGrantUsable(g)) continue;
    const reserved = parseFloat(g.reserved_amount || "0") || 0;
    const used = parseFloat(g.amount_used || "0") || 0;
    remainingByGrant.set(g.id, Math.max(0, reserved - used));
  }

  const entries: ProjectionEntry[] = [];

  for (const trig of triggers) {
    for (const g of grants) {
      if (!remainingByGrant.has(g.id)) continue;
      if (g.donor_user_id === trig.triggerUserId) continue;
      const remaining = remainingByGrant.get(g.id) || 0;
      if (remaining <= 0) continue;
      const amount = computeMatchAmount(trig.triggerAmount, g, remaining);
      if (amount <= 0) continue;
      entries.push({
        grantId: g.id,
        grantName: g.name || `Grant #${g.id}`,
        donorUserId: g.donor_user_id,
        donorEmail: g.donor_email || "",
        donorName: donorDisplayName(g),
        trigger: trig,
        projectedAmount: amount,
      });
      remainingByGrant.set(g.id, Math.max(0, remaining - amount));
    }
  }

  return entries;
}

/**
 * Project pending matches for every grant covering the given campaign.
 * Used by the investors page.
 */
export async function projectPendingMatchesForCampaign(
  campaignId: number,
): Promise<ProjectionEntry[]> {
  const grants = await fetchGrantsForCampaigns([campaignId]);
  if (grants.length === 0) return [];
  const triggers = await fetchPendingTriggers([campaignId]);
  if (triggers.length === 0) return [];
  return project(grants, triggers);
}

/**
 * Project pending matches for a single grant across all the campaigns it
 * covers. Used by the matching page (per-grant activity panel and totals).
 */
export async function projectPendingMatchesForGrant(
  grantId: number,
): Promise<ProjectionEntry[]> {
  const campResult = await pool.query(
    `SELECT campaign_id FROM campaign_match_grant_campaigns WHERE match_grant_id = $1`,
    [grantId],
  );
  const campaignIds = campResult.rows.map((r: any) => Number(r.campaign_id));
  if (campaignIds.length === 0) return [];

  const grants = (await fetchGrantsForCampaigns(campaignIds)).filter((g) => g.id === grantId);
  if (grants.length === 0) return [];
  const triggers = await fetchPendingTriggers(campaignIds);
  if (triggers.length === 0) return [];
  return project(grants, triggers);
}

/**
 * Aggregate pending projections per grant id (used by /api/admin/matching
 * list endpoint to attach pending totals to each card without N+1 queries).
 */
export async function projectPendingTotalsForAllGrants(): Promise<
  Record<number, { pendingAmount: number; pendingCount: number }>
> {
  const grantsResult = await pool.query(
    `SELECT cmg.id, cmg.name, cmg.donor_user_id,
            u.email AS donor_email, u.first_name AS donor_first_name,
            u.last_name AS donor_last_name, u.user_name AS donor_user_name,
            cmg.total_cap, cmg.amount_used, cmg.reserved_amount,
            cmg.match_type, cmg.per_investment_cap,
            cmg.is_active, cmg.expires_at
       FROM campaign_match_grants cmg
       LEFT JOIN users u ON u.id = cmg.donor_user_id`,
  );
  const grants = grantsResult.rows as GrantRow[];
  const grantsById = new Map<number, GrantRow>(grants.map((g) => [g.id, g]));

  const linkResult = await pool.query(
    `SELECT match_grant_id, campaign_id FROM campaign_match_grant_campaigns`,
  );
  const grantToCampaigns = new Map<number, number[]>();
  for (const row of linkResult.rows) {
    const gid = Number(row.match_grant_id);
    if (!grantToCampaigns.has(gid)) grantToCampaigns.set(gid, []);
    grantToCampaigns.get(gid)!.push(Number(row.campaign_id));
  }

  const totals: Record<number, { pendingAmount: number; pendingCount: number }> = {};

  // Triggers are scoped per grant (not global) because each grant covers a
  // different set of campaigns. Cache by sorted-campaign-id-list to avoid
  // re-querying when many grants share the same coverage.
  const triggersCache = new Map<string, ProjectionTrigger[]>();

  for (const [grantId, campaignIds] of grantToCampaigns.entries()) {
    const grant = grantsById.get(grantId);
    if (!grant || !isGrantUsable(grant)) continue;

    const cacheKey = [...campaignIds].sort((a, b) => a - b).join(",");
    let triggers = triggersCache.get(cacheKey);
    if (!triggers) {
      triggers = await fetchPendingTriggers(campaignIds);
      triggersCache.set(cacheKey, triggers);
    }

    const entries = project([grant], triggers);
    let sum = 0;
    for (const e of entries) sum += e.projectedAmount;
    if (entries.length > 0) {
      totals[grantId] = {
        pendingAmount: Math.round(sum * 100) / 100,
        pendingCount: entries.length,
      };
    }
  }

  return totals;
}
