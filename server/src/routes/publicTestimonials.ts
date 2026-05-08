import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { resolveFileUrl } from "../utils/uploadBase64Image.js";

const router = Router();

interface TestimonialRow {
  id: number;
  display_order: number;
  perspective_text: string;
  description: string;
  status: boolean;
  metrics: string | null;
  role: string | null;
  organization_name: string | null;
  video_link: string | null;
  linked_investment_ids: number[] | null;
  linked_custom_page_slugs: string[] | null;
  first_name: string | null;
  last_name: string | null;
  picture_file_name: string | null;
}

function toIntArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((s) => s.length > 0);
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const conditions: string[] = [
      "(t.is_deleted IS NULL OR t.is_deleted = false)",
      "t.status = true",
    ];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    const investmentIdRaw = req.query.investmentId ?? req.query.InvestmentId;
    if (investmentIdRaw !== undefined && investmentIdRaw !== null && String(investmentIdRaw).trim() !== "") {
      const investmentId = parseInt(String(investmentIdRaw), 10);
      if (!Number.isInteger(investmentId) || investmentId <= 0) {
        res.status(400).json({ message: "Invalid investmentId" });
        return;
      }
      conditions.push(`t.linked_investment_ids @> ARRAY[$${paramIdx}]::INTEGER[]`);
      values.push(investmentId);
      paramIdx++;
    }

    const customPageSlugRaw = req.query.customPageSlug ?? req.query.CustomPageSlug;
    if (customPageSlugRaw !== undefined && customPageSlugRaw !== null && String(customPageSlugRaw).trim() !== "") {
      const slug = String(customPageSlugRaw).trim();
      conditions.push(`t.linked_custom_page_slugs @> ARRAY[$${paramIdx}]::TEXT[]`);
      values.push(slug);
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const result = await pool.query<TestimonialRow>(
      `SELECT
         t.id, t.display_order, t.perspective_text, t.description,
         t.status, t.metrics, t.role, t.organization_name,
         t.video_link, t.linked_investment_ids, t.linked_custom_page_slugs,
         u.first_name, u.last_name, u.picture_file_name
       FROM testimonials t
       LEFT JOIN users u ON t.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       ${whereClause}
       ORDER BY t.display_order ASC, t.id DESC`,
      values
    );

    const items = result.rows.map((r) => {
      let metrics: Array<{ key: string; value: string }> = [];
      if (r.metrics) {
        try {
          const raw: unknown = JSON.parse(r.metrics);
          if (Array.isArray(raw)) {
            metrics = raw.map((m): { key: string; value: string } => {
              const rec = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
              const key = rec.Key ?? rec.key;
              const value = rec.Value ?? rec.value;
              return {
                key: typeof key === "string" ? key : "",
                value: typeof value === "string" ? value : "",
              };
            });
          }
        } catch { metrics = []; }
      }

      return {
        id: r.id,
        displayOrder: r.display_order,
        perspectiveText: r.perspective_text,
        description: r.description,
        metrics,
        role: r.role,
        organizationName: r.organization_name,
        userFullName: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        profilePicture: resolveFileUrl(r.picture_file_name, "users"),
        videoLink: r.video_link ?? null,
        linkedInvestmentIds: toIntArray(r.linked_investment_ids),
        linkedCustomPageSlugs: toStringArray(r.linked_custom_page_slugs),
      };
    });

    res.json(items);
  } catch (err) {
    console.error("Public Testimonials GetAll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
