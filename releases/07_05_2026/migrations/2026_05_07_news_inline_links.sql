-- Migration: News — link to investments + link to custom pages (inline arrays)
-- Date: 2026-05-07
--
-- Mirrors the testimonials inline-links model (same release):
--   linked_investment_ids   INTEGER[] NOT NULL DEFAULT '{}'
--   linked_custom_page_slugs TEXT[]   NOT NULL DEFAULT '{}'
-- Both are independent multi-selects; an article can link to BOTH lists
-- simultaneously. The "home" page is treated as just another custom-page
-- slug (no dedicated boolean), matching how Success Stories handles it.
--
-- Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
-- and wrapped in a single transaction. Re-runs are safe.

BEGIN;

ALTER TABLE news
    ADD COLUMN IF NOT EXISTS linked_investment_ids INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[];

ALTER TABLE news
    ADD COLUMN IF NOT EXISTS linked_custom_page_slugs TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS idx_news_linked_investment_ids
    ON news USING GIN (linked_investment_ids);

CREATE INDEX IF NOT EXISTS idx_news_linked_custom_page_slugs
    ON news USING GIN (linked_custom_page_slugs);

COMMIT;

-- Rollback (manual):
-- BEGIN;
--   DROP INDEX IF EXISTS idx_news_linked_custom_page_slugs;
--   DROP INDEX IF EXISTS idx_news_linked_investment_ids;
--   ALTER TABLE news DROP COLUMN IF EXISTS linked_custom_page_slugs;
--   ALTER TABLE news DROP COLUMN IF EXISTS linked_investment_ids;
-- COMMIT;
