-- Add the new "InvestmentTypeCategory" simple-value list to site_configurations
-- so admins can manage the Investment Type dropdown shown on
-- /raisemoney/edit/:id from Site Configuration. Three seed values are
-- inserted (Fund, Direct Investment, Structured Vehicle) and any
-- pre-existing campaigns whose investment_type_category still uses the
-- legacy hard-coded values ("funds", "direct_investments") are
-- backfilled to the new labels so the dropdown can match them.
--
-- Idempotent: every INSERT is guarded by a NOT EXISTS check on
-- (type, value) restricted to non-deleted rows; the UPDATE only touches
-- rows that still hold the legacy lowercase value, so re-runs are
-- no-ops. Wrapped in a single transaction.
--
-- Rollback:
--   BEGIN;
--   UPDATE campaigns
--     SET investment_type_category = 'funds'
--     WHERE investment_type_category = 'Fund';
--   UPDATE campaigns
--     SET investment_type_category = 'direct_investments'
--     WHERE investment_type_category = 'Direct Investment';
--   DELETE FROM site_configurations
--     WHERE type = 'InvestmentTypeCategory'
--       AND value IN ('Fund', 'Direct Investment', 'Structured Vehicle');
--   COMMIT;

BEGIN;

INSERT INTO site_configurations (key, value, type)
SELECT 'Fund', 'Fund', 'InvestmentTypeCategory'
WHERE NOT EXISTS (
  SELECT 1 FROM site_configurations
  WHERE type = 'InvestmentTypeCategory'
    AND TRIM(value) = 'Fund'
    AND (is_deleted IS NULL OR is_deleted = false)
);

INSERT INTO site_configurations (key, value, type)
SELECT 'Direct Investment', 'Direct Investment', 'InvestmentTypeCategory'
WHERE NOT EXISTS (
  SELECT 1 FROM site_configurations
  WHERE type = 'InvestmentTypeCategory'
    AND TRIM(value) = 'Direct Investment'
    AND (is_deleted IS NULL OR is_deleted = false)
);

INSERT INTO site_configurations (key, value, type)
SELECT 'Structured Vehicle', 'Structured Vehicle', 'InvestmentTypeCategory'
WHERE NOT EXISTS (
  SELECT 1 FROM site_configurations
  WHERE type = 'InvestmentTypeCategory'
    AND TRIM(value) = 'Structured Vehicle'
    AND (is_deleted IS NULL OR is_deleted = false)
);

UPDATE campaigns
SET investment_type_category = 'Fund'
WHERE investment_type_category = 'funds';

UPDATE campaigns
SET investment_type_category = 'Direct Investment'
WHERE investment_type_category = 'direct_investments';

COMMIT;
