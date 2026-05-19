-- Migration: Cover Fees escrow double-debit reconciliation (task #522)
-- Date: 2026-05-19
--
-- Purpose:
--   Prior to this change, escrow-backed Cover Fees pools (reserved_amount > 0)
--   debited the sponsor's wallet at funding time AND ALSO debited the
--   sponsor's wallet again on every donor fee draw. That is a double-debit:
--   funding already moved the money out of the wallet into escrow, so the
--   donor draws should only have consumed the pool's escrow balance.
--
--   Starting with this release, apply / reverse for escrow pools no longer
--   touches the sponsor wallet. This migration reconciles existing pools by
--   crediting back to each sponsor the cumulative amount that was
--   double-debited under the old behavior:
--
--     For every escrow pool (reserved_amount > 0):
--       (a) outstanding (not-yet-reversed) per-activity debits, i.e.
--           SUM(fee_amount - COALESCE(reversed_fee_amount, 0))
--           across campaign_cover_fees_activity rows for that pool, AND
--       (b) admin-canceled activity rows, whose original wallet debit was
--           never credited back by the cancel path,
--           SUM(fee_amount) across canceled_cover_fees_pairs rows for that
--           pool.
--
--   Each sponsor is credited the total of (a)+(b) summed across all of
--   their escrow pools, and an account_balance_change_logs row is written.
--
-- Idempotent:
--   - Uses cover_fees_escrow_reconciliation_log keyed on (sponsor_user_id)
--     so a re-run is a no-op once a sponsor has been reconciled.
--   - CREATE TABLE / INDEX IF NOT EXISTS guard the schema bits.
--
-- Transactional: BEGIN/COMMIT.
--
-- Rollback (manual, see bottom): the per-sponsor credits would have to be
-- reversed by subtracting cover_fees_escrow_reconciliation_log.reconciled_amount
-- from each sponsor's account_balance and inserting compensating ABCL rows.
-- A DROP of the log table without that reversal would simply allow a
-- re-credit on the next run, which IS the only built-in safety mechanism.

BEGIN;

CREATE TABLE IF NOT EXISTS cover_fees_escrow_reconciliation_log (
    id                  SERIAL PRIMARY KEY,
    sponsor_user_id     VARCHAR(450) NOT NULL UNIQUE,
    reconciled_amount   NUMERIC(14, 2) NOT NULL,
    reconciled_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    details             JSONB
);

CREATE INDEX IF NOT EXISTS cover_fees_escrow_reconciliation_log_sponsor_idx
    ON cover_fees_escrow_reconciliation_log (sponsor_user_id);

DO $$
DECLARE
    r            RECORD;
    old_balance  NUMERIC(14, 2);
    new_balance  NUMERIC(14, 2);
    u_name       TEXT;
BEGIN
    FOR r IN
        WITH per_sponsor AS (
            SELECT ccf.sponsor_user_id AS sponsor_user_id,
                   SUM(GREATEST(0,
                                COALESCE(a.fee_amount, 0)
                                - COALESCE(a.reversed_fee_amount, 0))) AS amt
              FROM campaign_cover_fees_activity a
              JOIN campaign_cover_fees ccf ON ccf.id = a.cover_fee_id
             WHERE COALESCE(ccf.reserved_amount, 0) > 0
             GROUP BY ccf.sponsor_user_id

            UNION ALL

            SELECT ccf.sponsor_user_id,
                   SUM(COALESCE(cp.fee_amount, 0)) AS amt
              FROM canceled_cover_fees_pairs cp
              JOIN campaign_cover_fees ccf ON ccf.id = cp.cover_fee_id
             WHERE COALESCE(ccf.reserved_amount, 0) > 0
             GROUP BY ccf.sponsor_user_id
        )
        SELECT sponsor_user_id,
               ROUND(SUM(amt)::numeric, 2) AS total_credit
          FROM per_sponsor
         GROUP BY sponsor_user_id
        HAVING ROUND(SUM(amt)::numeric, 2) > 0
    LOOP
        IF EXISTS (
            SELECT 1 FROM cover_fees_escrow_reconciliation_log
             WHERE sponsor_user_id = r.sponsor_user_id
        ) THEN
            CONTINUE;
        END IF;

        SELECT COALESCE(account_balance, 0),
               COALESCE(user_name, email, '')
          INTO old_balance, u_name
          FROM users
         WHERE id = r.sponsor_user_id
         FOR UPDATE;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        new_balance := ROUND((old_balance + r.total_credit)::numeric, 2);

        UPDATE users
           SET account_balance = new_balance
         WHERE id = r.sponsor_user_id;

        INSERT INTO account_balance_change_logs
            (user_id, payment_type, investment_name,
             old_value, user_name, new_value, change_date,
             gross_amount, fees, net_amount, comment)
        VALUES
            (r.sponsor_user_id,
             'Cover Fees – escrow reconciliation refund',
             'Cover Fees pool reconciliation (task #522)',
             old_balance, u_name, new_balance, NOW(),
             r.total_credit, 0, r.total_credit,
             'One-time refund of fees that were double-debited from the sponsor wallet under the previous Cover Fees escrow model. Funding-time debit + per-donation debit were both being applied; donations should have drawn only against the escrow pool. Wallet is being credited back the cumulative unreversed/canceled per-donation debits across all escrow pools sponsored by this user.');

        INSERT INTO cover_fees_escrow_reconciliation_log
            (sponsor_user_id, reconciled_amount, details)
        VALUES
            (r.sponsor_user_id,
             r.total_credit,
             jsonb_build_object(
                 'task', 'task-522',
                 'old_balance', old_balance,
                 'new_balance', new_balance,
                 'reconciled_at', NOW()
             ));
    END LOOP;
END $$;

COMMIT;

-- Rollback (manual; review before running):
-- BEGIN;
--   -- For each reconciled sponsor, subtract back the credited amount and
--   -- record a compensating ABCL row, then drop the log table.
--   UPDATE users u
--      SET account_balance = ROUND(
--              (COALESCE(u.account_balance, 0) - l.reconciled_amount)::numeric, 2)
--     FROM cover_fees_escrow_reconciliation_log l
--    WHERE u.id = l.sponsor_user_id;
--   DROP TABLE IF EXISTS cover_fees_escrow_reconciliation_log;
-- COMMIT;
