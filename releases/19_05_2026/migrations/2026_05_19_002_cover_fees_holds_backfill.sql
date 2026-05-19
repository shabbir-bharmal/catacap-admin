-- 2026_05_19_002_cover_fees_holds_backfill.sql
--
-- Backfill held / applied activity rows for in-flight pending grants and
-- asset-based payment requests that pre-date the hold-on-create feature.
--
-- Behavior:
--   * For each (pool, request) pair where the request is currently in
--     Pending or In Transit status (campaign matches a pool, donor not the
--     sponsor where applicable, coverage_active_from <= request creation):
--       — If status='Pending': INSERT a 'held' activity row sized to the
--         5% fee (capped by per_investment_cap and remaining pool budget).
--         pool.amount_used is NOT incremented for holds.
--       — If status='In Transit': INSERT an 'applied' activity row,
--         increment pool.amount_used, link to existing recommendation
--         where present.
--   * For EVERY backfilled row a paired sponsor-side account_balance_change_log
--     entry is written so the audit trail mirrors what runtime hold/apply
--     would have produced. Backfill log rows are tagged with comment
--     prefix "[backfill 2026-05-19]" so they are trivially identifiable.
--
-- Idempotency:
--   The INSERT is guarded by NOT EXISTS against any active activity row
--   for the same (pool, request) pair, and by the partial unique indexes
--   from migration 001.
--
-- Allocation order:
--   First-come-first-served by request creation date so that limited
--   pool budget mirrors the runtime convert/apply order.
--
-- Rollback:
--   DELETE FROM campaign_cover_fees_activity
--    WHERE (triggered_by_pending_grant_id IS NOT NULL
--           OR triggered_by_asset_based_payment_request_id IS NOT NULL)
--      AND created_at >= '2026-05-19'
--      AND status = 'held';
--   (Applied backfills are intentionally NOT reversed automatically —
--   they reflect real escrow draws and should be reviewed manually.)

BEGIN;

DO $$
DECLARE
    rec       RECORD;
    pool_rec  RECORD;
    fee_rate  NUMERIC;
    fee_amt   NUMERIC;
    remaining NUMERIC;
    held_sum  NUMERIC;
    new_rec_id INTEGER;
    is_pending BOOLEAN;
    request_amount NUMERIC;
    cur_date   TIMESTAMP;
    sponsor_id      TEXT;
    sponsor_uname   TEXT;
    pool_name_      TEXT;
    camp_name_      TEXT;
    remaining_before NUMERIC;
    remaining_after  NUMERIC;
    log_payment_type TEXT;
    log_comment      TEXT;
    inserted_activity_id INTEGER;
BEGIN
    -- ── Pending grants ────────────────────────────────────────────────
    FOR rec IN
        SELECT pg.id            AS request_id,
               pg.campaign_id   AS campaign_id,
               pg.user_id       AS donor_user_id,
               COALESCE(NULLIF(pg.amount, ''), '0')::numeric AS amount,
               LOWER(TRIM(COALESCE(pg.status, ''))) AS status_norm,
               pg.created_date  AS created_date
          FROM pending_grants pg
         WHERE COALESCE(pg.is_deleted, false) = false
           AND LOWER(TRIM(COALESCE(pg.status, ''))) IN ('pending', 'in transit')
           AND COALESCE(NULLIF(pg.amount, ''), '0')::numeric > 0
         ORDER BY pg.created_date ASC NULLS LAST, pg.id ASC
    LOOP
        is_pending     := (rec.status_norm = 'pending');
        request_amount := rec.amount;
        cur_date       := rec.created_date;

        FOR pool_rec IN
            SELECT ccf.id, ccf.reserved_amount, ccf.amount_used,
                   ccf.fee_rate, ccf.per_investment_cap,
                   ccf.cover_initial_fee, ccf.cover_lifecycle_fee,
                   ccf.is_active, ccf.expires_at, ccf.coverage_active_from
              FROM campaign_cover_fees ccf
              JOIN campaign_cover_fees_campaigns ccfc
                   ON ccfc.cover_fee_id = ccf.id
                  AND ccfc.campaign_id  = rec.campaign_id
             WHERE ccf.is_active = TRUE
               AND COALESCE(ccf.cover_initial_fee, TRUE) = TRUE
               AND (ccf.expires_at IS NULL OR ccf.expires_at > NOW())
               AND (ccf.reserved_amount IS NOT NULL
                    AND ccf.reserved_amount::numeric > 0)
             ORDER BY ccf.id ASC
        LOOP
            -- Coverage activation cutoff
            IF pool_rec.coverage_active_from IS NOT NULL
               AND cur_date IS NOT NULL
               AND cur_date < pool_rec.coverage_active_from THEN
                CONTINUE;
            END IF;

            -- Skip if already covered (any active row) — either via the
            -- new request FK, OR via the legacy path where a prior
            -- 'applied' row was linked through a recommendation tied to
            -- this pending grant (pre-feature behavior). Without the
            -- legacy check, the request-FK insert below would no-op on
            -- the (pool, rec) unique index AND we'd still double-
            -- increment amount_used.
            IF EXISTS (
                SELECT 1 FROM campaign_cover_fees_activity a
                 WHERE a.cover_fee_id = pool_rec.id
                   AND a.triggered_by_pending_grant_id = rec.request_id
                   AND a.fully_reversed_at IS NULL
            ) THEN
                CONTINUE;
            END IF;
            IF EXISTS (
                SELECT 1 FROM campaign_cover_fees_activity a
                  JOIN recommendations r2
                       ON r2.id = a.triggered_by_recommendation_id
                 WHERE a.cover_fee_id = pool_rec.id
                   AND a.fully_reversed_at IS NULL
                   AND r2.pending_grants_id = rec.request_id
            ) THEN
                CONTINUE;
            END IF;

            -- Skip tombstoned recs linked to this pending grant
            IF EXISTS (
                SELECT 1 FROM canceled_cover_fees_pairs cmp
                  JOIN recommendations r2
                       ON r2.id = cmp.triggered_by_recommendation_id
                 WHERE cmp.cover_fee_id = pool_rec.id
                   AND r2.pending_grants_id = rec.request_id
            ) THEN
                CONTINUE;
            END IF;

            SELECT COALESCE(SUM(fee_amount::numeric), 0)
              INTO held_sum
              FROM campaign_cover_fees_activity
             WHERE cover_fee_id = pool_rec.id
               AND status = 'held'
               AND fully_reversed_at IS NULL;

            remaining := GREATEST(
                0,
                COALESCE(pool_rec.reserved_amount::numeric, 0)
                  - COALESCE(pool_rec.amount_used::numeric, 0)
                  - held_sum
            );
            IF remaining <= 0 THEN
                CONTINUE;
            END IF;

            fee_rate := COALESCE(pool_rec.fee_rate::numeric, 0.05);
            fee_amt  := request_amount * fee_rate;
            IF pool_rec.per_investment_cap IS NOT NULL THEN
                fee_amt := LEAST(fee_amt, pool_rec.per_investment_cap::numeric);
            END IF;
            fee_amt := LEAST(fee_amt, remaining);
            fee_amt := ROUND(fee_amt::numeric, 2);
            IF fee_amt <= 0 THEN
                CONTINUE;
            END IF;

            -- Try to find the (single) live recommendation linked to this
            -- pending grant for the rec FK on applied rows.
            SELECT r.id INTO new_rec_id
              FROM recommendations r
             WHERE r.pending_grants_id = rec.request_id
               AND COALESCE(r.is_deleted, false) = false
             ORDER BY r.id DESC
             LIMIT 1;

            remaining_before := COALESCE(pool_rec.reserved_amount::numeric, 0)
                                  - COALESCE(pool_rec.amount_used::numeric, 0)
                                  - held_sum;

            inserted_activity_id := NULL;
            IF is_pending THEN
                INSERT INTO campaign_cover_fees_activity
                    (cover_fee_id, campaign_id, triggered_by_user_id,
                     triggered_by_recommendation_id,
                     triggered_by_pending_grant_id,
                     fee_amount, donation_amount, status, created_at)
                VALUES (pool_rec.id, rec.campaign_id, rec.donor_user_id,
                        NULL, rec.request_id,
                        fee_amt, request_amount, 'held', NOW())
                ON CONFLICT DO NOTHING
                RETURNING id INTO inserted_activity_id;
                IF inserted_activity_id IS NULL THEN
                    -- Lost race / unique-index hit: nothing inserted,
                    -- so DO NOT touch amount_used or write an audit row.
                    EXIT;
                END IF;
                remaining_after  := remaining_before - fee_amt;
                log_payment_type := 'Cover Fees – escrow held';
                log_comment      := '[backfill 2026-05-19] $' || fee_amt::text
                                    || ' reserved (held) for pending_grant ' || rec.request_id;
            ELSE
                INSERT INTO campaign_cover_fees_activity
                    (cover_fee_id, campaign_id, triggered_by_user_id,
                     triggered_by_recommendation_id,
                     triggered_by_pending_grant_id,
                     fee_amount, donation_amount, status, created_at)
                VALUES (pool_rec.id, rec.campaign_id, rec.donor_user_id,
                        new_rec_id, rec.request_id,
                        fee_amt, request_amount, 'applied', NOW())
                ON CONFLICT DO NOTHING
                RETURNING id INTO inserted_activity_id;
                IF inserted_activity_id IS NULL THEN
                    -- A row already exists for this (pool, rec). The
                    -- escrow was already drawn by the legacy path —
                    -- skip the amount_used increment AND the audit row.
                    EXIT;
                END IF;

                UPDATE campaign_cover_fees
                   SET amount_used = amount_used + fee_amt,
                       updated_at  = NOW()
                 WHERE id = pool_rec.id;
                remaining_after  := remaining_before - fee_amt;
                log_payment_type := 'Cover Fees – escrow applied';
                log_comment      := '[backfill 2026-05-19] $' || fee_amt::text
                                    || ' applied for pending_grant ' || rec.request_id;
            END IF;

            -- Write paired sponsor account-history row so the audit trail
            -- matches runtime hold/apply. Only reached when we actually
            -- inserted a new activity row above.
            SELECT ccf.sponsor_user_id, ccf.name, c.name
              INTO sponsor_id, pool_name_, camp_name_
              FROM campaign_cover_fees ccf
              LEFT JOIN campaigns c ON c.id = rec.campaign_id
             WHERE ccf.id = pool_rec.id;
            IF sponsor_id IS NOT NULL THEN
                SELECT user_name INTO sponsor_uname FROM users WHERE id = sponsor_id;
                INSERT INTO account_balance_change_logs
                    (user_id, payment_type, investment_name, campaign_id,
                     old_value, user_name, new_value, change_date, comment,
                     gross_amount, fees, net_amount)
                VALUES (sponsor_id, log_payment_type, COALESCE(camp_name_, ''),
                        rec.campaign_id,
                        ROUND(remaining_before, 2),
                        COALESCE(sponsor_uname, ''),
                        ROUND(remaining_after, 2),
                        NOW(), log_comment,
                        fee_amt, 0, fee_amt);
            END IF;

            -- single-cover policy: one pool per request
            EXIT;
        END LOOP;
    END LOOP;

    -- ── Asset-based payment requests (Other Assets) ───────────────────
    FOR rec IN
        SELECT abpr.id            AS request_id,
               abpr.campaign_id   AS campaign_id,
               abpr.user_id       AS donor_user_id,
               COALESCE(abpr.approximate_amount, 0)::numeric AS amount,
               LOWER(TRIM(COALESCE(abpr.status, ''))) AS status_norm,
               abpr.created_at    AS created_date
          FROM asset_based_payment_requests abpr
         WHERE COALESCE(abpr.is_deleted, false) = false
           AND LOWER(TRIM(COALESCE(abpr.status, ''))) IN ('pending', 'in transit')
           AND COALESCE(abpr.approximate_amount, 0)::numeric > 0
         ORDER BY abpr.created_at ASC NULLS LAST, abpr.id ASC
    LOOP
        is_pending     := (rec.status_norm = 'pending');
        request_amount := rec.amount;
        cur_date       := rec.created_date;

        FOR pool_rec IN
            SELECT ccf.id, ccf.reserved_amount, ccf.amount_used,
                   ccf.fee_rate, ccf.per_investment_cap,
                   ccf.cover_initial_fee, ccf.cover_lifecycle_fee,
                   ccf.is_active, ccf.expires_at, ccf.coverage_active_from
              FROM campaign_cover_fees ccf
              JOIN campaign_cover_fees_campaigns ccfc
                   ON ccfc.cover_fee_id = ccf.id
                  AND ccfc.campaign_id  = rec.campaign_id
             WHERE ccf.is_active = TRUE
               AND COALESCE(ccf.cover_initial_fee, TRUE) = TRUE
               AND (ccf.expires_at IS NULL OR ccf.expires_at > NOW())
               AND (ccf.reserved_amount IS NOT NULL
                    AND ccf.reserved_amount::numeric > 0)
             ORDER BY ccf.id ASC
        LOOP
            IF pool_rec.coverage_active_from IS NOT NULL
               AND cur_date IS NOT NULL
               AND cur_date < pool_rec.coverage_active_from THEN
                CONTINUE;
            END IF;

            IF EXISTS (
                SELECT 1 FROM campaign_cover_fees_activity a
                 WHERE a.cover_fee_id = pool_rec.id
                   AND a.triggered_by_asset_based_payment_request_id = rec.request_id
                   AND a.fully_reversed_at IS NULL
            ) THEN
                CONTINUE;
            END IF;

            SELECT COALESCE(SUM(fee_amount::numeric), 0)
              INTO held_sum
              FROM campaign_cover_fees_activity
             WHERE cover_fee_id = pool_rec.id
               AND status = 'held'
               AND fully_reversed_at IS NULL;

            remaining := GREATEST(
                0,
                COALESCE(pool_rec.reserved_amount::numeric, 0)
                  - COALESCE(pool_rec.amount_used::numeric, 0)
                  - held_sum
            );
            IF remaining <= 0 THEN CONTINUE; END IF;

            fee_rate := COALESCE(pool_rec.fee_rate::numeric, 0.05);
            fee_amt  := request_amount * fee_rate;
            IF pool_rec.per_investment_cap IS NOT NULL THEN
                fee_amt := LEAST(fee_amt, pool_rec.per_investment_cap::numeric);
            END IF;
            fee_amt := LEAST(fee_amt, remaining);
            fee_amt := ROUND(fee_amt::numeric, 2);
            IF fee_amt <= 0 THEN CONTINUE; END IF;

            remaining_before := COALESCE(pool_rec.reserved_amount::numeric, 0)
                                  - COALESCE(pool_rec.amount_used::numeric, 0)
                                  - held_sum;

            -- Other Assets: rec is only created at Received. For In Transit
            -- backfill we have no rec yet, so leave the rec FK NULL.
            inserted_activity_id := NULL;
            INSERT INTO campaign_cover_fees_activity
                (cover_fee_id, campaign_id, triggered_by_user_id,
                 triggered_by_recommendation_id,
                 triggered_by_asset_based_payment_request_id,
                 fee_amount, donation_amount, status, created_at)
            VALUES (pool_rec.id, rec.campaign_id, rec.donor_user_id,
                    NULL, rec.request_id,
                    fee_amt, request_amount,
                    CASE WHEN is_pending THEN 'held' ELSE 'applied' END,
                    NOW())
            ON CONFLICT DO NOTHING
            RETURNING id INTO inserted_activity_id;
            IF inserted_activity_id IS NULL THEN
                -- Insert no-op (race / unique-index hit) — never touch
                -- amount_used or write an audit row.
                EXIT;
            END IF;

            IF NOT is_pending THEN
                UPDATE campaign_cover_fees
                   SET amount_used = amount_used + fee_amt,
                       updated_at  = NOW()
                 WHERE id = pool_rec.id;
                log_payment_type := 'Cover Fees – escrow applied';
                log_comment      := '[backfill 2026-05-19] $' || fee_amt::text
                                    || ' applied for asset_based_payment_request ' || rec.request_id;
            ELSE
                log_payment_type := 'Cover Fees – escrow held';
                log_comment      := '[backfill 2026-05-19] $' || fee_amt::text
                                    || ' reserved (held) for asset_based_payment_request ' || rec.request_id;
            END IF;
            remaining_after := remaining_before - fee_amt;

            SELECT ccf.sponsor_user_id, ccf.name, c.name
              INTO sponsor_id, pool_name_, camp_name_
              FROM campaign_cover_fees ccf
              LEFT JOIN campaigns c ON c.id = rec.campaign_id
             WHERE ccf.id = pool_rec.id;
            IF sponsor_id IS NOT NULL THEN
                SELECT user_name INTO sponsor_uname FROM users WHERE id = sponsor_id;
                INSERT INTO account_balance_change_logs
                    (user_id, payment_type, investment_name, campaign_id,
                     old_value, user_name, new_value, change_date, comment,
                     gross_amount, fees, net_amount)
                VALUES (sponsor_id, log_payment_type, COALESCE(camp_name_, ''),
                        rec.campaign_id,
                        ROUND(remaining_before, 2),
                        COALESCE(sponsor_uname, ''),
                        ROUND(remaining_after, 2),
                        NOW(), log_comment,
                        fee_amt, 0, fee_amt);
            END IF;

            EXIT;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
