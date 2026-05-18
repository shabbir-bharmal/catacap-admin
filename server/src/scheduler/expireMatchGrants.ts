/**
 * Scheduler job: Expire Match Grants
 *
 * Runs daily. Finds every active match grant whose expires_at has passed,
 * returns the unused reserved balance to the donor's wallet, logs the
 * refund in account_balance_change_logs, and marks the grant inactive.
 */

import pool from "../db.js";

export async function runExpireMatchGrants(): Promise<void> {
  console.log("[ExpireMatchGrants] Starting expiry check...");

  // Find all active grants that have passed their deadline
  const expiredResult = await pool.query(
    `SELECT cmg.id,
            cmg.donor_user_id,
            cmg.reserved_amount,
            cmg.amount_used,
            cmg.name,
            u.account_balance,
            u.user_name,
            u.email
       FROM campaign_match_grants cmg
       JOIN users u ON u.id = cmg.donor_user_id
      WHERE cmg.is_active = TRUE
        AND cmg.expires_at IS NOT NULL
        AND cmg.expires_at <= NOW()`,
  );

  if (expiredResult.rows.length === 0) {
    console.log("[ExpireMatchGrants] No expired grants found.");
    return;
  }

  console.log(
    `[ExpireMatchGrants] Found ${expiredResult.rows.length} expired grant(s) to process.`,
  );

  for (const grant of expiredResult.rows) {
    const client = await pool.connect();
    try {
      const reserved = parseFloat(grant.reserved_amount) || 0;
      const used = parseFloat(grant.amount_used) || 0;
      const refund = Math.max(0, Math.round((reserved - used) * 100) / 100);
      const currentBalance = parseFloat(grant.account_balance) || 0;

      await client.query("BEGIN");

      // Deactivate the grant
      await client.query(
        `UPDATE campaign_match_grants
            SET is_active  = FALSE,
                updated_at = NOW()
          WHERE id = $1`,
        [grant.id],
      );

      // Return unused reserved funds to donor wallet
      if (refund > 0) {
        const newBalance = parseFloat((currentBalance + refund).toFixed(2));

        await client.query(
          `UPDATE users SET account_balance = $1 WHERE id = $2`,
          [newBalance, grant.donor_user_id],
        );

        await client.query(
          `INSERT INTO account_balance_change_logs
             (user_id, payment_type, investment_name, old_value, user_name, new_value, change_date)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            grant.donor_user_id,
            "Match grant expired – funds returned",
            grant.name || `Grant #${grant.id}`,
            currentBalance,
            grant.user_name || grant.email || "",
            newBalance,
          ],
        );

        console.log(
          `[ExpireMatchGrants] Grant ${grant.id} expired — refunded $${refund} to donor ${grant.email}`,
        );
      } else {
        console.log(
          `[ExpireMatchGrants] Grant ${grant.id} expired — no unused funds to return (reserved: $${reserved}, used: $${used})`,
        );
      }

      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `[ExpireMatchGrants] Error processing grant ${grant.id}:`,
        err?.message || err,
      );
    } finally {
      client.release();
    }
  }

  console.log("[ExpireMatchGrants] Done.");
}
