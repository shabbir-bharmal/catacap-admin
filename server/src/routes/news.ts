import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, handleMissingTableError } from "../utils/softDelete.js";
import { resolveFileUrl, uploadBase64Image, extractStoragePath, ensureFolderPrefix } from "../utils/uploadBase64Image.js";

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
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    softDeleteFilter("n", params.isDeleted, conditions);

    if (params.searchValue) {
      conditions.push(`LOWER(n.title) LIKE $${paramIdx}`);
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    if (params.status) {
      const statusBool = params.status.toLowerCase() === "true";
      conditions.push(`n.status = $${paramIdx}`);
      values.push(statusBool);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortMap: Record<string, string> = {
      title: "n.title",
      type: "nt.value",
      date: "n.news_date",
      status: "n.status",
    };
    const sortField = (params.sortField || "").toLowerCase();
    let orderClause: string;
    if (sortMap[sortField]) {
      orderClause = `${sortMap[sortField]} ${isAsc ? "ASC" : "DESC"}`;
    } else {
      orderClause = `n.news_date DESC, n.id DESC`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM news n
       LEFT JOIN site_configurations nt ON n.news_type_id = nt.id
       LEFT JOIN site_configurations aud ON n.audience_id = aud.id
       LEFT JOIN themes th ON n.theme_id = th.id
       ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         n.id, n.title, n.description,
         n.news_type_id, nt.value AS type_name,
         n.audience_id, aud.value AS audience_name,
         n.theme_id AS theme_id, th.name AS theme_name,
         n.image_file_name, n.status, n.news_link,
         n.linked_investment_ids, n.linked_custom_page_slugs,
         CASE WHEN n.news_date IS NOT NULL
           THEN TO_CHAR(n.news_date, 'DD Mon YYYY')
           ELSE NULL
         END AS formatted_date,
         n.deleted_at,
         du.first_name || ' ' || du.last_name AS deleted_by_name
       FROM news n
       LEFT JOIN site_configurations nt ON n.news_type_id = nt.id
       LEFT JOIN site_configurations aud ON n.audience_id = aud.id
       LEFT JOIN themes th ON n.theme_id = th.id
       LEFT JOIN users du ON n.deleted_by = du.id
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      typeId: r.news_type_id,
      type: r.type_name,
      audienceId: r.audience_id,
      audience: r.audience_name,
      themeId: r.theme_id,
      theme: r.theme_name,
      imageFileName: resolveFileUrl(r.image_file_name, "news"),
      status: r.status ?? false,
      link: r.news_link,
      newsDate: r.formatted_date,
      linkedInvestmentIds: normalizeIntIds(r.linked_investment_ids),
      linkedCustomPageSlugs: normalizeSlugs(r.linked_custom_page_slugs),
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by_name,
    }));

    res.json({ totalCount: parseInt(countResult.rows[0].total) || 0, items });
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("News GetAll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const result = await pool.query(
      `SELECT n.id, n.title, n.description,
              n.news_type_id, nt.value AS type_name,
              n.audience_id, aud.value AS audience_name,
              n.theme_id AS theme_id, th.name AS theme_name,
              n.image_file_name, n.news_link, n.status,
              n.linked_investment_ids, n.linked_custom_page_slugs,
              n.news_date::text AS news_date
       FROM news n
       LEFT JOIN site_configurations nt ON n.news_type_id = nt.id
       LEFT JOIN site_configurations aud ON n.audience_id = aud.id
       LEFT JOIN themes th ON n.theme_id = th.id
       WHERE n.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "News not found." });
      return;
    }

    const r = result.rows[0];
    res.json({
      id: r.id,
      title: r.title,
      description: r.description,
      typeId: r.news_type_id,
      type: r.type_name,
      audienceId: r.audience_id,
      audience: r.audience_name,
      themeId: r.theme_id,
      theme: r.theme_name,
      imageFileName: resolveFileUrl(r.image_file_name, "news"),
      link: r.news_link,
      status: r.status ?? false,
      newsDate: r.news_date,
      linkedInvestmentIds: normalizeIntIds(r.linked_investment_ids),
      linkedCustomPageSlugs: normalizeSlugs(r.linked_custom_page_slugs),
    });
  } catch (err) {
    console.error("News GetById error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const dto = req.body;
    if (!dto || !dto.title?.trim()) {
      res.json({ success: false, message: "Title is required." });
      return;
    }

    const userId = req.user?.id || null;

    let imageFileName: string | null = null;
    const base64Data = [dto.image, dto.imageFileName].find((v) => v && typeof v === "string" && v.startsWith("data:"));
    if (base64Data) {
      const uploadResult = await uploadBase64Image(base64Data, "news");
      imageFileName = uploadResult.filePath;
    } else {
      const existingPath = dto.imageFileName || dto.image || null;
      if (existingPath) {
        imageFileName = ensureFolderPrefix(extractStoragePath(existingPath) || existingPath, "news");
      }
    }

    const linkedInvestmentIds = normalizeIntIds(dto.linkedInvestmentIds);
    const linkedCustomPageSlugs = normalizeSlugs(dto.linkedCustomPageSlugs);

    if (dto.id && dto.id > 0) {
      const existing = await pool.query(`SELECT id, image_file_name FROM news WHERE id = $1`, [dto.id]);
      if (existing.rows.length === 0) {
        res.json({ success: false, message: "News not found." });
        return;
      }

      await pool.query(
        `UPDATE news SET
           title = $1, description = $2, news_type_id = $3, audience_id = $4,
           theme_id = $5, image_file_name = COALESCE($6, image_file_name),
           news_link = $7, status = $8, news_date = $9,
           linked_investment_ids = $10::INTEGER[],
           linked_custom_page_slugs = $11::TEXT[],
           modified_at = NOW(), modified_by = $12
         WHERE id = $13`,
        [
          dto.title, dto.description, dto.newsTypeId, dto.audienceId,
          dto.themeId, imageFileName,
          dto.newsLink, dto.status, dto.newsDate,
          linkedInvestmentIds, linkedCustomPageSlugs,
          userId, dto.id,
        ]
      );

      res.json({ success: true, message: "News updated successfully.", data: dto.id });
    } else {
      const result = await pool.query(
        `INSERT INTO news (title, description, news_type_id, audience_id, theme_id,
           image_file_name, news_link, status, news_date,
           linked_investment_ids, linked_custom_page_slugs,
           created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::INTEGER[], $11::TEXT[], NOW(), $12)
         RETURNING id`,
        [
          dto.title, dto.description, dto.newsTypeId, dto.audienceId,
          dto.themeId, imageFileName,
          dto.newsLink, dto.status, dto.newsDate,
          linkedInvestmentIds, linkedCustomPageSlugs,
          userId,
        ]
      );

      res.json({ success: true, message: "News created successfully.", data: result.rows[0].id });
    }
  } catch (err) {
    console.error("News CreateOrUpdate error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const userId = req.user?.id || null;
    const existing = await pool.query(`SELECT id FROM news WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.json({ success: false, message: "News not found." });
      return;
    }

    await pool.query(
      `UPDATE news SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
      [userId, id]
    );

    res.json({ success: true, message: "News deleted successfully." });
  } catch (err) {
    console.error("News Delete error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/restore", async (req: Request, res: Response) => {
  try {
    const ids: number[] = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({ success: false, message: "No IDs provided." });
      return;
    }

    const result = await pool.query(
      `UPDATE news SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
       WHERE id = ANY($1) AND is_deleted = true
       RETURNING id`,
      [ids]
    );

    if (result.rowCount === 0) {
      res.json({ success: false, message: "No deleted news found." });
      return;
    }

    res.json({ success: true, message: `${result.rowCount} news item(s) restored successfully.` });
  } catch (err) {
    console.error("News Restore error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
