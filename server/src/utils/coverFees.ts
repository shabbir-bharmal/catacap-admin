/**
 * Cover Fees helper
 *
 * Mirrors matchingGrants.ts but instead of matching the donor's
 * contribution 1:1 (or capped), the sponsor's pre-funded escrow pool
 * pays the fixed CataCap platform fee (5% of the donation) on behalf
 * of the donor.
 *
 * Escrow model
 * ─────────────
 * If the pool has a total_cap (reserved_amount > 0) the funds were
 * already deducted from the sponsor's wallet at pool-creation time.
 * Covering a fee therefore only:
 *   • increments amount_used
 *   • logs activity
 *   No further wallet change is needed.
 *
 * Unlimited pools (no total_cap, reserved_amount = 0)
 * ────────────────────────────────────────────────────
 * Fees are drawn from the sponsor's live wallet balance at the time
 * the donation lands.
 *
 * Called fire-and-forget AFTER the donation transaction has committed.
 */

import pool from "../db.js";

export const COVER_FEE_RATE = 0.05; // 5% CataCap platform fee

interface ApplyCoverFeesArgs {
  campaignId: number;
  investorUserId: string;
  triggeringRecommendationId: number;
  investmentAmount: number;
  investorEmail: string;
  campaignName: string;
  // 'initial'   = the 5% fee on the initial donation (recommendations approval)
  // 'lifecycle' = the 5% fee on later disbursements/payments tied to the
  //               investment over its lifetime (pending grants, other assets)
  // Defaults to 'initial' for backward compatibility.
  kind?: "initial" | "lifecycle";
}

export async function applyCoverFees(args: ApplyCoverFeesArgs): Promise<void> {
  const {
    campaignId,
    investorUserId,
    triggeringRecommendationId,
    investmentAmount,
    campaignName,
    kind = "initial",
  } = args;

  try {
    // Find active, non-expired pools covering this campaign. We allow the
    // sponsor and the donor to be the same user — covering your own fee
    // is fine.
    // Filter by phase toggle: 'initial' triggers only consider pools
    // with cover_initial_fee = true; 'lifecycle' triggers only consider
    // pools with cover_lifecycle_fee = true. A pool can opt into both.
    const phaseColumn =
      kind === "lifecycle" ? "ccf.cover_lifecycle_fee" : "ccf.cover_initial_fee";
    // A pool only covers triggers that occur on or after its
    // coverage_active_from cutoff (defaults to NOW() at pool creation).
    // For a recommendation trigger we compare against r.date_created;
    // when the trigger has no rec context (defensive) we fall back to
    // NOW(), which is always >= coverage_active_from for live coverage.
    const poolsResult = await pool.query(
      `SELECT ccf.id, ccf.sponsor_user_id, ccf.total_cap, ccf.amount_used,
              ccf.reserved_amount, ccf.fee_rate, ccf.per_investment_cap,
              ccf.name, ccf.expires_at
         FROM campaign_cover_fees ccf
         JOIN campaign_cover_fees_campaigns ccfc
              ON ccfc.cover_fee_id = ccf.id AND ccfc.campaign_id = $1
        WHERE ccf.is_active = TRUE
          AND ${phaseColumn} = TRUE
          AND (ccf.expires_at IS NULL OR ccf.expires_at > NOW())
          AND ccf.coverage_active_from <= COALESCE(
                (SELECT date_created FROM recommendations WHERE id = $2),
                NOW()
              )
        ORDER BY ccf.id ASC`,
      [campaignId, triggeringRecommendationId],
    );

    if (poolsResult.rows.length === 0) return;

    // Filter out pools that already covered this recommendation OR
    // whose (pool, recommendation) pair was tombstoned by an admin
    // cancel. Without the tombstone check, hooks firing on subsequent
    // status transitions of the same recommendation would silently
    // resurrect canceled coverage.
    const skipResult = await pool.query(
      `SELECT cover_fee_id FROM campaign_cover_fees_activity
        WHERE triggered_by_recommendation_id = $1
       UNION
       SELECT cover_fee_id FROM canceled_cover_fees_pairs
        WHERE triggered_by_recommendation_id = $1`,
      [triggeringRecommendationId],
    );
    const alreadyCovered = new Set(
      skipResult.rows.map((r: any) => r.cover_fee_id),
    );

    // Single-cover policy: a given donation's 5% fee is only ever
    // covered by ONE pool. Walk pools in deterministic order and stop
    // after the first one that successfully covers (>0). Without this,
    // overlapping pools on the same campaign would each debit the same
    // recommendation, double/triple-counting the fee against sponsors.
    for (const p of poolsResult.rows) {
      if (alreadyCovered.has(p.id)) continue;
      const covered = await applySingleCoverFee({
        pool: p,
        campaignId,
        investorUserId,
        triggeringRecommendationId,
        investmentAmount,
        campaignName,
      });
      if (covered > 0) break;
    }
  } catch (err: any) {
    console.error("applyCoverFees: unexpected error:", err?.message || err);
  }
}

/**
 * Apply one cover-fees pool to a single triggering donation.
 * Returns the fee amount covered (0 if skipped).
 *
 * Idempotency: relies on
 *   campaign_cover_fees_activity_pool_rec_uniq
 * (cover_fee_id, triggered_by_recommendation_id). Duplicate-key violation
 * silently rolls back — another concurrent path already recorded the fee.
 */
export async function applySingleCoverFee(opts: {
  pool: any;
  campaignId: number;
  investorUserId: string;
  triggeringRecommendationId: number;
  investmentAmount: number;
  campaignName: string;
}): Promise<number> {
  const {
    pool: poolRow,
    campaignId,
    triggeringRecommendationId,
    investmentAmount,
    campaignName,
  } = opts;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Re-read the pool row inside the txn under FOR UPDATE so concurrent
    // approvals serialize on the same row. Without this, two donations
    // could both observe enough remaining escrow and both increment
    // amount_used, exceeding reserved/total_cap.
    const lockedPoolRes = await client.query(
      `SELECT id, name, sponsor_user_id, fee_rate, per_investment_cap,
              total_cap, reserved_amount, amount_used
         FROM campaign_cover_fees
        WHERE id = $1
        FOR UPDATE`,
      [poolRow.id],
    );
    if (lockedPoolRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return 0;
    }
    const locked = lockedPoolRes.rows[0];
    const reserved = parseFloat(locked.reserved_amount) || 0;
    const amountUsed = parseFloat(locked.amount_used) || 0;
    const isEscrow = reserved > 0;
    const feeRate = parseFloat(locked.fee_rate) || COVER_FEE_RATE;

    // ── Available budget (recomputed under lock) ─────────────────────
    let availableBudget: number;
    if (isEscrow) {
      availableBudget = Math.max(0, reserved - amountUsed);
    } else if (locked.total_cap != null) {
      availableBudget = Math.max(0, parseFloat(locked.total_cap) - amountUsed);
    } else {
      availableBudget = Infinity;
    }
    if (availableBudget <= 0) {
      await client.query("ROLLBACK");
      return 0;
    }

    // ── Compute fee amount (5% of donation, optional per-investment cap) ──
    let feeAmount = investmentAmount * feeRate;
    if (locked.per_investment_cap != null) {
      feeAmount = Math.min(feeAmount, parseFloat(locked.per_investment_cap));
    }
    feeAmount = Math.min(feeAmount, availableBudget);
    feeAmount = Math.round(feeAmount * 100) / 100;
    if (feeAmount <= 0) {
      await client.query("ROLLBACK");
      return 0;
    }

    const sponsorRes = await client.query(
      `SELECT id, email, first_name, last_name, user_name, account_balance
         FROM users WHERE id = $1 FOR UPDATE`,
      [locked.sponsor_user_id],
    );
    if (sponsorRes.rows.length === 0) {
      await client.query("ROLLBACK");
      console.warn(
        `applyCoverFees: sponsor ${locked.sponsor_user_id} not found, skipping pool ${locked.id}`,
      );
      return 0;
    }
    const sponsor = sponsorRes.rows[0];
    const sponsorBalance = parseFloat(sponsor.account_balance) || 0;
    const sponsorFullName =
      `${sponsor.first_name || ""} ${sponsor.last_name || ""}`.trim() ||
      sponsor.user_name ||
      "";

    if (!isEscrow) {
      if (sponsorBalance <= 0) {
        await client.query("ROLLBACK");
        console.warn(
          `applyCoverFees: sponsor ${poolRow.sponsor_user_id} has zero balance, skipping pool ${poolRow.id}`,
        );
        return 0;
      }
      if (sponsorBalance < feeAmount) {
        feeAmount = Math.round(sponsorBalance * 100) / 100;
      }
      const newBalance = parseFloat((sponsorBalance - feeAmount).toFixed(2));
      await client.query(
        `UPDATE users SET account_balance = $1 WHERE id = $2`,
        [newBalance, sponsor.id],
      );
      await client.query(
        `INSERT INTO account_balance_change_logs
           (user_id, payment_type, investment_name, campaign_id,
            old_value, user_name, new_value, change_date,
            gross_amount, fees, net_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)`,
        [
          sponsor.id,
          `Cover Fees – ${poolRow.name || `Pool #${poolRow.id}`}`,
          campaignName,
          campaignId,
          sponsorBalance,
          sponsor.user_name || sponsorFullName,
          newBalance,
          feeAmount,
          0,
          feeAmount,
        ],
      );
    } else {
      // Escrow pools: also debit the sponsor's wallet by the fee amount
      // so the Account History row shows a real Old → New balance change
      // (matches live-wallet behavior).
      let escrowFeeAmount = feeAmount;
      if (sponsorBalance < escrowFeeAmount) {
        escrowFeeAmount = Math.round(sponsorBalance * 100) / 100;
      }
      if (escrowFeeAmount > 0) {
        const newSponsorBalance = parseFloat(
          (sponsorBalance - escrowFeeAmount).toFixed(2),
        );
        await client.query(
          `UPDATE users SET account_balance = $1 WHERE id = $2`,
          [newSponsorBalance, sponsor.id],
        );
        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, campaign_id,
              old_value, user_name, new_value, change_date, comment,
              gross_amount, fees, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11)`,
          [
            sponsor.id,
            `Cover Fees – escrow applied`,
            campaignName,
            campaignId,
            sponsorBalance,
            sponsor.user_name || sponsorFullName,
            newSponsorBalance,
            `$${escrowFeeAmount.toFixed(2)} fee covered from escrow via pool "${poolRow.name || `Pool #${poolRow.id}`}"`,
            escrowFeeAmount,
            0,
            escrowFeeAmount,
          ],
        );
        feeAmount = escrowFeeAmount;
      } else {
        await client.query("ROLLBACK");
        console.warn(
          `applyCoverFees: sponsor ${sponsor.id} has zero balance for escrow pool ${poolRow.id}, skipping`,
        );
        return 0;
      }
    }

    await client.query(
      `UPDATE campaign_cover_fees
          SET amount_used = amount_used + $1,
              updated_at  = NOW()
        WHERE id = $2`,
      [feeAmount, poolRow.id],
    );

    await client.query(
      `INSERT INTO campaign_cover_fees_activity
         (cover_fee_id, campaign_id, triggered_by_user_id,
          triggered_by_recommendation_id, fee_amount, donation_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        poolRow.id,
        campaignId,
        opts.investorUserId,
        triggeringRecommendationId,
        feeAmount,
        investmentAmount,
      ],
    );

    await client.query("COMMIT");
    console.log(
      `applyCoverFees: pool ${poolRow.id} covered $${feeAmount} for campaign ${campaignId} (${isEscrow ? "escrow" : "live-wallet"})`,
    );
    return feeAmount;
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") {
      console.log(
        `applyCoverFees: pool ${poolRow.id} → rec ${triggeringRecommendationId} already recorded (idempotent skip)`,
      );
      return 0;
    }
    console.error(
      `applyCoverFees: error on pool ${poolRow.id}:`,
      err?.message || err,
    );
    return 0;
  } finally {
    client.release();
  }
}

/**
 * Retroactive sweep — apply a cover-fees pool to all eligible recommendations
 * dated on/after `retroactive_from`.
 */
export async function runRetroactiveCoverFeeSweep(coverFeeId: number): Promise<{
  matched: number;
  totalAmount: number;
  scanned: number;
  skipped: number;
}> {
  const summary = { matched: 0, totalAmount: 0, scanned: 0, skipped: 0 };

  try {
    const poolRes = await pool.query(
      `SELECT id, sponsor_user_id, total_cap, amount_used, reserved_amount,
              fee_rate, per_investment_cap, name, expires_at, is_active,
              retroactive_from, cover_initial_fee
         FROM campaign_cover_fees WHERE id = $1`,
      [coverFeeId],
    );
    if (poolRes.rows.length === 0) {
      console.warn(`runRetroactiveCoverFeeSweep: pool ${coverFeeId} not found`);
      return summary;
    }
    const p = poolRes.rows[0];
    if (!p.is_active) return summary;
    if (!p.retroactive_from) return summary;
    // Retroactive sweep walks recommendations (initial donations).
    // If the pool has opted out of covering the initial fee, there's
    // nothing to sweep.
    if (p.cover_initial_fee === false) return summary;
    if (p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) {
      return summary;
    }

    const recsRes = await pool.query(
      `SELECT r.id, r.user_id, r.amount, r.campaign_id, r.date_created,
              r.user_email, c.name AS campaign_name
         FROM recommendations r
         JOIN campaign_cover_fees_campaigns ccfc
              ON ccfc.cover_fee_id = $1 AND ccfc.campaign_id = r.campaign_id
         JOIN campaigns c ON c.id = r.campaign_id
        WHERE (r.is_deleted IS NULL OR r.is_deleted = false)
          AND (c.is_deleted IS NULL OR c.is_deleted = false)
          AND LOWER(r.status) IN ('approved', 'pending')
          AND r.amount > 0
          AND r.user_id IS NOT NULL
          AND r.date_created >= $2
          AND NOT EXISTS (
            SELECT 1 FROM campaign_cover_fees_activity a
             WHERE a.cover_fee_id = $1
               AND a.triggered_by_recommendation_id = r.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM canceled_cover_fees_pairs cmp
             WHERE cmp.cover_fee_id = $1
               AND cmp.triggered_by_recommendation_id = r.id
          )
        ORDER BY r.date_created ASC, r.id ASC`,
      [coverFeeId, p.retroactive_from],
    );

    summary.scanned = recsRes.rows.length;

    for (const rec of recsRes.rows) {
      const liveRes = await pool.query(
        `SELECT id, sponsor_user_id, total_cap, amount_used, reserved_amount,
                fee_rate, per_investment_cap, name, expires_at
           FROM campaign_cover_fees WHERE id = $1`,
        [coverFeeId],
      );
      if (liveRes.rows.length === 0) break;

      const applied = await applySingleCoverFee({
        pool: liveRes.rows[0],
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
    return summary;
  } catch (err: any) {
    console.error(
      `runRetroactiveCoverFeeSweep: pool ${coverFeeId} error:`,
      err?.message || err,
    );
    return summary;
  }
}
