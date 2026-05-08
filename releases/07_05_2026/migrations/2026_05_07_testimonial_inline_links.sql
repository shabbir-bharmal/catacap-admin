-- Migration: Success Stories — inline link arrays + drop show_on_home
-- Date: 2026-05-07
-- Purpose:
--   Per product clarification, replace the `testimonial_links` junction
--   table with two array columns directly on `testimonials`. A single
--   testimonial can be linked to BOTH investments AND custom pages
--   simultaneously (no exclusive-OR), each list is multi-select. The
--   home-page surface is treated as just another custom page (a
--   "home" slug entry in the custom-pages list), so the dedicated
--   `show_on_home` boolean is removed.
--
--   New columns:
--     - linked_investment_ids   INTEGER[] NOT NULL DEFAULT '{}'
--         Multi-select list of campaign ids the story is linked to.
--     - linked_custom_page_slugs TEXT[]   NOT NULL DEFAULT '{}'
--         Multi-select list of custom-page slugs (incl. the home slug)
--         the story is linked to.
--
--   GIN indexes are added on both arrays so the public endpoint can
--   filter cheaply with `<array> @> ARRAY[$1]`.
--
--   The old `testimonial_links` table and the `show_on_home` column
--   are dropped. There is no data to preserve in production for these
--   surfaces yet (the prior migration was applied but the surfaces
--   were never released to public users), so no data backfill is
--   required.

BEGIN;

-- video_link was originally introduced by the (now no-op) sibling
-- migration 2026_05_07_testimonial_video_show_on_home.sql. We re-add
-- it here idempotently so this file is the single source of truth
-- for the final testimonials schema in this release.
ALTER TABLE testimonials
    ADD COLUMN IF NOT EXISTS video_link TEXT NULL;

ALTER TABLE testimonials
    ADD COLUMN IF NOT EXISTS linked_investment_ids INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[];

ALTER TABLE testimonials
    ADD COLUMN IF NOT EXISTS linked_custom_page_slugs TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS idx_testimonials_linked_investment_ids
    ON testimonials USING GIN (linked_investment_ids);

CREATE INDEX IF NOT EXISTS idx_testimonials_linked_custom_page_slugs
    ON testimonials USING GIN (linked_custom_page_slugs);

ALTER TABLE testimonials
    DROP COLUMN IF EXISTS show_on_home;

DROP TABLE IF EXISTS testimonial_links;

COMMIT;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- ALTER TABLE testimonials DROP COLUMN IF EXISTS linked_investment_ids;
-- ALTER TABLE testimonials DROP COLUMN IF EXISTS linked_custom_page_slugs;
-- ALTER TABLE testimonials ADD  COLUMN IF NOT EXISTS show_on_home BOOLEAN NOT NULL DEFAULT TRUE;
-- -- The previous testimonial_links table can be re-created from
-- -- 2026_05_07_testimonial_links.sql if needed.
-- COMMIT;
-- =============================================================================
