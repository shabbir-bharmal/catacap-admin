/**
 * Payment routes — Stripe webhook handler.
 *
 * Currently scoped to the Cover-Fees refund-reversal flow. Listens for
 * `charge.refunded` events (chosen over `refund.created` so partial /
 * multiple refunds attached to one charge are all visible via
 * `charge.refunds.data`) and triggers
 * `reverseCoverFeesByPaymentRef` for each refund individually.
 *
 * Security:
 * - The webhook verifies the `Stripe-Signature` header against
 *   `STRIPE_WEBHOOK_SECRET` using HMAC-SHA256 over the RAW request
 *   body (express.raw() is mounted on this path in server/src/index.ts).
 *   Requests without a valid signature get 400 and never invoke the
 *   reversal helper.
 *
 * Reliability:
 * - Always responds 200 once the signature is verified, even if a
 *   single refund within the event errors, so Stripe doesn't keep
 *   retrying the entire batch on one bad row.
 */

import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { reverseCoverFeesByPaymentRef } from "../utils/coverFees.js";

const router = Router();

interface StripeRefund {
  id?: string;
  status?: string;
  amount?: number; // in smallest currency unit (cents)
  reason?: string | null;
}

interface StripeCharge {
  id?: string;
  payment_intent?: string | null;
  refunds?: { data?: StripeRefund[] } | null;
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: StripeCharge } | null;
}

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Stripe `Stripe-Signature` header against a raw payload.
 * Mirrors Stripe's documented scheme:
 *   header = "t=<unix>,v1=<hex hmac>"
 *   signed = `${unix}.${rawBody}`
 *   hmac   = HMAC_SHA256(secret, signed)
 *
 * Returns true iff at least one v1 signature matches and the timestamp
 * is within tolerance. Constant-time comparison via timingSafeEqual.
 */
function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > SIGNATURE_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  for (const sig of signatures) {
    let actual: Buffer;
    try {
      actual = Buffer.from(sig, "hex");
    } catch {
      continue;
    }
    if (
      actual.length === expectedBuf.length &&
      crypto.timingSafeEqual(actual, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

router.post("/stripe/webhook", async (req: Request, res: Response) => {
  // express.raw() leaves req.body as a Buffer for this path.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : "");
  const signatureHeader = req.header("Stripe-Signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";

  if (!secret) {
    console.error(
      "stripe/webhook: STRIPE_WEBHOOK_SECRET not configured; rejecting event",
    );
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!verifyStripeSignature(rawBody, signatureHeader, secret)) {
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as StripeEvent;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (!event || event.type !== "charge.refunded") {
    res.status(200).json({ received: true, handled: false });
    return;
  }

  const charge = event.data?.object;
  const paymentIntent = charge?.payment_intent || null;
  const refunds = charge?.refunds?.data || [];

  if (!paymentIntent || refunds.length === 0) {
    res.status(200).json({ received: true, handled: false });
    return;
  }

  const candidateRefs = [
    `stripe_card_${paymentIntent}`,
    `stripe_bank_${paymentIntent}`,
  ];

  const results: Array<{
    refundId: string | undefined;
    status: "reversed" | "already" | "skipped" | "error";
    feeReversed?: number;
    error?: string;
  }> = [];

  for (const refund of refunds) {
    try {
      if (!refund.id) {
        results.push({ refundId: undefined, status: "skipped" });
        continue;
      }
      if (refund.status && refund.status !== "succeeded") {
        results.push({ refundId: refund.id, status: "skipped" });
        continue;
      }
      const refundAmount =
        typeof refund.amount === "number" ? refund.amount / 100 : 0;
      if (refundAmount <= 0) {
        results.push({ refundId: refund.id, status: "skipped" });
        continue;
      }

      let handled = false;
      for (const paymentRef of candidateRefs) {
        const result = await reverseCoverFeesByPaymentRef({
          paymentRef,
          refundAmount,
          idempotencyKey: refund.id,
          reason: refund.reason || `Stripe refund ${refund.id}`,
        });
        if (result.alreadyProcessed) {
          results.push({
            refundId: refund.id,
            status: "already",
            feeReversed: 0,
          });
          handled = true;
          break;
        }
        if (result.reversed) {
          results.push({
            refundId: refund.id,
            status: "reversed",
            feeReversed: result.feeReversed,
          });
          handled = true;
          break;
        }
      }
      if (!handled) {
        results.push({ refundId: refund.id, status: "skipped" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `paymentRoutes/stripe/webhook: error processing refund ${refund?.id}: ${msg}`,
      );
      results.push({
        refundId: refund?.id,
        status: "error",
        error: msg,
      });
    }
  }

  res.status(200).json({ received: true, handled: true, results });
});

export default router;
