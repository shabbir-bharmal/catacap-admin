import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, handleMissingTableError } from "../utils/softDelete.js";
import { resolveFileUrl } from "../utils/uploadBase64Image.js";

const router = Router();

function normalizeIntIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((v: unknown) => parseInt(String(v), 10))
        .filter((n: number) => Number.isInteger(n) && n > 0)
    )
  );
}

function normalizeSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((v: unknown) => (v == null ? "" : String(v).trim()))
        .filter((s: string) => s.length > 0)
    )
  );
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    if (!params.perPage || params.perPage === 10) params.perPage = 50;
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    softDeleteFilter("t", params.isDeleted, conditions);

    if (params.searchValue) {
      conditions.push(
        `(LOWER(COALESCE(u.first_name, '')) LIKE $${paramIdx} OR LOWER(COALESCE(u.last_name, '')) LIKE $${paramIdx} OR LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $${paramIdx})`
      );
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const perspectiveText = (req.query.PerspectiveText || req.query.perspectiveText) as string | undefined;
    if (perspectiveText) {
      conditions.push(`t.perspective_text ILIKE $${paramIdx}`);
      values.push(perspectiveText);
      paramIdx++;
    }

    if (params.status) {
      if (params.status.toLowerCase() === "active") {
        conditions.push(`t.status = true`);
      } else if (params.status.toLowerCase() === "draft") {
        conditions.push(`t.status = false`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortMap: Record<string, string> = {
      person: "u.first_name",
      perspective: "t.perspective_text",
      status: "t.status",
      displayorder: "t.display_order",
    };
    const sortField = (params.sortField || "").toLowerCase();
    let orderClause: string;
    if (sortField === "person") {
      orderClause = isAsc
        ? "u.first_name ASC, u.last_name ASC"
        : "u.first_name DESC, u.last_name DESC";
    } else if (sortMap[sortField]) {
      orderClause = `${sortMap[sortField]} ${isAsc ? "ASC" : "DESC"}`;
    } else {
      orderClause = "t.display_order ASC, t.id DESC";
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM testimonials t
       LEFT JOIN users u ON t.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         t.id, t.display_order, t.perspective_text, t.description,
         t.status, t.metrics, t.role, t.organization_name,
         t.video_link, t.linked_investment_ids, t.linked_custom_page_slugs,
         u.first_name, u.last_name, u.id AS user_id, u.picture_file_name,
         t.deleted_at,
         du.first_name AS del_fn, du.last_name AS del_ln
       FROM testimonials t
       LEFT JOIN users u ON t.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       LEFT JOIN users du ON t.deleted_by = du.id
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((r: any) => {
      let metrics: Array<{ key: string; value: string }> = [];
      if (r.metrics) {
        try {
          const raw = JSON.parse(r.metrics);
          metrics = raw.map((m: any) => ({
            key: m.Key || m.key || "",
            value: m.Value || m.value || "",
          }));
        } catch { metrics = []; }
      }

      return {
        id: r.id,
        displayOrder: r.display_order,
        perspectiveText: r.perspective_text,
        description: r.description,
        status: r.status ?? false,
        metrics,
        role: r.role,
        organizationName: r.organization_name,
        userFullName: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        userId: r.user_id,
        profilePicture: resolveFileUrl(r.picture_file_name, "users"),
        videoLink: r.video_link ?? null,
        linkedInvestmentIds: normalizeIntIds(r.linked_investment_ids),
        linkedCustomPageSlugs: normalizeSlugs(r.linked_custom_page_slugs),
        deletedAt: r.deleted_at,
        deletedBy: r.del_fn ? `${r.del_fn} ${r.del_ln}` : null,
      };
    });

    res.json({ items, totalCount: parseInt(countResult.rows[0].total) || 0 });
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("Testimonials GetAll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const result = await pool.query(
      `SELECT t.id, t.display_order, t.perspective_text, t.description,
              t.status, t.metrics, t.role, t.organization_name,
              t.video_link, t.linked_investment_ids, t.linked_custom_page_slugs,
              u.first_name, u.last_name, u.id AS user_id, u.picture_file_name
       FROM testimonials t
       LEFT JOIN users u ON t.user_id = u.id AND (u.is_deleted IS NULL OR u.is_deleted = false)
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "Testimonial not found." });
      return;
    }

    const r = result.rows[0];
    let metrics: Array<{ key: string; value: string }> = [];
    if (r.metrics) {
      try {
        const raw = JSON.parse(r.metrics);
        metrics = raw.map((m: any) => ({
          key: m.Key || m.key || "",
          value: m.Value || m.value || "",
        }));
      } catch { metrics = []; }
    }

    res.json({
      id: r.id,
      displayOrder: r.display_order,
      perspectiveText: r.perspective_text,
      description: r.description,
      status: r.status ?? false,
      metrics,
      role: r.role,
      organizationName: r.organization_name,
      userFullName: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
      userId: r.user_id,
      profilePicture: resolveFileUrl(r.picture_file_name, "users"),
      videoLink: r.video_link ?? null,
      linkedInvestmentIds: normalizeIntIds(r.linked_investment_ids),
      linkedCustomPageSlugs: normalizeSlugs(r.linked_custom_page_slugs),
    });
  } catch (err) {
    console.error("Testimonials GetById error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const dto = req.body;
    if (!dto) { res.status(400).json({ message: "Invalid data." }); return; }

    const dupCheck = await pool.query(
      `SELECT id FROM testimonials
       WHERE display_order = $1 AND ($2::int IS NULL OR id != $2)
       AND (is_deleted IS NULL OR is_deleted = false)`,
      [dto.displayOrder, dto.id || null]
    );

    if (dupCheck.rows.length > 0) {
      res.json({ success: false, message: "Display order already exists." });
      return;
    }

    const linkedInvestmentIds = normalizeIntIds(dto.linkedInvestmentIds);
    const linkedCustomPageSlugs = normalizeSlugs(dto.linkedCustomPageSlugs);

    const metricsJson = dto.metrics ? JSON.stringify(
      dto.metrics.map((m: any) => ({ Key: m.key || m.Key || "", Value: m.value || m.Value || "" }))
    ) : null;

    const videoLinkRaw = typeof dto.videoLink === "string" ? dto.videoLink.trim() : null;
    const videoLink = videoLinkRaw && videoLinkRaw.length > 0 ? videoLinkRaw : null;

    await client.query("BEGIN");

    let savedId: number;

    if (dto.id && dto.id > 0) {
      const existing = await client.query(`SELECT id FROM testimonials WHERE id = $1`, [dto.id]);
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "Testimonial not found." });
        return;
      }

      await client.query(
        `UPDATE testimonials SET
           display_order = $1, perspective_text = $2, description = $3,
           status = $4, metrics = $5, role = $6,
           organization_name = $7, user_id = $8,
           video_link = $9,
           linked_investment_ids = $10::INTEGER[],
           linked_custom_page_slugs = $11::TEXT[]
         WHERE id = $12`,
        [
          dto.displayOrder, dto.perspectiveText, dto.description,
          dto.status, metricsJson, dto.role,
          dto.organizationName, dto.userId,
          videoLink,
          linkedInvestmentIds,
          linkedCustomPageSlugs,
          dto.id,
        ]
      );

      savedId = dto.id;
      await client.query("COMMIT");
      res.json({ success: true, message: "Testimonial updated successfully.", data: savedId });
    } else {
      const result = await client.query(
        `INSERT INTO testimonials (display_order, perspective_text, description,
           status, metrics, role, organization_name, user_id,
           video_link, linked_investment_ids, linked_custom_page_slugs, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::INTEGER[], $11::TEXT[], NOW())
         RETURNING id`,
        [
          dto.displayOrder, dto.perspectiveText, dto.description,
          dto.status, metricsJson, dto.role,
          dto.organizationName, dto.userId,
          videoLink,
          linkedInvestmentIds,
          linkedCustomPageSlugs,
        ]
      );

      savedId = result.rows[0].id as number;
      await client.query("COMMIT");
      res.json({ success: true, message: "Testimonial created successfully.", data: savedId });
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    console.error("Testimonials Create error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const userId = req.user?.id || null;
    const existing = await pool.query(`SELECT id FROM testimonials WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.json({ success: false, message: "Testimonial not found." });
      return;
    }

    await pool.query(
      `UPDATE testimonials SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
      [userId, id]
    );

    res.json({ success: true, message: "Testimonial deleted successfully." });
  } catch (err) {
    console.error("Testimonials Delete error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const ids: number[] = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    let restoredCount = 0;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE testimonials SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
         WHERE id = ANY($1) AND is_deleted = true
         RETURNING id`,
        [ids]
      );
      restoredCount = result.rowCount ?? 0;

      if (restoredCount === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "No deleted testimonials found." });
        return;
      }

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    }

    res.json({
      success: true,
      message: `${restoredCount} testimonial(s) restored successfully.`,
      restoredCount,
      restoredUserCount: 0,
    });
  } catch (err) {
    console.error("Testimonials Restore error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
