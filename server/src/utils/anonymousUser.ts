import pool from "../db.js";
import crypto from "crypto";
import { sendTemplateEmail } from "./emailService.js";
import { generateUniqueRefCode } from "./refCode.js";

export async function findOrCreateAnonymousUser(
  email: string,
  firstName: string,
  lastName: string
): Promise<{ id: string; isNew: boolean }> {
  const userEmail = email.trim().toLowerCase();

  const existing = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [userEmail]
  );

  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, isNew: false };
  }

  const trimmedFirst = (firstName || "").trim();
  const trimmedLast = (lastName || "").trim();
  let userName = `${trimmedFirst}${trimmedLast}`.replace(/\s/g, "").toLowerCase();

  if (!userName) {
    userName = userEmail.split("@")[0].replace(/[^a-z0-9]/g, "").toLowerCase() || "user";
  }

  let check = await pool.query(`SELECT id FROM users WHERE user_name = $1`, [userName]);
  while (check.rows.length > 0) {
    userName = `${userName}${Math.floor(Math.random() * 100)}`;
    check = await pool.query(`SELECT id FROM users WHERE user_name = $1`, [userName]);
  }

  const userId = crypto.randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const refCode = await generateUniqueRefCode(client);
      try {
        await client.query(
          `INSERT INTO users (id, first_name, last_name, user_name, email, ref_code, is_free_user, email_confirmed,
           phone_number_confirmed, two_factor_enabled, lockout_enabled, access_failed_count,
           security_stamp, concurrency_stamp, is_active, date_created)
           VALUES ($1, $2, $3, $4, $5, $6, true, false, false, false, true, 0, $7, $8, true, NOW())`,
          [userId, trimmedFirst, trimmedLast, userName, userEmail, refCode, crypto.randomUUID(), crypto.randomUUID()]
        );
        inserted = true;
      } catch (refErr: any) {
        if (refErr.code === "23505" && refErr.constraint === "idx_users_ref_code_unique") {
          continue;
        }
        throw refErr;
      }
    }
    if (!inserted) {
      throw new Error("findOrCreateAnonymousUser: could not allocate unique ref_code after 5 attempts");
    }

    const roleResult = await client.query(
      `SELECT id FROM roles WHERE name = 'User' LIMIT 1`
    );
    if (roleResult.rows.length > 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, discriminator, is_deleted) VALUES ($1, $2, $3, false)`,
        [userId, roleResult.rows[0].id, "IdentityUserRole<string>"]
      );
    } else {
      console.error("CRITICAL: 'User' role not found in roles table. Anonymous user created without role assignment. User will not appear in admin listing.");
    }

    await client.query("COMMIT");
  } catch (insertErr: any) {
    await client.query("ROLLBACK");
    if (insertErr.code === "23505") {
      const retryCheck = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        [userEmail]
      );
      if (retryCheck.rows.length > 0) {
        return { id: retryCheck.rows[0].id, isNew: false };
      }
    }
    throw insertErr;
  } finally {
    client.release();
  }

  const requestOrigin = process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
  const logoUrl = process.env.LOGO_URL || "";

  try {
    await sendTemplateEmail(1, userEmail, {
      firstName: trimmedFirst,
      userName,
      resetPasswordUrl: `${requestOrigin}/forgotpassword`,
      logoUrl,
      siteUrl: requestOrigin,
    });
  } catch (emailErr: any) {
    console.error("Error sending welcome email to anonymous user:", emailErr);
  }

  return { id: userId, isNew: true };
}
