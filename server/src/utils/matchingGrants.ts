/**
 * Investment Match Grants helper
 *
 * When a recommendation for a campaign is approved this module checks
 * whether any active (non-expired) match grant covers that campaign and,
 * if the donor is different from the investor, automatically allocates
 * the matched amount.
 *
 * Escrow model
 * ─────────────
 * If the grant has a total_cap (reserved_amount > 0) the funds were
 * already deducted from the donor's wallet at grant-creation time.
 * Matching therefore only:
 *   • increments amount_used
 *   • creates an approved recommendation for the donor
 *   • logs activity
 *   No further wallet change is needed.
 *
 * Unlimited grants (no total_cap, reserved_amount = 0)
 * ────────────────────────────────────────────────────
 * Funds are drawn from the donor's live wallet balance at match time.
 *
 * Called fire-and-forget AFTER the investor's recommendation transaction
 * has committed.
 */

import pool from "../db.js";

interface ApplyMatchArgs {
  campaignId: number;
  investorUserId: string;
  triggeringRecommendationId: number;
  investmentAmount: number;
  investorEmail: string;
  campaignName: string;
}

export async function applyMatchGrants(args: ApplyMatchArgs): Promise<void> {
  const {
    campaignId,
    investorUserId,
    triggeringRecommendationId,
    investmentAmount,
    campaignName,
  } = args;

  try {
    // ── Guardrail: never match a recommendation that was itself created by
    // a match grant. Prevents chain-matching (e.g. FundHer's donor recommendation
    // being matched by Lily's grant, or vice versa).
    const isMatchCreated = await pool.query(
      `SELECT 1 FROM campaign_match_grant_activity
        WHERE donor_recommendation_id = $1 LIMIT 1`,
      [triggeringRecommendationId],
    );
    if (isMatchCreated.rows.length > 0) {
      console.log(
        `applyMatchGrants: skipping rec ${triggeringRecommendationId} on campaign ${campaignId} — created by a match grant (no chain matching).`,
      );
      return;
    }

    // Find active, non-expired grants covering this campaign
    const grantsResult = await pool.query(
      `SELECT cmg.id, cmg.donor_user_id, cmg.total_cap, cmg.amount_used,
              cmg.reserved_amount, cmg.match_type, cmg.per_investment_cap,
              cmg.name, cmg.expires_at
         FROM campaign_match_grants cmg
         JOIN campaign_match_grant_campaigns cmgc
              ON cmgc.match_grant_id = cmg.id AND cmgc.campaign_id = $1
        WHERE cmg.is_active = TRUE
          AND cmg.donor_user_id != $2
          AND (cmg.expires_at IS NULL OR cmg.expires_at > NOW())
        ORDER BY cmg.id ASC`,
      [campaignId, investorUserId],
    );

    if (grantsResult.rows.length === 0) return;

    // Filter out grants that already have a match (pending or approved) for this recommendation
    const alreadyMatchedResult = await pool.query(
      `SELECT DISTINCT match_grant_id FROM campaign_match_grant_activity
        WHERE triggered_by_recommendation_id = $1`,
      [triggeringRecommendationId],
    );
    const alreadyMatched = new Set(alreadyMatchedResult.rows.map((r: any) => r.match_grant_id));

    for (const grant of grantsResult.rows) {
      if (alreadyMatched.has(grant.id)) continue;
      await applySingleGrant({
        grant,
        campaignId,
        investorUserId,
        triggeringRecommendationId,
        investmentAmount,
        campaignName,
      });
    }
  } catch (err: any) {
    console.error("applyMatchGrants: unexpected error:", err?.message || err);
  }
}

/**
 * Apply a single match grant to a single triggering recommendation.
 * Returns the matched amount (0 if skipped).
 *
 * Idempotency: relies on the unique index
 *   campaign_match_grant_activity_grant_rec_uniq
 * (match_grant_id, triggered_by_recommendation_id). On a duplicate-key
 * violation we silently roll back — another concurrent path already
 * recorded the match.
 */
export async function applySingleGrant(opts: {
  grant: any;
  campaignId: number;
  investorUserId: string;
  triggeringRecommendationId: number;
  investmentAmount: number;
  campaignName: string;
}): Promise<number> {
  const {
    grant,
    campaignId,
    triggeringRecommendationId,
    investmentAmount,
    campaignName,
  } = opts;

  const client = await pool.connect();
  try {
    const reserved = parseFloat(grant.reserved_amount) || 0;
    const amountUsed = parseFloat(grant.amount_used) || 0;
    const isEscrow = reserved > 0; // funds already taken from wallet at creation

    // ── Determine available budget ────────────────────────────────────
    let availableBudget: number;
    if (isEscrow) {
      availableBudget = Math.max(0, reserved - amountUsed);
    } else if (grant.total_cap != null) {
      // Capped but no reservation (edge case — treat as escrow exhausted)
      availableBudget = Math.max(
        0,
        parseFloat(grant.total_cap) - amountUsed,
      );
    } else {
      availableBudget = Infinity; // unlimited — will be capped by wallet below
    }

    if (availableBudget <= 0) return 0;

    // ── Compute match amount ──────────────────────────────────────────
    let matchAmount = investmentAmount;

    if (grant.match_type === "capped" && grant.per_investment_cap != null) {
      matchAmount = Math.min(matchAmount, parseFloat(grant.per_investment_cap));
    }
    matchAmount = Math.min(matchAmount, availableBudget);
    matchAmount = Math.round(matchAmount * 100) / 100;

    if (matchAmount <= 0) return 0;

    await client.query("BEGIN");

    // Fetch donor row with row-level lock so concurrent live-wallet matches
    // (e.g. retroactive sweep + live trigger on the same donor) cannot both
    // pass the balance check and overdraw the account.
    const donorResult = await client.query(
      `SELECT id, email, first_name, last_name, user_name, account_balance
         FROM users WHERE id = $1 FOR UPDATE`,
      [grant.donor_user_id],
    );
    if (donorResult.rows.length === 0) {
      await client.query("ROLLBACK");
      console.warn(
        `applyMatchGrants: donor ${grant.donor_user_id} not found, skipping grant ${grant.id}`,
      );
      return 0;
    }
    const donor = donorResult.rows[0];
    const donorBalance = parseFloat(donor.account_balance) || 0;
    const donorFullName =
      `${donor.first_name || ""} ${donor.last_name || ""}`.trim() ||
      donor.user_name ||
      "";

    if (!isEscrow) {
      // ── Live-wallet model: check and deduct ──────────────────────
      if (donorBalance <= 0) {
        await client.query("ROLLBACK");
        console.warn(
          `applyMatchGrants: donor ${grant.donor_user_id} has zero balance, skipping grant ${grant.id}`,
        );
        return 0;
      }
      if (donorBalance < matchAmount) {
        matchAmount = Math.round(donorBalance * 100) / 100;
      }
      const newBalance = parseFloat((donorBalance - matchAmount).toFixed(2));

      await client.query(
        `UPDATE users SET account_balance = $1 WHERE id = $2`,
        [newBalance, donor.id],
      );
      await client.query(
        `INSERT INTO account_balance_change_logs
           (user_id, payment_type, investment_name, campaign_id,
            old_value, user_name, new_value, change_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          donor.id,
          `Match grant – ${grant.name || `Grant #${grant.id}`}`,
          campaignName,
          campaignId,
          donorBalance,
          donor.user_name || donorFullName,
          newBalance,
        ],
      );
    } else {
      // ── Escrow model: no wallet change, but still log the activity ──
      const escrowDonorRes = await client.query(
        `SELECT account_balance, user_name FROM users WHERE id = $1`,
        [grant.donor_user_id],
      );
      if (escrowDonorRes.rows.length > 0) {
        const escrowBalance = parseFloat(escrowDonorRes.rows[0].account_balance) || 0;
        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, campaign_id,
              old_value, user_name, new_value, change_date, comment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
          [
            grant.donor_user_id,
            `Match grant – escrow applied`,
            campaignName,
            campaignId,
            escrowBalance,
            escrowDonorRes.rows[0].user_name || "",
            escrowBalance,
            `$${matchAmount.toFixed(2)} matched from escrow via grant "${grant.name || `Grant #${grant.id}`}"`,
          ],
        );
      }
    }

    // ── Create pending recommendation for donor ──────────────────────
    const recResult = await client.query(
      `INSERT INTO recommendations
         (user_email, user_full_name, campaign_id, status, amount, date_created, user_id)
       VALUES ($1, $2, $3, 'pending', $4, NOW(), $5)
       RETURNING id`,
      [donor.email, donorFullName, campaignId, matchAmount, donor.id],
    );
    const donorRecId = recResult.rows[0]?.id ?? null;

    // ── Update amount_used ────────────────────────────────────────────
    await client.query(
      `UPDATE campaign_match_grants
          SET amount_used = amount_used + $1,
              updated_at  = NOW()
        WHERE id = $2`,
      [matchAmount, grant.id],
    );

    // ── Log activity ──────────────────────────────────────────────────
    await client.query(
      `INSERT INTO campaign_match_grant_activity
         (match_grant_id, campaign_id, triggered_by_user_id,
          triggered_by_recommendation_id, donor_recommendation_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        grant.id,
        campaignId,
        opts.investorUserId,
        triggeringRecommendationId,
        donorRecId,
        matchAmount,
      ],
    );

    await client.query("COMMIT");

    console.log(
      `applyMatchGrants: grant ${grant.id} matched $${matchAmount} for campaign ${campaignId} (${isEscrow ? "escrow" : "live-wallet"})`,
    );
    return matchAmount;
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    // 23505 = unique_violation. Another path beat us to recording this match.
    if (err?.code === "23505") {
      console.log(
        `applyMatchGrants: grant ${grant.id} → rec ${triggeringRecommendationId} already recorded (idempotent skip)`,
      );
      return 0;
    }
    console.error(
      `applyMatchGrants: error on grant ${grant.id}:`,
      err?.message || err,
    );
    return 0;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Retroactive sweep
// ─────────────────────────────────────────────────────────────────────
/**
 * Apply a match grant retroactively to all eligible existing recommendations
 * dated on/after `fromDate`. Skips:
 *   • recs that were themselves created by a match grant (no chain matching)
 *   • recs already matched by THIS grant (dedup via unique index + pre-check)
 *   • recs by the donor themselves (donors can't match their own investments)
 *   • recs with non-positive amount or invalid status
 *
 * Returns { matched, totalAmount, scanned, skipped } summary.
 */
export async function runRetroactiveSweep(grantId: number): Promise<{
  matched: number;
  totalAmount: number;
  scanned: number;
  skipped: number;
}> {
  const summary = { matched: 0, totalAmount: 0, scanned: 0, skipped: 0 };

  try {
    const grantRes = await pool.query(
      `SELECT cmg.id, cmg.donor_user_id, cmg.total_cap, cmg.amount_used,
              cmg.reserved_amount, cmg.match_type, cmg.per_investment_cap,
              cmg.name, cmg.expires_at, cmg.is_active, cmg.retroactive_from
         FROM campaign_match_grants cmg
        WHERE cmg.id = $1`,
      [grantId],
    );
    if (grantRes.rows.length === 0) {
      console.warn(`runRetroactiveSweep: grant ${grantId} not found`);
      return summary;
    }
    const grant = grantRes.rows[0];

    if (!grant.is_active) {
      console.log(`runRetroactiveSweep: grant ${grantId} is inactive, skipping`);
      return summary;
    }
    if (!grant.retroactive_from) {
      console.log(`runRetroactiveSweep: grant ${grantId} has no retroactive_from, skipping`);
      return summary;
    }
    if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) {
      console.log(`runRetroactiveSweep: grant ${grantId} is expired, skipping`);
      return summary;
    }

    // Find candidate recommendations on the grant's eligible campaigns,
    // dated on/after retroactive_from, that have not already been matched
    // by this grant and were not themselves match-created.
    const recsRes = await pool.query(
      `SELECT r.id, r.user_id, r.amount, r.campaign_id, r.date_created,
              r.user_email, c.name AS campaign_name
         FROM recommendations r
         JOIN campaign_match_grant_campaigns cmgc
              ON cmgc.match_grant_id = $1 AND cmgc.campaign_id = r.campaign_id
         JOIN campaigns c ON c.id = r.campaign_id
        WHERE (r.is_deleted IS NULL OR r.is_deleted = false)
          AND (c.is_deleted IS NULL OR c.is_deleted = false)
          AND LOWER(r.status) IN ('approved', 'pending')
          AND r.amount > 0
          AND r.user_id IS NOT NULL
          AND r.user_id <> $2
          AND r.date_created >= $3
          AND NOT EXISTS (
            SELECT 1 FROM campaign_match_grant_activity a
             WHERE a.donor_recommendation_id = r.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM campaign_match_grant_activity a
             WHERE a.match_grant_id = $1
               AND a.triggered_by_recommendation_id = r.id
          )
        ORDER BY r.date_created ASC, r.id ASC`,
      [grantId, grant.donor_user_id, grant.retroactive_from],
    );

    summary.scanned = recsRes.rows.length;
    console.log(
      `runRetroactiveSweep: grant ${grantId} → ${summary.scanned} candidate recommendation(s) on/after ${grant.retroactive_from}`,
    );

    for (const rec of recsRes.rows) {
      // Re-read live grant state each iteration so amount_used / reserved_amount
      // reflect the most recent applications inside this sweep.
      const liveGrantRes = await pool.query(
        `SELECT id, donor_user_id, total_cap, amount_used, reserved_amount,
                match_type, per_investment_cap, name, expires_at
           FROM campaign_match_grants WHERE id = $1`,
        [grantId],
      );
      if (liveGrantRes.rows.length === 0) break;
      const liveGrant = liveGrantRes.rows[0];

      const applied = await applySingleGrant({
        grant: liveGrant,
        campaignId: Number(rec.campaign_id),
        investorUserId: rec.user_id,
        triggeringRecommendationId: Number(rec.id),
        investmentAmount: parseFloat(rec.amount) || 0,
        campaignName: rec.campaign_name || "",
      });

      if (applied > 0) {
        summary.matched += 1;
        summary.totalAmount += applied;
      } else {
        summary.skipped += 1;
      }
    }

    summary.totalAmount = Math.round(summary.totalAmount * 100) / 100;
    console.log(
      `runRetroactiveSweep: grant ${grantId} done — matched ${summary.matched} for $${summary.totalAmount.toFixed(2)} (skipped ${summary.skipped})`,
    );
    return summary;
  } catch (err: any) {
    console.error(`runRetroactiveSweep: grant ${grantId} error:`, err?.message || err);
    return summary;
  }
}
