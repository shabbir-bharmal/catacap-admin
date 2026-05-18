/**
 * Scheduler job: Expire Cover Fees pools
 *
 * Daily. Mirrors expireMatchGrants.ts. Returns unused reserved escrow to
 * the sponsor's wallet and marks the pool inactive.
 */

import pool from "../db.js";

export async function runExpireCoverFees(): Promise<void> {
  console.log("[ExpireCoverFees] Starting expiry check...");

  const expiredResult = await pool.query(
    `SELECT ccf.id,
            ccf.sponsor_user_id,
            ccf.reserved_amount,
            ccf.amount_used,
            ccf.name,
            u.account_balance,
            u.user_name,
            u.email
       FROM campaign_cover_fees ccf
       JOIN users u ON u.id = ccf.sponsor_user_id
      WHERE ccf.is_active = TRUE
        AND ccf.expires_at IS NOT NULL
        AND ccf.expires_at <= NOW()`,
  );

  if (expiredResult.rows.length === 0) {
    console.log("[ExpireCoverFees] No expired pools found.");
    return;
  }

  console.log(
    `[ExpireCoverFees] Found ${expiredResult.rows.length} expired pool(s) to process.`,
  );

  for (const p of expiredResult.rows) {
    const client = await pool.connect();
    try {
      const reserved = parseFloat(p.reserved_amount) || 0;
      const used = parseFloat(p.amount_used) || 0;
      const refund = Math.max(0, Math.round((reserved - used) * 100) / 100);
      const currentBalance = parseFloat(p.account_balance) || 0;

      await client.query("BEGIN");

      await client.query(
        `UPDATE campaign_cover_fees
            SET is_active  = FALSE,
                updated_at = NOW()
          WHERE id = $1`,
        [p.id],
      );

      if (refund > 0) {
        const newBalance = parseFloat((currentBalance + refund).toFixed(2));
        await client.query(
          `UPDATE users SET account_balance = $1 WHERE id = $2`,
          [newBalance, p.sponsor_user_id],
        );
        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, old_value, user_name, new_value, change_date)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            p.sponsor_user_id,
            "Cover Fees pool expired – funds returned",
            p.name || `Pool #${p.id}`,
            currentBalance,
            p.user_name || p.email || "",
            newBalance,
          ],
        );
        console.log(
          `[ExpireCoverFees] Pool ${p.id} expired — refunded $${refund} to sponsor ${p.email}`,
        );
      } else {
        console.log(
          `[ExpireCoverFees] Pool ${p.id} expired — no unused funds (reserved: $${reserved}, used: $${used})`,
        );
      }

      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `[ExpireCoverFees] Error processing pool ${p.id}:`,
        err?.message || err,
      );
    } finally {
      client.release();
    }
  }

  console.log("[ExpireCoverFees] Done.");
}
