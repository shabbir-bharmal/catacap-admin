import crypto from "crypto";
import type { PoolClient } from "pg";
import pool from "../db.js";

const CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 12;

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CHARS[bytes[i] % CHARS.length];
  }
  return out;
}

/**
 * Returns an 8-char alphanumeric ref_code that is not currently
 * present in public.users.ref_code. Pass a PoolClient when generating
 * inside an open transaction so the existence check sees the same
 * snapshot as the surrounding INSERT.
 *
 * The DB-level partial unique index `idx_users_ref_code_unique` is
 * the ultimate guard against races; the caller should still retry on
 * a 23505 unique-violation just in case two parallel inserts happen
 * to pick the same code between SELECT and INSERT.
 */
export async function generateUniqueRefCode(
  client?: PoolClient
): Promise<string> {
  const runner = client ?? pool;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = randomCode();
    const { rows } = await runner.query(
      "SELECT 1 FROM public.users WHERE ref_code = $1 LIMIT 1",
      [candidate]
    );
    if (rows.length === 0) return candidate;
  }
  throw new Error(
    `generateUniqueRefCode: could not produce a unique ref_code after ${MAX_ATTEMPTS} attempts`
  );
}
