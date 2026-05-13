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
import type { PoolClient } from "pg";

export const COVER_FEE_RATE = 0.05; // 5% CataCap platform fee

/**
 * Payment-type label used on the donor's Account History row when a
 * Cover-Fees-backed donation is refunded and the original "escrow
 * applied" entry is paired with a reversal.
 */
export const COVER_FEES_DONOR_REVERSAL_PAYMENT_TYPE =
  "Cover Fees – escrow reversed";

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
  // Optional payment reference (e.g. "stripe_card_<intent>" or
  // "stripe_bank_<intent>") persisted on the activity row so the
  // Stripe refund webhook can locate the activity to reverse later.
  // Optional because non-Stripe trigger paths (admin approval, etc.)
  // legitimately have no payment reference.
  paymentRef?: string;
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
  let { paymentRef } = args;

  try {
    // If no explicit paymentRef was supplied (today's admin-approval
    // call sites don't have one in scope), try to derive it from the
    // donor's most recent succeeded Stripe transaction tied to the
    // recommendation. Lets the refund webhook locate this activity row
    // later. The webhook tries both stripe_card_<intent> and
    // stripe_bank_<intent> prefixes, so storing one form is sufficient
    // — we default to the card prefix.
    if (!paymentRef && investorUserId) {
      try {
        // Deterministic match: require an EXACT amount match AND a
        // unique result within a 24h window of the recommendation.
        // If the user has multiple same-amount succeeded transactions
        // in that window we cannot disambiguate them — leave
        // payment_ref NULL rather than risk binding the activity row
        // to the wrong Stripe intent (which would later cause a refund
        // to reverse the wrong donation).
        const txnRes = await pool.query(
          `SELECT transaction_id
             FROM user_stripe_transaction_mappings
            WHERE user_id = $1
              AND LOWER(status) IN ('succeeded', 'success', 'paid', 'completed')
              AND ROUND(amount::numeric, 2) = ROUND($3::numeric, 2)
              AND created_date >= COALESCE(
                    (SELECT date_created - INTERVAL '24 hours'
                       FROM recommendations WHERE id = $2),
                    NOW() - INTERVAL '24 hours'
                  )
              AND created_date <= COALESCE(
                    (SELECT date_created + INTERVAL '24 hours'
                       FROM recommendations WHERE id = $2),
                    NOW() + INTERVAL '24 hours'
                  )
            LIMIT 2`,
          [investorUserId, triggeringRecommendationId, investmentAmount],
        );
        if (
          txnRes.rows.length === 1 &&
          txnRes.rows[0].transaction_id
        ) {
          paymentRef = `stripe_card_${txnRes.rows[0].transaction_id}`;
        } else if (txnRes.rows.length > 1) {
          console.warn(
            `applyCoverFees: ambiguous Stripe txn match for user=${investorUserId} rec=${triggeringRecommendationId} amount=${investmentAmount}; leaving payment_ref NULL`,
          );
        }
      } catch (lookupErr: unknown) {
        // user_stripe_transaction_mappings is optional; missing table
        // or query error must NOT block the cover-fee application.
        const msg =
          lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        console.warn(
          `applyCoverFees: paymentRef auto-derive skipped: ${msg}`,
        );
      }
    }

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
        paymentRef,
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
  paymentRef?: string;
}): Promise<number> {
  const {
    pool: poolRow,
    campaignId,
    triggeringRecommendationId,
    investmentAmount,
    campaignName,
    paymentRef,
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
          triggered_by_recommendation_id, fee_amount, donation_amount,
          payment_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        poolRow.id,
        campaignId,
        opts.investorUserId,
        triggeringRecommendationId,
        feeAmount,
        investmentAmount,
        paymentRef ?? null,
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

/**
 * Reverse a previously-covered fee in response to a Stripe refund (full or
 * partial). Restores the sponsor pool proportionally, decrements the
 * activity row's amount_used clamp, and inserts a paired
 * "Cover Fees – escrow reversed" row on the donor's Account History sized
 * to the refund.
 *
 * Idempotency: a row is INSERT … ON CONFLICT DO NOTHING'd into
 * cover_fees_refund_reversals BEFORE any side effect; duplicate webhook
 * deliveries are therefore guaranteed no-ops regardless of whether the
 * proportional reversal calculates to >$0.
 *
 * Cumulative cap: reversed_fee_amount on the activity row is updated under
 * a row-level lock so we can never reverse more than was originally
 * covered, even if a stale claim slipped through.
 */
interface ActivityRow {
  id: number;
  cover_fee_id: number;
  campaign_id: number | null;
  triggered_by_user_id: string | null;
  triggered_by_recommendation_id: number | null;
  fee_amount: string;
  donation_amount: string;
  reversed_fee_amount: string;
  fully_reversed_at: string | null;
}

export interface ReverseCoverFeesArgs {
  paymentRef: string;
  refundAmount: number;
  idempotencyKey: string;
  reason?: string;
  client?: PoolClient;
}

export interface ReverseCoverFeesResult {
  reversed: boolean;
  alreadyProcessed: boolean;
  feeReversed: number;
  activityId?: number;
}

export async function reverseCoverFeesByPaymentRef(
  args: ReverseCoverFeesArgs,
): Promise<ReverseCoverFeesResult> {
  const { paymentRef, refundAmount, idempotencyKey, reason } = args;

  if (!paymentRef || !idempotencyKey) {
    return { reversed: false, alreadyProcessed: false, feeReversed: 0 };
  }
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    return { reversed: false, alreadyProcessed: false, feeReversed: 0 };
  }

  const ownClient = !args.client;
  const client = args.client ?? (await pool.connect());
  try {
    if (ownClient) await client.query("BEGIN");

    // ── Locate the activity row backing this payment ──────────────────
    const actRes = await client.query<ActivityRow>(
      `SELECT id, cover_fee_id, campaign_id, triggered_by_user_id,
              triggered_by_recommendation_id, fee_amount, donation_amount,
              reversed_fee_amount, fully_reversed_at
         FROM campaign_cover_fees_activity
        WHERE payment_ref = $1
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE`,
      [paymentRef],
    );
    if (actRes.rows.length === 0) {
      if (ownClient) await client.query("ROLLBACK");
      return { reversed: false, alreadyProcessed: false, feeReversed: 0 };
    }
    const activity = actRes.rows[0];

    // ── Idempotency claim BEFORE any side effect ──────────────────────
    const claimRes = await client.query(
      `INSERT INTO cover_fees_refund_reversals
         (activity_id, refund_idempotency_key, refund_amount,
          fee_reversed_amount, reason)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (activity_id, refund_idempotency_key) DO NOTHING
       RETURNING id`,
      [activity.id, idempotencyKey, refundAmount, reason ?? null],
    );
    if (claimRes.rowCount === 0) {
      if (ownClient) await client.query("ROLLBACK");
      return {
        reversed: false,
        alreadyProcessed: true,
        feeReversed: 0,
        activityId: activity.id,
      };
    }
    const claimId: number = claimRes.rows[0].id;

    // ── Compute proportional fee reversal ─────────────────────────────
    const originalFee = parseFloat(activity.fee_amount) || 0;
    const donationPrincipal = parseFloat(activity.donation_amount) || 0;
    const alreadyReversed = parseFloat(activity.reversed_fee_amount) || 0;
    const remainingFee = Math.max(0, originalFee - alreadyReversed);

    let proportionalFee: number;
    if (originalFee <= 0 || remainingFee <= 0) {
      proportionalFee = 0;
    } else if (donationPrincipal <= 0) {
      // Defensive: if the principal is unknown we cap at the remaining
      // unreversed fee rather than blindly trusting refundAmount.
      proportionalFee = remainingFee;
    } else {
      const raw = (originalFee * refundAmount) / donationPrincipal;
      proportionalFee = Math.min(remainingFee, Math.round(raw * 100) / 100);
    }
    proportionalFee = Math.max(0, Math.round(proportionalFee * 100) / 100);

    if (proportionalFee <= 0) {
      // Idempotency claim still stands so a replay is a no-op, but no
      // side-effects are warranted (rounded to $0 or fully-reversed).
      if (ownClient) await client.query("COMMIT");
      return {
        reversed: true,
        alreadyProcessed: false,
        feeReversed: 0,
        activityId: activity.id,
      };
    }

    // ── Lock the pool row & sponsor for live-wallet credit ────────────
    const poolRes = await client.query(
      `SELECT id, name, sponsor_user_id, reserved_amount, amount_used
         FROM campaign_cover_fees
        WHERE id = $1
        FOR UPDATE`,
      [activity.cover_fee_id],
    );
    if (poolRes.rows.length === 0) {
      if (ownClient) await client.query("ROLLBACK");
      return {
        reversed: false,
        alreadyProcessed: false,
        feeReversed: 0,
        activityId: activity.id,
      };
    }
    const poolRow = poolRes.rows[0];
    const poolName: string =
      poolRow.name || `Pool #${poolRow.id}`;

    // Investment Name displayed in Account History should be the
    // campaign the donor backed, not the cover-fees pool name.
    // The pool name (e.g. "Wildflower Fees") is the sponsor's bucket;
    // donors recognise the campaign name (e.g. "Ode to Wildflowers").
    const campaignNameRes = await client.query(
      `SELECT name FROM campaigns WHERE id = $1`,
      [activity.campaign_id],
    );
    const investmentName: string =
      campaignNameRes.rows[0]?.name || poolName;

    const sponsorRes = await client.query(
      `SELECT id, email, first_name, last_name, user_name, account_balance
         FROM users WHERE id = $1 FOR UPDATE`,
      [poolRow.sponsor_user_id],
    );
    if (sponsorRes.rows.length === 0) {
      if (ownClient) await client.query("ROLLBACK");
      return {
        reversed: false,
        alreadyProcessed: false,
        feeReversed: 0,
        activityId: activity.id,
      };
    }
    const sponsor = sponsorRes.rows[0];
    const sponsorBalance = parseFloat(sponsor.account_balance) || 0;
    const sponsorFullName =
      `${sponsor.first_name || ""} ${sponsor.last_name || ""}`.trim() ||
      sponsor.user_name ||
      "";

    // Credit the sponsor's wallet by the reversed fee. Mirrors the
    // matching debit in applySingleCoverFee (both escrow + live-wallet
    // paths debit the sponsor wallet on application).
    const newSponsorBalance = parseFloat(
      (sponsorBalance + proportionalFee).toFixed(2),
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
        "Cover Fees Sponsorship Reversal",
        // Use the campaign name (what the donor sees) instead of the
        // pool name so admins reading the sponsor's Account History can
        // tie the credit back to a specific investment.
        investmentName,
        activity.campaign_id,
        sponsorBalance,
        sponsor.user_name || sponsorFullName,
        newSponsorBalance,
        // Plain-English: the sponsor was originally debited the fee
        // when the donation cleared; the donation was now refunded by
        // Stripe, so we credit the sponsor back.
        `Refund issued for ${investmentName} – $${proportionalFee.toFixed(2)} cover-fee credit returned to sponsor`,
        proportionalFee,
        0,
        proportionalFee,
      ],
    );

    // ── Decrement pool amount_used (clamped at 0 via GREATEST) ────────
    await client.query(
      `UPDATE campaign_cover_fees
          SET amount_used = GREATEST(0, amount_used - $1),
              updated_at  = NOW()
        WHERE id = $2`,
      [proportionalFee, activity.cover_fee_id],
    );

    // ── Donor-side audit row (informational; donor balance unchanged) ──
    if (activity.triggered_by_user_id) {
      const donorRes = await client.query(
        `SELECT id, user_name, first_name, last_name, account_balance
           FROM users WHERE id = $1`,
        [activity.triggered_by_user_id],
      );
      if (donorRes.rows.length > 0) {
        const donor = donorRes.rows[0];
        const donorBalance = parseFloat(donor.account_balance) || 0;
        const donorName =
          donor.user_name ||
          `${donor.first_name || ""} ${donor.last_name || ""}`.trim();
        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, campaign_id,
              old_value, user_name, new_value, change_date, comment,
              gross_amount, fees, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11)`,
          [
            donor.id,
            COVER_FEES_DONOR_REVERSAL_PAYMENT_TYPE,
            // Show the actual investment / campaign name in the donor's
            // Account History — not the sponsor's pool name.
            investmentName,
            activity.campaign_id,
            donorBalance,
            donorName,
            donorBalance,
            // Plain-English audit row (donor balance is intentionally
            // unchanged — the donor was never charged the fee, the
            // sponsor covered it). This row exists purely so the donor
            // can see in their history that the cover-fees benefit on
            // their refunded donation has been undone.
            `Refund issued for ${investmentName} – $${proportionalFee.toFixed(2)} cover-fees benefit reversed (donor balance unchanged)`,
            proportionalFee,
            0,
            proportionalFee,
          ],
        );
      }
    }

    // ── Update activity bookkeeping cumulatively ──────────────────────
    const newReversed = parseFloat(
      (alreadyReversed + proportionalFee).toFixed(2),
    );
    const stampFullyReversed =
      activity.fully_reversed_at == null && newReversed >= originalFee - 0.005;
    await client.query(
      `UPDATE campaign_cover_fees_activity
          SET reversed_fee_amount  = $1,
              last_reversed_reason = COALESCE($2, last_reversed_reason),
              fully_reversed_at    = CASE
                  WHEN fully_reversed_at IS NOT NULL THEN fully_reversed_at
                  WHEN $3::boolean THEN NOW()
                  ELSE NULL
              END
        WHERE id = $4`,
      [newReversed, reason ?? null, stampFullyReversed, activity.id],
    );

    // ── Update the claim row with the actual reversed amount ──────────
    await client.query(
      `UPDATE cover_fees_refund_reversals
          SET fee_reversed_amount = $1
        WHERE id = $2`,
      [proportionalFee, claimId],
    );

    if (ownClient) await client.query("COMMIT");
    console.log(
      `reverseCoverFeesByPaymentRef: activity ${activity.id} reversed $${proportionalFee} (paymentRef=${paymentRef}, refund=$${refundAmount})`,
    );
    return {
      reversed: true,
      alreadyProcessed: false,
      feeReversed: proportionalFee,
      activityId: activity.id,
    };
  } catch (err: unknown) {
    if (ownClient) await client.query("ROLLBACK").catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `reverseCoverFeesByPaymentRef: error for paymentRef=${paymentRef}: ${msg}`,
    );
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

/**
 * Reverse cover-fees for every activity row triggered by a given
 * recommendation. Used when an admin reverts (rejects) a recommendation
 * — the donor's investment amount is returned to their wallet, and we
 * must also restore the sponsor's pre-funded fee back to the sponsor
 * pool / wallet (parallel-symmetric to the Stripe-refund path).
 *
 * Each activity row is reversed for its FULL remaining unreversed fee
 * (refund_amount = donation_amount of that activity), since the entire
 * donation is being rolled back, not partially refunded. Idempotent:
 * uses cover_fees_refund_reversals with key
 * `recRevert:<recommendationId>` per activity, so a duplicate revert
 * for the same recommendation is a no-op.
 *
 * Accepts an optional caller-owned client so the reversal participates
 * in the same transaction as the recommendation status update — if the
 * outer revert rolls back, so does the cover-fee reversal.
 */
export interface ReverseCoverFeesByRecommendationResult {
  activitiesProcessed: number;
  totalFeeReversed: number;
}

export async function reverseCoverFeesByRecommendation(args: {
  recommendationId: number;
  reason?: string;
  client?: PoolClient;
}): Promise<ReverseCoverFeesByRecommendationResult> {
  const { recommendationId, reason } = args;

  if (!Number.isFinite(recommendationId) || recommendationId <= 0) {
    return { activitiesProcessed: 0, totalFeeReversed: 0 };
  }

  const ownClient = !args.client;
  const client = args.client ?? (await pool.connect());
  let activitiesProcessed = 0;
  let totalFeeReversed = 0;
  try {
    if (ownClient) await client.query("BEGIN");

    // Pull the recommendation's signature so we can also adopt
    // legacy / public-donation activity rows that were inserted
    // without a triggered_by_recommendation_id FK. Same user +
    // campaign + donation amount + still unreversed = safe to claim.
    const recRes = await client.query<{
      user_id: string | null;
      campaign_id: number | null;
      amount: string | null;
      date_created: Date | string | null;
    }>(
      `SELECT user_id, campaign_id, amount, date_created
         FROM recommendations WHERE id = $1`,
      [recommendationId],
    );
    const recRow = recRes.rows[0];
    const recUserId = recRow?.user_id ?? null;
    const recCampaignId = recRow?.campaign_id ?? null;
    const recAmount = recRow?.amount != null ? parseFloat(recRow.amount) : null;
    const recDateCreated = recRow?.date_created ?? null;

    // Step 1: directly-linked activity rows
    const directRes = await client.query<{ id: number }>(
      `SELECT id
         FROM campaign_cover_fees_activity
        WHERE triggered_by_recommendation_id = $1
          AND fully_reversed_at IS NULL
        ORDER BY id ASC`,
      [recommendationId],
    );
    const candidateIds: number[] = directRes.rows.map((r) => r.id);

    // Step 2: best-effort adoption of unlinked legacy rows. Match the
    // OLDEST unreversed, unlinked activity row with the same user +
    // campaign + donation amount. Atomically backfill the FK with the
    // rec id so the same row can never be claimed twice (concurrent
    // reverts of two different recs with identical signatures will
    // race for it; the loser sees 0 rows updated and skips).
    if (
      candidateIds.length === 0 &&
      recUserId &&
      recCampaignId != null &&
      recAmount != null &&
      recAmount > 0
    ) {
      const adoptRes = await client.query<{ id: number }>(
        `UPDATE campaign_cover_fees_activity
            SET triggered_by_recommendation_id = $1
          WHERE id = (
              SELECT id
                FROM campaign_cover_fees_activity
               WHERE triggered_by_recommendation_id IS NULL
                 AND fully_reversed_at IS NULL
                 AND triggered_by_user_id = $2
                 AND campaign_id = $3
                 AND ROUND(donation_amount::numeric, 2)
                     = ROUND($4::numeric, 2)
               ORDER BY id ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
          RETURNING id`,
        [recommendationId, recUserId, recCampaignId, recAmount],
      );
      for (const r of adoptRes.rows) {
        candidateIds.push(r.id);
        console.log(
          `reverseCoverFeesByRecommendation: adopted unlinked activity ${r.id} for rec ${recommendationId} by amount-match (user=${recUserId} campaign=${recCampaignId} amount=${recAmount})`,
        );
      }
    }

    // Step 3: time-window adoption fallback. When the recommendation is
    // funded by a MIX of fresh Stripe charge + existing wallet balance,
    // the cover-fee activity row's `donation_amount` reflects only the
    // freshly-charged portion (e.g. $13,210) while the recommendation
    // amount is the full pledge (e.g. $25,000). Step 2's amount match
    // misses these rows. Fall back to: most-recent unlinked unreversed
    // activity row for the same user + campaign created within ±2 min
    // of the recommendation's date_created. The tight time window keeps
    // this from cross-claiming an unrelated donation; the FOR UPDATE
    // SKIP LOCKED guard prevents two concurrent reverts from racing.
    if (
      candidateIds.length === 0 &&
      recUserId &&
      recCampaignId != null &&
      recDateCreated != null
    ) {
      const adoptByTimeRes = await client.query<{ id: number }>(
        `UPDATE campaign_cover_fees_activity
            SET triggered_by_recommendation_id = $1
          WHERE id = (
              SELECT id
                FROM campaign_cover_fees_activity
               WHERE triggered_by_recommendation_id IS NULL
                 AND fully_reversed_at IS NULL
                 AND triggered_by_user_id = $2
                 AND campaign_id = $3
                 AND created_at BETWEEN
                       ($4::timestamptz - INTERVAL '2 minutes')
                   AND ($4::timestamptz + INTERVAL '2 minutes')
               ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $4::timestamptz))) ASC,
                        id DESC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
          RETURNING id`,
        [recommendationId, recUserId, recCampaignId, recDateCreated],
      );
      for (const r of adoptByTimeRes.rows) {
        candidateIds.push(r.id);
        console.log(
          `reverseCoverFeesByRecommendation: adopted unlinked activity ${r.id} for rec ${recommendationId} by time-match (user=${recUserId} campaign=${recCampaignId} recDate=${recDateCreated})`,
        );
      }
    }

    const idemKey = `recRevert:${recommendationId}`;
    const reasonText = reason ?? `Recommendation #${recommendationId} reverted`;

    for (const activityId of candidateIds) {
      // ── Lock this activity row so concurrent reversals can't race ──
      const actRes = await client.query<ActivityRow>(
        `SELECT id, cover_fee_id, campaign_id, triggered_by_user_id,
                triggered_by_recommendation_id, fee_amount, donation_amount,
                reversed_fee_amount, fully_reversed_at
           FROM campaign_cover_fees_activity
          WHERE id = $1
          FOR UPDATE`,
        [activityId],
      );
      if (actRes.rows.length === 0) continue;
      const activity = actRes.rows[0];
      if (activity.fully_reversed_at != null) continue;

      const donationPrincipal = parseFloat(activity.donation_amount) || 0;

      // ── Idempotency claim BEFORE any side-effect ──────────────────
      const claimRes = await client.query(
        `INSERT INTO cover_fees_refund_reversals
           (activity_id, refund_idempotency_key, refund_amount,
            fee_reversed_amount, reason)
         VALUES ($1, $2, $3, 0, $4)
         ON CONFLICT (activity_id, refund_idempotency_key) DO NOTHING
         RETURNING id`,
        [activity.id, idemKey, donationPrincipal, reasonText],
      );
      if (claimRes.rowCount === 0) {
        // Already reversed for this recommendation revert — skip.
        continue;
      }
      const claimId: number = claimRes.rows[0].id;

      // ── Compute reversal: full remaining unreversed fee ───────────
      const originalFee = parseFloat(activity.fee_amount) || 0;
      const alreadyReversed = parseFloat(activity.reversed_fee_amount) || 0;
      const remainingFee = Math.max(
        0,
        Math.round((originalFee - alreadyReversed) * 100) / 100,
      );

      if (remainingFee <= 0) {
        if (ownClient) {
          // nothing to do for this row, claim still stands as no-op
        }
        continue;
      }

      // ── Lock pool & sponsor for live-wallet credit ────────────────
      const poolRes = await client.query(
        `SELECT id, name, sponsor_user_id, reserved_amount, amount_used
           FROM campaign_cover_fees
          WHERE id = $1
          FOR UPDATE`,
        [activity.cover_fee_id],
      );
      if (poolRes.rows.length === 0) continue;
      const poolRow = poolRes.rows[0];
      const poolName: string = poolRow.name || `Pool #${poolRow.id}`;

      // Investment Name displayed in Account History should be the
      // campaign the donor recommended, not the cover-fees pool name.
      // The pool name (e.g. "Wildflower Fees") is the sponsor's bucket;
      // donors recognise the campaign name (e.g. "Ode to Wildflowers").
      const campaignNameRes = await client.query(
        `SELECT name FROM campaigns WHERE id = $1`,
        [activity.campaign_id],
      );
      const investmentName: string =
        campaignNameRes.rows[0]?.name || poolName;

      const sponsorRes = await client.query(
        `SELECT id, email, first_name, last_name, user_name, account_balance
           FROM users WHERE id = $1 FOR UPDATE`,
        [poolRow.sponsor_user_id],
      );
      if (sponsorRes.rows.length === 0) continue;
      const sponsor = sponsorRes.rows[0];
      const sponsorBalance = parseFloat(sponsor.account_balance) || 0;
      const sponsorFullName =
        `${sponsor.first_name || ""} ${sponsor.last_name || ""}`.trim() ||
        sponsor.user_name ||
        "";

      // Credit the sponsor's wallet by the reversed fee. Mirrors the
      // matching debit in applySingleCoverFee (both escrow + live-wallet
      // paths debit the sponsor wallet on application).
      const newSponsorBalance = parseFloat(
        (sponsorBalance + remainingFee).toFixed(2),
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
          "Cover Fees Sponsorship Reversal",
          // Use the campaign name (what the donor sees) instead of the
          // pool name so admins reading the sponsor's Account History
          // can tie the credit back to a specific investment.
          investmentName,
          activity.campaign_id,
          sponsorBalance,
          sponsor.user_name || sponsorFullName,
          newSponsorBalance,
          // Plain-English: the recommendation that triggered this
          // cover-fee was rejected, so we reverse the original sponsor
          // debit and credit them back the fee amount.
          `Recommendation rejected for ${investmentName} – $${remainingFee.toFixed(2)} cover-fee credit returned to sponsor`,
          remainingFee,
          0,
          remainingFee,
        ],
      );

      // ── Decrement pool amount_used (clamped at 0) ─────────────────
      await client.query(
        `UPDATE campaign_cover_fees
            SET amount_used = GREATEST(0, amount_used - $1),
                updated_at  = NOW()
          WHERE id = $2`,
        [remainingFee, activity.cover_fee_id],
      );

      // ── Donor-side audit row (informational; balance unchanged) ───
      if (activity.triggered_by_user_id) {
        const donorRes = await client.query(
          `SELECT id, user_name, first_name, last_name, account_balance
             FROM users WHERE id = $1`,
          [activity.triggered_by_user_id],
        );
        if (donorRes.rows.length > 0) {
          const donor = donorRes.rows[0];
          const donorBalance = parseFloat(donor.account_balance) || 0;
          const donorName =
            donor.user_name ||
            `${donor.first_name || ""} ${donor.last_name || ""}`.trim();
          await client.query(
            `INSERT INTO account_balance_change_logs
               (user_id, payment_type, investment_name, campaign_id,
                old_value, user_name, new_value, change_date, comment,
                gross_amount, fees, net_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11)`,
            [
              donor.id,
              COVER_FEES_DONOR_REVERSAL_PAYMENT_TYPE,
              // Show the actual investment / campaign name in the
              // donor's Account History — not the sponsor's pool name.
              investmentName,
              activity.campaign_id,
              donorBalance,
              donorName,
              donorBalance,
              // Plain-English audit row (donor balance is intentionally
              // unchanged — the donor was never charged the fee, the
              // sponsor covered it). This row exists purely so the
              // donor can see in their history that the cover-fees
              // benefit on their rejected recommendation was undone.
              `Recommendation rejected for ${investmentName} – $${remainingFee.toFixed(2)} cover-fees benefit reversed (donor balance unchanged)`,
              remainingFee,
              0,
              remainingFee,
            ],
          );
        }
      }

      // ── Update activity bookkeeping; fully reverse this row ───────
      const newReversed = parseFloat(
        (alreadyReversed + remainingFee).toFixed(2),
      );
      await client.query(
        `UPDATE campaign_cover_fees_activity
            SET reversed_fee_amount  = $1,
                last_reversed_reason = $2,
                fully_reversed_at    = COALESCE(fully_reversed_at, NOW())
          WHERE id = $3`,
        [newReversed, reasonText, activity.id],
      );

      // ── Update claim with actual reversed amount ──────────────────
      await client.query(
        `UPDATE cover_fees_refund_reversals
            SET fee_reversed_amount = $1
          WHERE id = $2`,
        [remainingFee, claimId],
      );

      activitiesProcessed += 1;
      totalFeeReversed = parseFloat(
        (totalFeeReversed + remainingFee).toFixed(2),
      );
      console.log(
        `reverseCoverFeesByRecommendation: rec ${recommendationId} → activity ${activity.id} reversed $${remainingFee}`,
      );
    }

    if (ownClient) await client.query("COMMIT");
    return { activitiesProcessed, totalFeeReversed };
  } catch (err: unknown) {
    if (ownClient) await client.query("ROLLBACK").catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `reverseCoverFeesByRecommendation: error for rec=${recommendationId}: ${msg}`,
    );
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}
