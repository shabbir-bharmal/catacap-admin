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

    // Single-cover policy + double-draw guard: a given recommendation's
    // 5% fee is only ever covered by ONE pool, total. If ANY active
    // activity row already exists for this recommendation (e.g. it was
    // just converted from 'held' to 'applied' by the Pending->In Transit
    // flow, or the legacy path already covered it via another pool),
    // OR if ANY (pool, recommendation) pair was tombstoned by an admin
    // cancel for this rec, return immediately. Per-pool filtering is
    // insufficient because overlapping pools would otherwise each draw
    // for the same rec on a subsequent invocation.
    const guardResult = await pool.query(
      `SELECT 1
         FROM campaign_cover_fees_activity
        WHERE triggered_by_recommendation_id = $1
          AND fully_reversed_at IS NULL
        LIMIT 1`,
      [triggeringRecommendationId],
    );
    if (guardResult.rows.length > 0) return;

    const tombstoneResult = await pool.query(
      `SELECT 1
         FROM canceled_cover_fees_pairs
        WHERE triggered_by_recommendation_id = $1
        LIMIT 1`,
      [triggeringRecommendationId],
    );
    if (tombstoneResult.rows.length > 0) return;

    // Single-cover policy: a given donation's 5% fee is only ever
    // covered by ONE pool. Walk pools in deterministic order and stop
    // after the first one that successfully covers (>0). Without this,
    // overlapping pools on the same campaign would each debit the same
    // recommendation, double/triple-counting the fee against sponsors.
    for (const p of poolsResult.rows) {
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

    // Outstanding escrow held against still-Pending requests (hold-on-create).
    // Subtracted from available so we don't overcommit the pool between the
    // moment a hold is placed and the moment it converts to applied.
    const heldRes = await client.query(
      `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS held_sum
         FROM campaign_cover_fees_activity
        WHERE cover_fee_id = $1
          AND status = 'held'
          AND fully_reversed_at IS NULL`,
      [poolRow.id],
    );
    const heldSum = parseFloat(heldRes.rows[0]?.held_sum || "0") || 0;

    // ── Available budget (recomputed under lock) ─────────────────────
    let availableBudget: number;
    if (isEscrow) {
      availableBudget = Math.max(0, reserved - amountUsed - heldSum);
    } else if (locked.total_cap != null) {
      availableBudget = Math.max(
        0,
        parseFloat(locked.total_cap) - amountUsed - heldSum,
      );
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
      // Escrow pools: the sponsor's wallet was already debited at funding
      // time (when reserved_amount was committed via reserveCapFromWallet).
      // Donor fees draw down ONLY against the pool's escrow balance — they
      // do NOT touch the sponsor's wallet again, otherwise the sponsor
      // would be double-debited. The Account-History row's Old / New
      // columns show the POOL's escrow remaining (reserved − amount_used)
      // before and after this fee, matching the "$X remaining" figure
      // admins see on the Cover Fees page.
      const poolRemainingBefore = parseFloat(
        (reserved - amountUsed).toFixed(2),
      );
      const poolRemainingAfter = parseFloat(
        (reserved - amountUsed - feeAmount).toFixed(2),
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
          poolRemainingBefore,
          sponsor.user_name || sponsorFullName,
          poolRemainingAfter,
          `$${feeAmount.toFixed(2)} fee covered from escrow via pool "${poolRow.name || `Pool #${poolRow.id}`}" (sponsor wallet unchanged)`,
          feeAmount,
          0,
          feeAmount,
        ],
      );
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
    const poolReservedAmount = parseFloat(poolRow.reserved_amount) || 0;
    const poolAmountUsed = parseFloat(poolRow.amount_used) || 0;

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
    const isEscrowPoolReversal = poolReservedAmount > 0;

    // Credit the sponsor's wallet by the reversed fee ONLY for live-wallet
    // pools, mirroring the matching debit in applySingleCoverFee. Escrow
    // pools never re-debit the sponsor's wallet on apply, so we must not
    // credit it on reversal either — the reversal returns the fee to the
    // pool's escrow only (amount_used decrement below).
    let newSponsorBalance = sponsorBalance;
    if (!isEscrowPoolReversal) {
      newSponsorBalance = parseFloat(
        (sponsorBalance + proportionalFee).toFixed(2),
      );
      await client.query(
        `UPDATE users SET account_balance = $1 WHERE id = $2`,
        [newSponsorBalance, sponsor.id],
      );
    }

    // ── Decrement pool amount_used (clamped at 0 via GREATEST) ────────
    await client.query(
      `UPDATE campaign_cover_fees
          SET amount_used = GREATEST(0, amount_used - $1),
              updated_at  = NOW()
        WHERE id = $2`,
      [proportionalFee, activity.cover_fee_id],
    );

    // ── Donor-side audit row (informational; donor wallet unchanged) ──
    // For escrow-backed pools (`reserved_amount > 0`), the Old / New
    // value columns reflect the POOL's escrow remaining
    // (`reserved_amount − amount_used`) before and after the reversal,
    // matching the "$X remaining" figure admins see on the Cover Fees
    // page. For live-wallet (non-escrow) pools the Old / New columns
    // continue to mirror the sponsor's wallet movement, since there is
    // no escrow remaining to reference. The sponsor's wallet really is
    // credited back (see UPDATE above), but we intentionally do NOT
    // write a sponsor-side audit row — that reversal is already
    // recorded on the cover-pools revert table, and a duplicate
    // Account-History entry would confuse admins. The donor's actual
    // wallet is NOT touched by this row.
    if (activity.triggered_by_user_id) {
      const donorRes = await client.query(
        `SELECT id, user_name, first_name, last_name, account_balance
           FROM users WHERE id = $1`,
        [activity.triggered_by_user_id],
      );
      if (donorRes.rows.length > 0) {
        const donor = donorRes.rows[0];
        const donorName =
          donor.user_name ||
          `${donor.first_name || ""} ${donor.last_name || ""}`.trim();
        const isEscrowPool = poolReservedAmount > 0;
        const poolRemainingBefore = parseFloat(
          (poolReservedAmount - poolAmountUsed).toFixed(2),
        );
        // amount_used is decremented by `proportionalFee` and clamped at
        // 0, so the actual decrement may be smaller if the pool already
        // had less than `proportionalFee` used.
        const actualPoolDecrement = Math.min(poolAmountUsed, proportionalFee);
        const poolRemainingAfter = parseFloat(
          (poolRemainingBefore + actualPoolDecrement).toFixed(2),
        );
        const donorOldValue = isEscrowPool ? poolRemainingBefore : sponsorBalance;
        const donorNewValue = isEscrowPool ? poolRemainingAfter : newSponsorBalance;
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
            // Old/New = pool's escrow remaining before/after the
            // reversal for escrow pools (matches the "$X remaining" on
            // Cover Fees page); for live-wallet pools, sponsor wallet
            // before/after the credit-back.
            donorOldValue,
            donorName,
            donorNewValue,
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
      const poolReservedAmount = parseFloat(poolRow.reserved_amount) || 0;
      const poolAmountUsed = parseFloat(poolRow.amount_used) || 0;

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
      const isEscrowPoolReversal = poolReservedAmount > 0;

      // Credit the sponsor's wallet by the reversed fee ONLY for
      // live-wallet pools, mirroring the matching debit in
      // applySingleCoverFee. Escrow pools never re-debit the sponsor's
      // wallet on apply, so we must not credit it on reversal either —
      // the reversal returns the fee to the pool's escrow only
      // (amount_used decrement below).
      let newSponsorBalance = sponsorBalance;
      if (!isEscrowPoolReversal) {
        newSponsorBalance = parseFloat(
          (sponsorBalance + remainingFee).toFixed(2),
        );
        await client.query(
          `UPDATE users SET account_balance = $1 WHERE id = $2`,
          [newSponsorBalance, sponsor.id],
        );
      }

      // ── Decrement pool amount_used (clamped at 0) ─────────────────
      await client.query(
        `UPDATE campaign_cover_fees
            SET amount_used = GREATEST(0, amount_used - $1),
                updated_at  = NOW()
          WHERE id = $2`,
        [remainingFee, activity.cover_fee_id],
      );

      // ── Donor-side audit row (informational; donor wallet unchanged) ───
      // For escrow-backed pools (`reserved_amount > 0`), the Old / New
      // value columns reflect the POOL's escrow remaining
      // (`reserved_amount − amount_used`) before and after the
      // reversal, matching the "$X remaining" figure admins see on the
      // Cover Fees page. For live-wallet (non-escrow) pools the Old /
      // New columns continue to mirror the sponsor's wallet movement,
      // since there is no escrow remaining to reference. The sponsor's
      // wallet really is credited back (see UPDATE above), but we
      // intentionally do NOT write a sponsor-side audit row — that
      // reversal is already recorded on the cover-pools revert table,
      // and a duplicate Account-History entry would confuse admins.
      // The donor's actual wallet is NOT touched by this row.
      if (activity.triggered_by_user_id) {
        const donorRes = await client.query(
          `SELECT id, user_name, first_name, last_name, account_balance
             FROM users WHERE id = $1`,
          [activity.triggered_by_user_id],
        );
        if (donorRes.rows.length > 0) {
          const donor = donorRes.rows[0];
          const donorName =
            donor.user_name ||
            `${donor.first_name || ""} ${donor.last_name || ""}`.trim();
          const isEscrowPool = poolReservedAmount > 0;
          const poolRemainingBefore = parseFloat(
            (poolReservedAmount - poolAmountUsed).toFixed(2),
          );
          // amount_used is decremented by `remainingFee` and clamped at
          // 0, so the actual decrement may be smaller if the pool had
          // less than `remainingFee` used.
          const actualPoolDecrement = Math.min(poolAmountUsed, remainingFee);
          const poolRemainingAfter = parseFloat(
            (poolRemainingBefore + actualPoolDecrement).toFixed(2),
          );
          const donorOldValue = isEscrowPool ? poolRemainingBefore : sponsorBalance;
          const donorNewValue = isEscrowPool ? poolRemainingAfter : newSponsorBalance;
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
              // Old/New = pool's escrow remaining before/after for
              // escrow pools (matches the "$X remaining" on Cover Fees
              // page); for live-wallet pools, sponsor wallet
              // before/after the credit-back.
              donorOldValue,
              donorName,
              donorNewValue,
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


// ════════════════════════════════════════════════════════════════════════════
// HOLD-ON-CREATE SUPPORT (Pending Grants + Other Assets)
// ════════════════════════════════════════════════════════════════════════════
//
// Lifecycle:
//   create  -> holdCoverFeeForRequest()           (status='held')
//   In Tx   -> convertHeldCoverFeeToApplied()     ('held' -> 'applied')
//   cancel  -> releaseHeldCoverFeeForRequest()    (delete 'held' rows)
//   reject  -> reverseAppliedCoverFeeForRequest() (reverse 'applied' rows)
//
// All helpers accept an optional `client` so the caller can run them
// inside its own status-change transaction. When `client` is omitted the
// helper opens its own connection and wraps the work in a transaction.
//
// Holds reserve pool capacity WITHOUT incrementing pool.amount_used.
// Every "remaining" computation (here and in pendingCoverFees.ts)
// subtracts the SUM of outstanding held escrow alongside amount_used.

export type CoverFeeRequestKind = "pending_grant" | "other_asset";

function requestFkColumn(kind: CoverFeeRequestKind): string {
  return kind === "pending_grant"
    ? "triggered_by_pending_grant_id"
    : "triggered_by_asset_based_payment_request_id";
}

async function withTxn<T>(
  provided: PoolClient | undefined,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  if (provided) return fn(provided);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function writeSponsorEscrowLog(
  client: PoolClient,
  args: {
    sponsorUserId: string;
    campaignId: number | null;
    campaignName: string;
    poolName: string;
    poolId: number;
    feeAmount: number;
    remainingBefore: number;
    remainingAfter: number;
    action: "held" | "released" | "applied" | "reversed";
  },
): Promise<void> {
  const sponsorRes = await client.query(
    `SELECT id, user_name, first_name, last_name FROM users WHERE id = $1`,
    [args.sponsorUserId],
  );
  if (sponsorRes.rows.length === 0) return;
  const sponsor = sponsorRes.rows[0];
  const sponsorFullName =
    `${sponsor.first_name || ""} ${sponsor.last_name || ""}`.trim() ||
    sponsor.user_name ||
    "";

  const paymentTypeMap = {
    held: "Cover Fees – escrow held",
    released: "Cover Fees – escrow released",
    applied: "Cover Fees – escrow applied",
    reversed: "Cover Fees – escrow reversed",
  } as const;
  const commentMap = {
    held: `$${args.feeAmount.toFixed(2)} reserved (held) in pool "${args.poolName}" pending donation completion`,
    released: `$${args.feeAmount.toFixed(2)} hold released back to pool "${args.poolName}" (donation canceled / rejected)`,
    applied: `$${args.feeAmount.toFixed(2)} fee covered from escrow via pool "${args.poolName}" (sponsor wallet unchanged)`,
    reversed: `$${args.feeAmount.toFixed(2)} fee reversed back to pool "${args.poolName}" (donation rejected after In Transit)`,
  } as const;

  await client.query(
    `INSERT INTO account_balance_change_logs
       (user_id, payment_type, investment_name, campaign_id,
        old_value, user_name, new_value, change_date, comment,
        gross_amount, fees, net_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11)`,
    [
      sponsor.id,
      paymentTypeMap[args.action],
      args.campaignName,
      args.campaignId,
      args.remainingBefore,
      sponsor.user_name || sponsorFullName,
      args.remainingAfter,
      commentMap[args.action],
      args.feeAmount,
      0,
      args.feeAmount,
    ],
  );
}

/**
 * Place a 'held' activity row against the first eligible pool for a
 * Pending pending_grant / asset request. Idempotent — re-invoking for a
 * request that already has an active activity row (held or applied)
 * for any pool is a no-op.
 *
 * Writes a "Cover Fees – escrow held" row on the sponsor's
 * account_balance_change_logs so admins can audit when capacity was
 * reserved.
 */
export async function holdCoverFeeForRequest(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
  campaignId: number;
  donorUserId: string | null;
  donationAmount: number;
  triggerDate?: Date | string | null;
  client?: PoolClient;
}): Promise<number> {
  const { requestKind, requestId, campaignId, donorUserId, donationAmount } = args;
  if (!Number.isFinite(requestId) || !Number.isFinite(campaignId)) return 0;
  if (donationAmount <= 0) return 0;

  const fkCol = requestFkColumn(requestKind);

  return withTxn(args.client, async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM campaign_cover_fees_activity
        WHERE ${fkCol} = $1
          AND fully_reversed_at IS NULL
        LIMIT 1`,
      [requestId],
    );
    if (existing.rows.length > 0) return 0;

    let triggerDateParam: Date | null = null;
    if (args.triggerDate instanceof Date) {
      triggerDateParam = args.triggerDate;
    } else if (typeof args.triggerDate === "string" && args.triggerDate) {
      const parsed = new Date(args.triggerDate);
      triggerDateParam = Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const campRes = await client.query(
      `SELECT name FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    const campaignName = campRes.rows[0]?.name || "";

    const poolsResult = await client.query(
      `SELECT ccf.id
         FROM campaign_cover_fees ccf
         JOIN campaign_cover_fees_campaigns ccfc
              ON ccfc.cover_fee_id = ccf.id AND ccfc.campaign_id = $1
        WHERE ccf.is_active = TRUE
          AND COALESCE(ccf.cover_initial_fee, TRUE) = TRUE
          AND (ccf.expires_at IS NULL OR ccf.expires_at > NOW())
          AND (ccf.reserved_amount IS NOT NULL
               AND ccf.reserved_amount::numeric > 0)
          AND ccf.coverage_active_from <= COALESCE($2::timestamp, NOW())
        ORDER BY ccf.id ASC`,
      [campaignId, triggerDateParam],
    );

    for (const p of poolsResult.rows) {
      const lockedRes = await client.query(
        `SELECT id, name, sponsor_user_id, reserved_amount, amount_used,
                fee_rate, per_investment_cap
           FROM campaign_cover_fees WHERE id = $1 FOR UPDATE`,
        [p.id],
      );
      if (lockedRes.rows.length === 0) continue;
      const locked = lockedRes.rows[0];

      const reserved = parseFloat(locked.reserved_amount) || 0;
      const used = parseFloat(locked.amount_used) || 0;

      const heldRes = await client.query(
        `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS held_sum
           FROM campaign_cover_fees_activity
          WHERE cover_fee_id = $1
            AND status = 'held'
            AND fully_reversed_at IS NULL`,
        [p.id],
      );
      const heldSum = parseFloat(heldRes.rows[0]?.held_sum || "0") || 0;

      const available = Math.max(0, reserved - used - heldSum);
      if (available <= 0) continue;

      const feeRate = parseFloat(locked.fee_rate) || COVER_FEE_RATE;
      let feeAmount = donationAmount * feeRate;
      if (locked.per_investment_cap != null) {
        feeAmount = Math.min(feeAmount, parseFloat(locked.per_investment_cap));
      }
      feeAmount = Math.min(feeAmount, available);
      feeAmount = Math.round(feeAmount * 100) / 100;
      if (feeAmount <= 0) continue;

      try {
        await client.query(
          `INSERT INTO campaign_cover_fees_activity
             (cover_fee_id, campaign_id, triggered_by_user_id,
              triggered_by_recommendation_id, ${fkCol},
              fee_amount, donation_amount, status)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, 'held')`,
          [p.id, campaignId, donorUserId, requestId, feeAmount, donationAmount],
        );
      } catch (err: any) {
        if (err?.code === "23505") return 0; // race: someone else placed it
        throw err;
      }

      const remainingBefore = parseFloat((reserved - used - heldSum).toFixed(2));
      const remainingAfter = parseFloat((reserved - used - heldSum - feeAmount).toFixed(2));
      await writeSponsorEscrowLog(client, {
        sponsorUserId: locked.sponsor_user_id,
        campaignId,
        campaignName,
        poolName: locked.name || `Pool #${locked.id}`,
        poolId: locked.id,
        feeAmount,
        remainingBefore,
        remainingAfter,
        action: "held",
      });

      console.log(
        `holdCoverFeeForRequest: pool ${p.id} held $${feeAmount} for ${requestKind} ${requestId}`,
      );
      return feeAmount;
    }

    return 0;
  });
}

/**
 * Flip an existing 'held' activity row to 'applied', increment
 * pool.amount_used, write the donor / sponsor account-history row, and
 * optionally backfill the triggering recommendation FK. Returns the
 * converted fee amount (0 if no held row existed).
 */
export async function convertHeldCoverFeeToApplied(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
  triggeringRecommendationId?: number | null;
  campaignName?: string;
  client?: PoolClient;
}): Promise<number> {
  const { requestKind, requestId, triggeringRecommendationId, campaignName } = args;
  if (!Number.isFinite(requestId)) return 0;
  const fkCol = requestFkColumn(requestKind);

  return withTxn(args.client, async (client) => {
    const heldRes = await client.query(
      `SELECT a.id, a.cover_fee_id, a.campaign_id, a.fee_amount,
              ccf.name AS pool_name, ccf.sponsor_user_id,
              ccf.reserved_amount, ccf.amount_used
         FROM campaign_cover_fees_activity a
         JOIN campaign_cover_fees ccf ON ccf.id = a.cover_fee_id
        WHERE a.${fkCol} = $1
          AND a.status = 'held'
          AND a.fully_reversed_at IS NULL
        FOR UPDATE OF a, ccf`,
      [requestId],
    );
    if (heldRes.rows.length === 0) return 0;

    let totalConverted = 0;
    for (const row of heldRes.rows) {
      const feeAmount = parseFloat(row.fee_amount) || 0;
      if (feeAmount <= 0) continue;

      const reserved = parseFloat(row.reserved_amount) || 0;
      const used = parseFloat(row.amount_used) || 0;
      // Held -> Applied is a net-zero move on Remaining: held_sum drops
      // by feeAmount and amount_used grows by feeAmount in the same txn.
      // Include this hold's feeAmount in the "before" picture so the
      // audit log accurately reflects that conversion does NOT decrease
      // Remaining (only Pending->In Transit reclassification).
      const heldSumRes = await client.query(
        `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS s
           FROM campaign_cover_fees_activity
          WHERE cover_fee_id = $1
            AND status = 'held'
            AND fully_reversed_at IS NULL`,
        [row.cover_fee_id],
      );
      const heldSum = parseFloat(heldSumRes.rows[0]?.s || "0") || 0;
      const remainingBefore = parseFloat((reserved - used - heldSum).toFixed(2));
      const remainingAfter = remainingBefore;

      if (triggeringRecommendationId) {
        await client.query(
          `UPDATE campaign_cover_fees_activity
              SET status = 'applied',
                  triggered_by_recommendation_id =
                      COALESCE(triggered_by_recommendation_id, $2)
            WHERE id = $1`,
          [row.id, triggeringRecommendationId],
        );
      } else {
        await client.query(
          `UPDATE campaign_cover_fees_activity SET status = 'applied' WHERE id = $1`,
          [row.id],
        );
      }

      await client.query(
        `UPDATE campaign_cover_fees
            SET amount_used = amount_used + $1, updated_at = NOW()
          WHERE id = $2`,
        [feeAmount, row.cover_fee_id],
      );

      await writeSponsorEscrowLog(client, {
        sponsorUserId: row.sponsor_user_id,
        campaignId: row.campaign_id,
        campaignName: campaignName || "",
        poolName: row.pool_name || `Pool #${row.cover_fee_id}`,
        poolId: row.cover_fee_id,
        feeAmount,
        remainingBefore,
        remainingAfter,
        action: "applied",
      });

      totalConverted += feeAmount;
      console.log(
        `convertHeldCoverFeeToApplied: activity ${row.id} (pool ${row.cover_fee_id}) flipped held -> applied $${feeAmount} for ${requestKind} ${requestId}`,
      );
    }

    return Math.round(totalConverted * 100) / 100;
  });
}

/**
 * Delete active 'held' activity rows for a request and write an
 * "escrow released" audit row per pool. Used on Pending -> Rejected
 * (or soft-delete) when the cover-fee was never drawn.
 */
export async function releaseHeldCoverFeeForRequest(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
  client?: PoolClient;
}): Promise<number> {
  const { requestKind, requestId } = args;
  if (!Number.isFinite(requestId)) return 0;
  const fkCol = requestFkColumn(requestKind);

  return withTxn(args.client, async (client) => {
    const heldRes = await client.query(
      `SELECT a.id, a.cover_fee_id, a.campaign_id, a.fee_amount,
              ccf.name AS pool_name, ccf.sponsor_user_id,
              ccf.reserved_amount, ccf.amount_used,
              c.name AS campaign_name
         FROM campaign_cover_fees_activity a
         JOIN campaign_cover_fees ccf ON ccf.id = a.cover_fee_id
         LEFT JOIN campaigns c ON c.id = a.campaign_id
        WHERE a.${fkCol} = $1
          AND a.status = 'held'
          AND a.fully_reversed_at IS NULL
        FOR UPDATE OF a, ccf`,
      [requestId],
    );
    if (heldRes.rows.length === 0) return 0;

    let released = 0;
    for (const row of heldRes.rows) {
      const feeAmount = parseFloat(row.fee_amount) || 0;
      const reserved = parseFloat(row.reserved_amount) || 0;
      const used = parseFloat(row.amount_used) || 0;

      // Total held BEFORE we delete this row (pool currently reflects
      // it as held). Re-query so concurrent holds on other requests are
      // accounted for.
      const heldSumRes = await client.query(
        `SELECT COALESCE(SUM(fee_amount::numeric), 0) AS s
           FROM campaign_cover_fees_activity
          WHERE cover_fee_id = $1 AND status = 'held' AND fully_reversed_at IS NULL`,
        [row.cover_fee_id],
      );
      const heldSum = parseFloat(heldSumRes.rows[0]?.s || "0") || 0;
      const remainingBefore = parseFloat((reserved - used - heldSum).toFixed(2));
      const remainingAfter = parseFloat((reserved - used - heldSum + feeAmount).toFixed(2));

      await client.query(`DELETE FROM campaign_cover_fees_activity WHERE id = $1`, [row.id]);

      await writeSponsorEscrowLog(client, {
        sponsorUserId: row.sponsor_user_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || "",
        poolName: row.pool_name || `Pool #${row.cover_fee_id}`,
        poolId: row.cover_fee_id,
        feeAmount,
        remainingBefore,
        remainingAfter,
        action: "released",
      });

      released += 1;
    }

    console.log(
      `releaseHeldCoverFeeForRequest: released ${released} hold(s) for ${requestKind} ${requestId}`,
    );
    return released;
  });
}

/**
 * Reverse an already-'applied' cover-fee activity row in response to a
 * Pending/In-Transit -> Rejected (or soft-delete) transition. Mirrors
 * reverseCoverFeesByRecommendation's semantics but keyed by request FK
 * (since Other Assets may not have a recommendation yet at In Transit).
 *
 * - Decrements pool.amount_used by the remaining (un-reversed) fee.
 * - Marks the activity row fully_reversed_at = NOW(), reversed_fee_amount = fee_amount.
 * - Writes a paired sponsor "escrow reversed" account-history row.
 */
export async function reverseAppliedCoverFeeForRequest(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
  client?: PoolClient;
}): Promise<number> {
  const { requestKind, requestId } = args;
  if (!Number.isFinite(requestId)) return 0;
  const fkCol = requestFkColumn(requestKind);

  return withTxn(args.client, async (client) => {
    let appliedRes = await client.query(
      `SELECT a.id, a.cover_fee_id, a.campaign_id, a.fee_amount,
              a.reversed_fee_amount,
              ccf.name AS pool_name, ccf.sponsor_user_id,
              ccf.reserved_amount, ccf.amount_used,
              c.name AS campaign_name
         FROM campaign_cover_fees_activity a
         JOIN campaign_cover_fees ccf ON ccf.id = a.cover_fee_id
         LEFT JOIN campaigns c ON c.id = a.campaign_id
        WHERE a.${fkCol} = $1
          AND a.status = 'applied'
          AND a.fully_reversed_at IS NULL
        FOR UPDATE OF a, ccf`,
      [requestId],
    );

    // Legacy fallback: pre-feature 'applied' rows may have only
    // triggered_by_recommendation_id set (no request FK). If the
    // request-FK lookup returned nothing, fall back to walking the
    // recommendation(s) tied to this request and reversing any active
    // applied rows on that linkage. Only meaningful for pending_grants
    // today (recommendations.pending_grants_id); other-asset rec
    // creation already runs the request-FK backfill so there is no
    // separate column to fall back through.
    if (appliedRes.rows.length === 0 && requestKind === "pending_grant") {
      appliedRes = await client.query(
        `SELECT a.id, a.cover_fee_id, a.campaign_id, a.fee_amount,
                a.reversed_fee_amount,
                ccf.name AS pool_name, ccf.sponsor_user_id,
                ccf.reserved_amount, ccf.amount_used,
                c.name AS campaign_name
           FROM campaign_cover_fees_activity a
           JOIN campaign_cover_fees ccf ON ccf.id = a.cover_fee_id
           JOIN recommendations r ON r.id = a.triggered_by_recommendation_id
           LEFT JOIN campaigns c ON c.id = a.campaign_id
          WHERE r.pending_grants_id = $1
            AND COALESCE(r.is_deleted, false) = false
            AND a.status = 'applied'
            AND a.fully_reversed_at IS NULL
          FOR UPDATE OF a, ccf`,
        [requestId],
      );
    }

    if (appliedRes.rows.length === 0) return 0;

    let totalReversed = 0;
    for (const row of appliedRes.rows) {
      const feeAmount = parseFloat(row.fee_amount) || 0;
      const alreadyReversed = parseFloat(row.reversed_fee_amount) || 0;
      const remainingFee = Math.max(0, feeAmount - alreadyReversed);
      if (remainingFee <= 0) {
        await client.query(
          `UPDATE campaign_cover_fees_activity
              SET fully_reversed_at = NOW() WHERE id = $1`,
          [row.id],
        );
        continue;
      }

      const reserved = parseFloat(row.reserved_amount) || 0;
      const used = parseFloat(row.amount_used) || 0;
      const remainingBefore = parseFloat((reserved - used).toFixed(2));
      const remainingAfter = parseFloat((reserved - used + remainingFee).toFixed(2));

      await client.query(
        `UPDATE campaign_cover_fees
            SET amount_used = GREATEST(0, amount_used - $1),
                updated_at = NOW()
          WHERE id = $2`,
        [remainingFee, row.cover_fee_id],
      );

      await client.query(
        `UPDATE campaign_cover_fees_activity
            SET reversed_fee_amount = $2,
                fully_reversed_at = NOW()
          WHERE id = $1`,
        [row.id, feeAmount],
      );

      await writeSponsorEscrowLog(client, {
        sponsorUserId: row.sponsor_user_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || "",
        poolName: row.pool_name || `Pool #${row.cover_fee_id}`,
        poolId: row.cover_fee_id,
        feeAmount: remainingFee,
        remainingBefore,
        remainingAfter,
        action: "reversed",
      });

      totalReversed += remainingFee;
      console.log(
        `reverseAppliedCoverFeeForRequest: activity ${row.id} (pool ${row.cover_fee_id}) reversed $${remainingFee} for ${requestKind} ${requestId}`,
      );
    }

    return Math.round(totalReversed * 100) / 100;
  });
}

/**
 * Backfill triggered_by_recommendation_id on an already-applied row
 * when the rec is created strictly after the row was applied (Other
 * Assets In Transit -> Received). Idempotent.
 */
export async function backfillRecommendationLinkForRequest(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
  triggeringRecommendationId: number;
  client?: PoolClient;
}): Promise<number> {
  const { requestKind, requestId, triggeringRecommendationId } = args;
  if (!Number.isFinite(requestId) || !Number.isFinite(triggeringRecommendationId)) return 0;
  const fkCol = requestFkColumn(requestKind);

  const querier = args.client ?? pool;
  const result = await querier.query(
    `UPDATE campaign_cover_fees_activity
        SET triggered_by_recommendation_id = $2
      WHERE ${fkCol} = $1
        AND triggered_by_recommendation_id IS NULL
        AND fully_reversed_at IS NULL`,
    [requestId, triggeringRecommendationId],
  );
  return result.rowCount ?? 0;
}

/**
 * Bounded on-demand reconciliation: place 'held' rows for every Pending
 * request that doesn't yet have an active activity row. Called from
 * GET /api/admin/cover-fees so admin readouts reflect reality even for
 * requests created by the legacy .NET backend before the next runtime
 * touch-point. Each per-request hold uses its own transaction so a
 * single failure can't cascade.
 */
export async function reconcilePendingHoldsForAllPools(): Promise<{
  pendingGrants: number;
  otherAssets: number;
}> {
  const summary = { pendingGrants: 0, otherAssets: 0 };

  try {
    const pgRes = await pool.query(
      `SELECT pg.id, pg.campaign_id, pg.user_id,
              COALESCE(NULLIF(pg.amount, ''), '0')::numeric AS amount,
              pg.created_date
         FROM pending_grants pg
        WHERE COALESCE(pg.is_deleted, false) = false
          AND LOWER(TRIM(COALESCE(pg.status, ''))) = 'pending'
          AND COALESCE(NULLIF(pg.amount, ''), '0')::numeric > 0
          AND NOT EXISTS (
              SELECT 1 FROM campaign_cover_fees_activity a
               WHERE a.triggered_by_pending_grant_id = pg.id
                 AND a.fully_reversed_at IS NULL
          )
        ORDER BY pg.created_date ASC NULLS LAST, pg.id ASC
        LIMIT 500`,
    );

    for (const r of pgRes.rows) {
      try {
        const placed = await holdCoverFeeForRequest({
          requestKind: "pending_grant",
          requestId: Number(r.id),
          campaignId: Number(r.campaign_id),
          donorUserId: r.user_id || null,
          donationAmount: parseFloat(r.amount) || 0,
          triggerDate: r.created_date || null,
        });
        if (placed > 0) summary.pendingGrants += 1;
      } catch (err: any) {
        console.error(
          `reconcilePendingHoldsForAllPools: pending_grant ${r.id} failed:`,
          err?.message || err,
        );
      }
    }

    const abprRes = await pool.query(
      `SELECT abpr.id, abpr.campaign_id, abpr.user_id,
              COALESCE(abpr.approximate_amount, 0)::numeric AS amount,
              abpr.created_at
         FROM asset_based_payment_requests abpr
        WHERE COALESCE(abpr.is_deleted, false) = false
          AND LOWER(TRIM(COALESCE(abpr.status, ''))) = 'pending'
          AND COALESCE(abpr.approximate_amount, 0)::numeric > 0
          AND abpr.campaign_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM campaign_cover_fees_activity a
               WHERE a.triggered_by_asset_based_payment_request_id = abpr.id
                 AND a.fully_reversed_at IS NULL
          )
        ORDER BY abpr.created_at ASC NULLS LAST, abpr.id ASC
        LIMIT 500`,
    );

    for (const r of abprRes.rows) {
      try {
        const placed = await holdCoverFeeForRequest({
          requestKind: "other_asset",
          requestId: Number(r.id),
          campaignId: Number(r.campaign_id),
          donorUserId: r.user_id || null,
          donationAmount: parseFloat(r.amount) || 0,
          triggerDate: r.created_at || null,
        });
        if (placed > 0) summary.otherAssets += 1;
      } catch (err: any) {
        console.error(
          `reconcilePendingHoldsForAllPools: other_asset ${r.id} failed:`,
          err?.message || err,
        );
      }
    }
  } catch (err: any) {
    console.error("reconcilePendingHoldsForAllPools error:", err?.message || err);
  }
  return summary;
}

/**
 * Place a hold for a single request if one isn't already in place.
 * Called at the top of admin status-change endpoints so the very next
 * authoritative touch-point after .NET creates the row guarantees a
 * hold (or a no-op if no eligible pool covers the campaign).
 */
export async function ensureHoldForRequest(args: {
  requestKind: CoverFeeRequestKind;
  requestId: number;
}): Promise<number> {
  const { requestKind, requestId } = args;
  if (!Number.isFinite(requestId)) return 0;
  const fkCol = requestFkColumn(requestKind);

  try {
    const existing = await pool.query(
      `SELECT 1 FROM campaign_cover_fees_activity
        WHERE ${fkCol} = $1 AND fully_reversed_at IS NULL LIMIT 1`,
      [requestId],
    );
    if (existing.rows.length > 0) return 0;

    if (requestKind === "pending_grant") {
      const r = await pool.query(
        `SELECT id, campaign_id, user_id,
                COALESCE(NULLIF(amount, ''), '0')::numeric AS amount,
                created_date,
                LOWER(TRIM(COALESCE(status, ''))) AS status_norm
           FROM pending_grants
          WHERE id = $1 AND COALESCE(is_deleted, false) = false`,
        [requestId],
      );
      if (r.rows.length === 0) return 0;
      const row = r.rows[0];
      if (row.status_norm !== "pending") return 0;
      if (!Number.isFinite(Number(row.campaign_id))) return 0;
      return await holdCoverFeeForRequest({
        requestKind,
        requestId,
        campaignId: Number(row.campaign_id),
        donorUserId: row.user_id || null,
        donationAmount: parseFloat(row.amount) || 0,
        triggerDate: row.created_date || null,
      });
    } else {
      const r = await pool.query(
        `SELECT id, campaign_id, user_id,
                COALESCE(approximate_amount, 0)::numeric AS amount,
                created_at,
                LOWER(TRIM(COALESCE(status, ''))) AS status_norm
           FROM asset_based_payment_requests
          WHERE id = $1 AND COALESCE(is_deleted, false) = false`,
        [requestId],
      );
      if (r.rows.length === 0) return 0;
      const row = r.rows[0];
      if (row.status_norm !== "pending") return 0;
      if (!Number.isFinite(Number(row.campaign_id))) return 0;
      return await holdCoverFeeForRequest({
        requestKind,
        requestId,
        campaignId: Number(row.campaign_id),
        donorUserId: row.user_id || null,
        donationAmount: parseFloat(row.amount) || 0,
        triggerDate: row.created_at || null,
      });
    }
  } catch (err: any) {
    console.error(
      `ensureHoldForRequest: ${requestKind} ${requestId} error:`,
      err?.message || err,
    );
    return 0;
  }
}

export async function fetchHeldTotalsByPool(): Promise<
  Record<number, { heldAmount: number; heldCount: number }>
> {
  const result = await pool.query(
    `SELECT cover_fee_id, COUNT(*) AS held_count,
            COALESCE(SUM(fee_amount::numeric), 0) AS held_sum
       FROM campaign_cover_fees_activity
      WHERE status = 'held'
        AND fully_reversed_at IS NULL
      GROUP BY cover_fee_id`,
  );
  const out: Record<number, { heldAmount: number; heldCount: number }> = {};
  for (const r of result.rows) {
    out[Number(r.cover_fee_id)] = {
      heldAmount: Math.round((parseFloat(r.held_sum) || 0) * 100) / 100,
      heldCount: parseInt(r.held_count, 10) || 0,
    };
  }
  return out;
}
