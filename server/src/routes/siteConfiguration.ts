import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { softDeleteFilter } from "../utils/softDelete.js";
import { resolveFileUrl, uploadBase64Image, extractStoragePath, ensureFolderPrefix } from "../utils/uploadBase64Image.js";
import { invalidateEmailConfigCache } from "../utils/emailService.js";

const router = Router();

const SITE_CONFIG_TYPES = {
  StaticValue: "StaticValue",
  Configuration: "Configuration",
  TransactionType: "TransactionType",
  Statistics: "Statistics",
  NewsType: "NewsType",
  NewsAudience: "NewsAudience",
  MetaInformation: "MetaInformation",
  ContactInfo: "ContactInfo",
  InvestmentTypeCategory: "InvestmentTypeCategory",
} as const;

function getDeletedFilter(isDeleted: boolean | undefined): string {
  const conds: string[] = [];
  softDeleteFilter("x", isDeleted === true ? true : undefined, conds);
  return conds[0] || "(x.is_deleted IS NULL OR x.is_deleted = false)";
}

function getSoftDeleteCondition(alias: string, isDeletedParam: string | undefined): string {
  if (isDeletedParam === "true") return `${alias}.is_deleted = true`;
  return `(${alias}.is_deleted IS NULL OR ${alias}.is_deleted = false)`;
}

// ──────────────────────────────────────────────────────────────────────
// Batched lookup endpoint
// ──────────────────────────────────────────────────────────────────────
// The admin Site Configuration page previously fired ~12 parallel GETs
// (one per tab/section) when callers used `fetchAllSiteConfigurations`.
// Combined with scheduler activity, that pushed total connections past
// Supavisor's 15-session session-mode ceiling and surfaced as 500s with
// `EMAXCONNSESSION ... pool_size: 15`.
//
// `GET /bulk?types=type1,type2,...` (or no `types` query for all known
// sections) pins one pooled client and runs each section's query
// sequentially, returning a keyed payload that mirrors the per-type
// endpoint shapes. The per-type endpoints remain in place.
const BULK_SECTIONS = [
  "sourcedby",
  "themes",
  "special-filters",
  "transaction-type",
  "investment-type-category",
  "investment-terms",
  "configuration",
  "news-type",
  "news-audience",
  "statistics",
  "meta-information",
  "contact-info",
  "daf-providers",
] as const;

router.get("/bulk", async (req: Request, res: Response) => {
  let client: import("pg").PoolClient | null = null;
  try {
    client = await pool.connect();
    const isDeletedParam = (req.query.isDeleted || req.query.IsDeleted) as string | undefined;
    const softDelete = getSoftDeleteCondition("x", isDeletedParam);
    const requested = String(req.query.types || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const sections = requested.length > 0
      ? BULK_SECTIONS.filter((s) => requested.includes(s))
      : [...BULK_SECTIONS];

    const result: Record<string, unknown[]> = {};
    for (const section of sections) {
      try {
        switch (section) {
          case "investment-terms": {
            const r = await client.query(
              `SELECT x.id, x.key, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete}
               ORDER BY x.key`,
              [SITE_CONFIG_TYPES.StaticValue]
            );
            result[section] = r.rows;
            break;
          }
          case "configuration": {
            const r = await client.query(
              `SELECT x.id, x.key, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete}
               ORDER BY x.key`,
              [SITE_CONFIG_TYPES.Configuration]
            );
            result[section] = r.rows;
            break;
          }
          case "sourcedby": {
            const r = await client.query(
              `SELECT x.id, x.name AS value FROM approvers x
               WHERE ${softDelete} ORDER BY x.name`
            );
            result[section] = r.rows;
            break;
          }
          case "themes": {
            const r = await client.query(
              `SELECT x.id, x.name AS value, x.image_file_name AS "imageFileName", x.description
               FROM themes x WHERE ${softDelete} ORDER BY x.name`
            );
            result[section] = r.rows.map((row: any) => ({
              ...row,
              imageFileName: resolveFileUrl(row.imageFileName, "themes"),
            }));
            break;
          }
          case "special-filters": {
            const r = await client.query(
              `SELECT x.id, x.tag AS value FROM investment_tags x
               WHERE ${softDelete} ORDER BY x.tag`
            );
            result[section] = r.rows;
            break;
          }
          case "transaction-type": {
            const r = await client.query(
              `SELECT x.id, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete} ORDER BY x.value`,
              [SITE_CONFIG_TYPES.TransactionType]
            );
            result[section] = r.rows;
            break;
          }
          case "investment-type-category": {
            const r = await client.query(
              `SELECT x.id, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete} ORDER BY x.value`,
              [SITE_CONFIG_TYPES.InvestmentTypeCategory]
            );
            result[section] = r.rows;
            break;
          }
          case "news-type": {
            const r = await client.query(
              `SELECT x.id, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete} ORDER BY x.value`,
              [SITE_CONFIG_TYPES.NewsType]
            );
            result[section] = r.rows;
            break;
          }
          case "news-audience": {
            const r = await client.query(
              `SELECT x.id, x.value FROM site_configurations x
               WHERE x.type = $1 AND ${softDelete} ORDER BY x.value`,
              [SITE_CONFIG_TYPES.NewsAudience]
            );
            result[section] = r.rows;
            break;
          }
          case "statistics": {
            const r = await client.query(
              `SELECT x.id, x.key, x.value,
                      REPLACE(x.type, 'Statistics-', '') AS type
               FROM site_configurations x
               WHERE x.type LIKE $1 AND ${softDelete} ORDER BY x.key`,
              [`${SITE_CONFIG_TYPES.Statistics}%`]
            );
            result[section] = r.rows;
            break;
          }
          case "meta-information": {
            const r = await client.query(
              `SELECT x.id, x.key, x.image, x.image_name AS "imageName",
                      x.value, x.additional_details AS "additionalDetails"
               FROM site_configurations x
               WHERE x.type LIKE $1 AND ${softDelete} ORDER BY x.key`,
              [`${SITE_CONFIG_TYPES.MetaInformation}%`]
            );
            result[section] = r.rows.map((row: any) => ({
              ...row,
              image: resolveFileUrl(row.image, "site-configurations"),
              imageName: resolveFileUrl(row.imageName, "site-configurations"),
            }));
            break;
          }
          case "contact-info": {
            const r = await client.query(
              `SELECT x.id, x.key, x.value,
                      x.additional_details AS "description",
                      REPLACE(x.type, 'ContactInfo-', '') AS type
               FROM site_configurations x
               WHERE x.type LIKE $1 AND ${softDelete} ORDER BY x.type, x.key`,
              [`${SITE_CONFIG_TYPES.ContactInfo}-%`]
            );
            result[section] = r.rows;
            break;
          }
          case "daf-providers": {
            const r = await client.query(
              `SELECT id,
                      provider_name AS "value",
                      provider_url AS "link",
                      is_active AS "isActive"
               FROM daf_providers ORDER BY provider_name`
            );
            result[section] = r.rows;
            break;
          }
        }
      } catch (sectionErr) {
        // Don't let a single broken section take the whole payload down —
        // mirror the page's existing per-tab error tolerance.
        console.error(`SiteConfig bulk: section "${section}" failed:`, sectionErr);
        result[section] = [];
      }
    }

    res.json(result);
  } catch (err) {
    console.error("SiteConfig bulk error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  } finally {
    if (client) client.release();
  }
});

router.get("/slug/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    if (!slug?.trim()) {
      res.json({ success: false, message: "Slug is required." });
      return;
    }

    const campaignCheck = await pool.query(
      `SELECT 1 FROM campaigns WHERE property = $1 LIMIT 1`,
      [slug]
    );
    const groupCheck = await pool.query(
      `SELECT 1 FROM groups WHERE identifier = $1 LIMIT 1`,
      [slug]
    );

    res.json({ exists: campaignCheck.rows.length > 0 || groupCheck.rows.length > 0 });
  } catch (err) {
    console.error("SlugCheck error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:type", async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type).toLowerCase().trim();
    const isDeletedParam = (req.query.isDeleted || req.query.IsDeleted) as string | undefined;
    const softDelete = getSoftDeleteCondition("x", isDeletedParam);

    switch (type) {
      case "investment-terms": {
        const result = await pool.query(
          `SELECT x.id, x.key, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.key`,
          [SITE_CONFIG_TYPES.StaticValue]
        );
        res.json(result.rows);
        return;
      }

      case "configuration": {
        const result = await pool.query(
          `SELECT x.id, x.key, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.key`,
          [SITE_CONFIG_TYPES.Configuration]
        );
        res.json(result.rows);
        return;
      }

      case "sourcedby": {
        const result = await pool.query(
          `SELECT x.id, x.name AS value FROM approvers x
           WHERE ${softDelete}
           ORDER BY x.name`
        );
        res.json(result.rows);
        return;
      }

      case "themes": {
        const result = await pool.query(
          `SELECT x.id, x.name AS value, x.image_file_name AS "imageFileName", x.description
           FROM themes x
           WHERE ${softDelete}
           ORDER BY x.name`
        );
        res.json(result.rows.map((r: any) => ({ ...r, imageFileName: resolveFileUrl(r.imageFileName, "themes") })));
        return;
      }

      case "special-filters": {
        const result = await pool.query(
          `SELECT x.id, x.tag AS value FROM investment_tags x
           WHERE ${softDelete}
           ORDER BY x.tag`
        );
        res.json(result.rows);
        return;
      }

      case "transaction-type": {
        const result = await pool.query(
          `SELECT x.id, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.value`,
          [SITE_CONFIG_TYPES.TransactionType]
        );
        res.json(result.rows);
        return;
      }

      case "investment-type-category": {
        const result = await pool.query(
          `SELECT x.id, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.value`,
          [SITE_CONFIG_TYPES.InvestmentTypeCategory]
        );
        res.json(result.rows);
        return;
      }

      case "news-type": {
        const result = await pool.query(
          `SELECT x.id, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.value`,
          [SITE_CONFIG_TYPES.NewsType]
        );
        res.json(result.rows);
        return;
      }

      case "news-audience": {
        const result = await pool.query(
          `SELECT x.id, x.value FROM site_configurations x
           WHERE x.type = $1 AND ${softDelete}
           ORDER BY x.value`,
          [SITE_CONFIG_TYPES.NewsAudience]
        );
        res.json(result.rows);
        return;
      }

      case "statistics": {
        const result = await pool.query(
          `SELECT x.id, x.key, x.value,
                  REPLACE(x.type, 'Statistics-', '') AS type
           FROM site_configurations x
           WHERE x.type LIKE $1 AND ${softDelete}
           ORDER BY x.key`,
          [`${SITE_CONFIG_TYPES.Statistics}%`]
        );
        res.json(result.rows);
        return;
      }

      case "meta-information": {
        const result = await pool.query(
          `SELECT x.id, x.key, x.image, x.image_name AS "imageName",
                  x.value, x.additional_details AS "additionalDetails"
           FROM site_configurations x
           WHERE x.type LIKE $1 AND ${softDelete}
           ORDER BY x.key`,
          [`${SITE_CONFIG_TYPES.MetaInformation}%`]
        );
        res.json(result.rows.map((r: any) => ({
          ...r,
          image: resolveFileUrl(r.image, "site-configurations"),
          imageName: resolveFileUrl(r.imageName, "site-configurations"),
        })));
        return;
      }

      case "contact-info": {
        const result = await pool.query(
          `SELECT x.id, x.key, x.value,
                  x.additional_details AS "description",
                  REPLACE(x.type, 'ContactInfo-', '') AS type
           FROM site_configurations x
           WHERE x.type LIKE $1 AND ${softDelete}
           ORDER BY x.type, x.key`,
          [`${SITE_CONFIG_TYPES.ContactInfo}-%`]
        );
        res.json(result.rows);
        return;
      }

      case "daf-providers": {
        const result = await pool.query(
          `SELECT id,
                  provider_name AS "value",
                  provider_url AS "link",
                  is_active AS "isActive"
           FROM daf_providers
           ORDER BY provider_name`
        );
        res.json(result.rows);
        return;
      }

      default:
        res.json([]);
    }
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `SiteConfig Get error: type=${String(req.params.type)} code=${code ?? "n/a"} message=${message}`,
    );
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const dto = req.body;
    if (!dto?.type?.trim()) {
      res.status(400).json({ message: "Type is required." });
      return;
    }

    const type = dto.type.toLowerCase().trim();
    const isUpdate = dto.id && dto.id > 0;

    if (isUpdate) {
      const result = await updateByType(type, dto);
      if (result.success) {
        invalidateEmailConfigCache();
      }
      res.json(result);
    } else {
      const result = await createByType(type, dto);
      if (result.success) {
        invalidateEmailConfigCache();
      }
      res.json(result);
    }
  } catch (err) {
    console.error("SiteConfig CreateOrUpdate error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:type/:id", async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type).toLowerCase().trim();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const userId = req.user?.id || null;
    let result: { success: boolean; message: string };

    switch (type) {
      case "investment-terms": {
        const entity = await pool.query(
          `SELECT id, key FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.StaticValue]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE terms LIKE $1 LIMIT 1`,
          [`%{${entity.rows[0].key}}%`]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this term, it's being used in investments." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Configuration deleted successfully." };
        break;
      }

      case "configuration": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.Configuration]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Configuration deleted successfully." };
        break;
      }

      case "sourcedby": {
        const entity = await pool.query(`SELECT id FROM approvers WHERE id = $1`, [id]);
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE (',' || approved_by || ',') LIKE $1 LIMIT 1`,
          [`%,${id},%`]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this sourced by, it's being used in investments." }); return; }
        await softDeleteRecord("approvers", id, userId);
        result = { success: true, message: "Sourced by deleted successfully." };
        break;
      }

      case "themes": {
        const entity = await pool.query(`SELECT id FROM themes WHERE id = $1`, [id]);
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const campaignUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE (',' || themes || ',') LIKE $1 LIMIT 1`,
          [`%,${id},%`]
        );
        const groupUse = await pool.query(
          `SELECT 1 FROM groups WHERE (',' || group_themes || ',') LIKE $1 LIMIT 1`,
          [`%,${id},%`]
        );
        if (campaignUse.rows.length > 0 || groupUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this theme, it's being used in investments or groups." });
          return;
        }
        await softDeleteRecord("themes", id, userId);
        result = { success: true, message: "Theme deleted successfully." };
        break;
      }

      case "special-filters": {
        const entity = await pool.query(`SELECT id FROM investment_tags WHERE id = $1`, [id]);
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM investment_tag_mappings WHERE tag_id = $1 LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this special filter, it's being used in investments." }); return; }
        await softDeleteRecord("investment_tags", id, userId);
        result = { success: true, message: "Special filter deleted successfully." };
        break;
      }

      case "transaction-type": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.TransactionType]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM completed_investment_details WHERE site_configuration_id = $1 LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this transaction type, it's being used in investments." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Transaction type deleted successfully." };
        break;
      }

      case "investment-type-category": {
        const entity = await pool.query(
          `SELECT id, value FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.InvestmentTypeCategory]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE investment_type_category = $1 LIMIT 1`,
          [entity.rows[0].value]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this investment type, it's being used in investments." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Investment type deleted successfully." };
        break;
      }

      case "news-type": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.NewsType]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM news WHERE news_type_id = $1 LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this news type, it's being used in News." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "News type deleted successfully." };
        break;
      }

      case "news-audience": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.NewsAudience]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        const inUse = await pool.query(
          `SELECT 1 FROM news WHERE audience_id = $1 LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) { res.json({ success: false, message: "Cannot delete this news audience, it's being used in News." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "News audience deleted successfully." };
        break;
      }

      case "statistics": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`,
          [id, `${SITE_CONFIG_TYPES.Statistics}%`]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Statistic deleted successfully." };
        break;
      }

      case "meta-information": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`,
          [id, `${SITE_CONFIG_TYPES.MetaInformation}%`]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Meta information deleted successfully." };
        break;
      }

      case "contact-info": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`,
          [id, `${SITE_CONFIG_TYPES.ContactInfo}-%`]
        );
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        await softDeleteRecord("site_configurations", id, userId);
        result = { success: true, message: "Contact info deleted successfully." };
        break;
      }

      case "daf-providers": {
        const entity = await pool.query(`SELECT id FROM daf_providers WHERE id = $1`, [id]);
        if (entity.rows.length === 0) { res.json({ success: false, message: "Record not found." }); return; }
        await pool.query(`DELETE FROM daf_providers WHERE id = $1`, [id]);
        result = { success: true, message: "DAF provider deleted successfully." };
        break;
      }

      default:
        result = { success: false, message: "Invalid configuration type." };
    }

    if (result.success) {
      invalidateEmailConfigCache();
    }
    res.json(result);
  } catch (err) {
    console.error("SiteConfig Delete error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/daf-providers/:id/toggle-active", async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ success: false, message: "Invalid ID" });
      return;
    }

    const updated = await pool.query(
      `UPDATE daf_providers SET is_active = NOT COALESCE(is_active, false) WHERE id = $1 RETURNING id`,
      [id]
    );
    if (updated.rows.length === 0) {
      res.json({ success: false, message: "Record not found." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("SiteConfig DAF toggle error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:type/:id/investments", async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type).toLowerCase();
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id) || id <= 0) { res.status(400).json({ message: "Invalid ID" }); return; }

    let result;

    if (type === "special-filters") {
      result = await pool.query(
        `SELECT c.id, c.name,
                EXISTS(SELECT 1 FROM investment_tag_mappings m WHERE m.campaign_id = c.id AND m.tag_id = $1) AS "isSelected"
         FROM campaigns c
         ORDER BY c.name`,
        [id]
      );
    } else {
      const columnMap: Record<string, string> = {
        themes: "themes",
        sourcedby: "approved_by",
        sdgs: "sdgs",
      };
      const column = columnMap[type];
      if (!column) { res.json([]); return; }

      result = await pool.query(
        `SELECT c.id, c.name,
                (',' || COALESCE(c.${column}, '') || ',') LIKE $1 AS "isSelected"
         FROM campaigns c
         ORDER BY c.name`,
        [`%,${id},%`]
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error("SiteConfig GetInvestments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:type/:id/investments/:investmentId", async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type).toLowerCase();
    const id = parseInt(String(req.params.id), 10);
    const investmentId = parseInt(String(req.params.investmentId), 10);

    if (isNaN(id) || id <= 0 || isNaN(investmentId) || investmentId <= 0) {
      res.status(400).json({ success: false, message: "Invalid id." });
      return;
    }

    let isAdded: boolean;

    if (type === "special-filters") {
      const existing = await pool.query(
        `SELECT id FROM investment_tag_mappings WHERE campaign_id = $1 AND tag_id = $2`,
        [investmentId, id]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `DELETE FROM investment_tag_mappings WHERE campaign_id = $1 AND tag_id = $2`,
          [investmentId, id]
        );
        isAdded = false;
      } else {
        await pool.query(
          `INSERT INTO investment_tag_mappings (tag_id, campaign_id) VALUES ($1, $2)`,
          [id, investmentId]
        );
        isAdded = true;
      }
    } else {
      const columnMap: Record<string, string> = {
        themes: "themes",
        sourcedby: "approved_by",
        sdgs: "sdgs",
      };
      const column = columnMap[type];
      if (!column) { res.status(400).json({ success: false, message: "Invalid type." }); return; }

      const campaign = await pool.query(
        `SELECT id, ${column} FROM campaigns WHERE id = $1`,
        [investmentId]
      );
      if (campaign.rows.length === 0) {
        res.status(404).json({ success: false, message: "Campaign not found." });
        return;
      }

      const currentValue = campaign.rows[0][column] || "";
      const list = currentValue
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s !== "" && !isNaN(parseInt(s, 10)))
        .map((s: string) => parseInt(s, 10));

      const idx = list.indexOf(id);
      if (idx !== -1) {
        list.splice(idx, 1);
        isAdded = false;
      } else {
        list.push(id);
        isAdded = true;
      }

      const newValue = list.length > 0 ? list.join(",") : null;
      await pool.query(
        `UPDATE campaigns SET ${column} = $1 WHERE id = $2`,
        [newValue, investmentId]
      );
    }

    res.json({
      success: true,
      message: isAdded ? "Investment mapping added successfully." : "Investment mapping removed successfully.",
    });
  } catch (err) {
    console.error("SiteConfig UpdateInvestments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function softDeleteRecord(table: string, id: number, userId: string | null): Promise<void> {
  await pool.query(
    `UPDATE ${table} SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
    [userId, id]
  );
}

async function createByType(type: string, dto: any): Promise<{ success: boolean; message: string }> {
  switch (type) {
    case "investment-terms": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.StaticValue, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.key.trim(), dto.value.trim(), SITE_CONFIG_TYPES.StaticValue]
      );
      return { success: true, message: "Configuration created successfully." };
    }

    case "configuration": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.Configuration, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.key.trim(), dto.value.trim(), SITE_CONFIG_TYPES.Configuration]
      );
      return { success: true, message: "Configuration created successfully." };
    }

    case "meta-information": {
      if (!dto.key?.trim()) return { success: false, message: "Page Title is required." };
      if (!dto.value?.trim()) return { success: false, message: "Description is required." };
      if (!dto.additionalDetails?.trim()) return { success: false, message: "Identifier is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.MetaInformation, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered Page Title already exists." };

      let metaImage: string | null = null;
      let metaImageName: string | null = null;
      const base64MetaData = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64MetaData) {
        const uploadResult = await uploadBase64Image(base64MetaData, "site-configurations");
        metaImage = uploadResult.filePath;
        metaImageName = uploadResult.filePath;
      } else {
        const existingMetaPath = dto.imageFileName || dto.image || null;
        if (existingMetaPath) {
          metaImageName = ensureFolderPrefix(extractStoragePath(existingMetaPath) || existingMetaPath, "site-configurations");
          metaImage = dto.image ? metaImageName : null;
        }
      }

      await pool.query(
        `INSERT INTO site_configurations (key, value, type, additional_details, image, image_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [dto.key.trim(), dto.value.trim(), SITE_CONFIG_TYPES.MetaInformation,
         dto.additionalDetails.trim(), metaImage, metaImageName]
      );
      return { success: true, message: "Configuration created successfully." };
    }

    case "statistics": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const fullType = `${SITE_CONFIG_TYPES.Statistics}-${dto.itemType || ""}`;
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [fullType, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.key.trim(), dto.value.trim(), fullType]
      );
      return { success: true, message: "Configuration created successfully." };
    }

    case "sourcedby": {
      if (!dto.value?.trim()) return { success: false, message: "Sourced by is required." };
      const dup = await pool.query(
        `SELECT 1 FROM approvers WHERE TRIM(name) = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered sourced by value already exists." };
      await pool.query(`INSERT INTO approvers (name) VALUES ($1)`, [dto.value.trim()]);
      return { success: true, message: "Sourced by created successfully." };
    }

    case "themes": {
      if (!dto.value?.trim()) return { success: false, message: "Theme is required." };
      const dup = await pool.query(
        `SELECT 1 FROM themes WHERE TRIM(name) = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered theme value already exists." };

      let themeImageFileName: string | null = null;
      const base64ThemeData = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64ThemeData) {
        const uploadResult = await uploadBase64Image(base64ThemeData, "themes");
        themeImageFileName = uploadResult.filePath;
      } else {
        const existingThemePath = dto.imageFileName || dto.image || null;
        if (existingThemePath) {
          themeImageFileName = ensureFolderPrefix(extractStoragePath(existingThemePath) || existingThemePath, "themes");
        }
      }

      await pool.query(
        `INSERT INTO themes (name, image_file_name, description, mandatory) VALUES ($1, $2, $3, $4)`,
        [dto.value.trim(), themeImageFileName, dto.description || null, true]
      );
      return { success: true, message: "Theme created successfully." };
    }

    case "special-filters": {
      if (!dto.value?.trim()) return { success: false, message: "Tag is required." };
      const dup = await pool.query(
        `SELECT 1 FROM investment_tags WHERE TRIM(tag) = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered tag value already exists." };
      await pool.query(`INSERT INTO investment_tags (tag) VALUES ($1)`, [dto.value.trim()]);
      return { success: true, message: "Special filter created successfully." };
    }

    case "transaction-type": {
      if (!dto.value?.trim()) return { success: false, message: "Transaction type is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.TransactionType, dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered transaction type value already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.value.trim(), dto.value.trim(), SITE_CONFIG_TYPES.TransactionType]
      );
      return { success: true, message: "Transaction type created successfully." };
    }

    case "investment-type-category": {
      if (!dto.value?.trim()) return { success: false, message: "Investment type is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.InvestmentTypeCategory, dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered investment type value already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.value.trim(), dto.value.trim(), SITE_CONFIG_TYPES.InvestmentTypeCategory]
      );
      return { success: true, message: "Investment type created successfully." };
    }

    case "news-type": {
      if (!dto.value?.trim()) return { success: false, message: "News type is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.NewsType, dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered news type value already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.value.trim(), dto.value.trim(), SITE_CONFIG_TYPES.NewsType]
      );
      return { success: true, message: "News type created successfully." };
    }

    case "news-audience": {
      if (!dto.value?.trim()) return { success: false, message: "News audience is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.NewsAudience, dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered news audience value already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.value.trim(), dto.value.trim(), SITE_CONFIG_TYPES.NewsAudience]
      );
      return { success: true, message: "News audience created successfully." };
    }

    case "contact-info": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      if (!dto.itemType?.trim()) return { success: false, message: "Group is required." };
      const fullType = `${SITE_CONFIG_TYPES.ContactInfo}-${dto.itemType.trim()}`;
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [fullType, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists in this group." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type, additional_details) VALUES ($1, $2, $3, $4)`,
        [dto.key.trim(), dto.value.trim(), fullType, dto.additionalDetails?.trim() || null]
      );
      return { success: true, message: "Contact info created successfully." };
    }

    case "daf-providers": {
      const name = (dto.value ?? "").trim();
      const url = (dto.link ?? "").trim();
      if (!name) return { success: false, message: "Provider name is required." };
      if (!url) return { success: false, message: "Provider URL is required." };
      const dup = await pool.query(
        `SELECT 1 FROM daf_providers WHERE LOWER(TRIM(provider_name)) = LOWER($1)`,
        [name]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered provider name already exists." };
      await pool.query(
        `INSERT INTO daf_providers (provider_name, provider_url, is_active) VALUES ($1, $2, $3)`,
        [name, url, true]
      );
      return { success: true, message: "DAF provider created successfully." };
    }

    default:
      return { success: false, message: "Invalid configuration type." };
  }
}

async function updateByType(type: string, dto: any): Promise<{ success: boolean; message: string }> {
  const id = dto.id;

  switch (type) {
    case "investment-terms": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const entity = await pool.query(`SELECT id FROM site_configurations WHERE id = $1 AND type = $2`, [id, SITE_CONFIG_TYPES.StaticValue]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND id != $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.StaticValue, dto.key.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(`UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`, [dto.key.trim(), dto.value.trim(), id]);
      return { success: true, message: "Configuration updated successfully." };
    }

    case "configuration": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const entity = await pool.query(`SELECT id FROM site_configurations WHERE id = $1 AND type = $2`, [id, SITE_CONFIG_TYPES.Configuration]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND id != $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [SITE_CONFIG_TYPES.Configuration, dto.key.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(`UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`, [dto.key.trim(), dto.value.trim(), id]);
      return { success: true, message: "Configuration updated successfully." };
    }

    case "meta-information": {
      if (!dto.key?.trim()) return { success: false, message: "Page Title is required." };
      if (!dto.value?.trim()) return { success: false, message: "Description is required." };
      if (!dto.additionalDetails?.trim()) return { success: false, message: "Identifier is required." };
      const entity = await pool.query(`SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`, [id, `${SITE_CONFIG_TYPES.MetaInformation}%`]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type LIKE $1 AND TRIM(key) = $2 AND id != $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [`${SITE_CONFIG_TYPES.MetaInformation}%`, dto.key.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered Page Title already exists." };

      const base64UpdMetaData = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64UpdMetaData) {
        const uploadResult = await uploadBase64Image(base64UpdMetaData, "site-configurations");
        await pool.query(
          `UPDATE site_configurations SET key = $1, value = $2, additional_details = $3, type = $4, image_name = $5, image = $6 WHERE id = $7`,
          [dto.key.trim(), dto.value.trim(), dto.additionalDetails.trim(), SITE_CONFIG_TYPES.MetaInformation, uploadResult.filePath, uploadResult.filePath, id]
        );
      } else {
        const existingMetaPath = dto.imageFileName || dto.image || null;
        if (existingMetaPath) {
          const normalized = ensureFolderPrefix(extractStoragePath(existingMetaPath) || existingMetaPath, "site-configurations");
          await pool.query(
            `UPDATE site_configurations SET key = $1, value = $2, additional_details = $3, type = $4, image_name = $5, image = $6 WHERE id = $7`,
            [dto.key.trim(), dto.value.trim(), dto.additionalDetails.trim(), SITE_CONFIG_TYPES.MetaInformation, normalized, normalized, id]
          );
        } else {
          await pool.query(
            `UPDATE site_configurations SET key = $1, value = $2, additional_details = $3, type = $4, image_name = NULL, image = NULL WHERE id = $5`,
            [dto.key.trim(), dto.value.trim(), dto.additionalDetails.trim(), SITE_CONFIG_TYPES.MetaInformation, id]
          );
        }
      }
      return { success: true, message: "Configuration updated successfully." };
    }

    case "statistics": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const fullType = `${SITE_CONFIG_TYPES.Statistics}-${dto.itemType || ""}`;
      const entity = await pool.query(`SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`, [id, `${SITE_CONFIG_TYPES.Statistics}%`]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND id != $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [fullType, dto.key.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(`UPDATE site_configurations SET key = $1, value = $2, type = $3 WHERE id = $4`, [dto.key.trim(), dto.value.trim(), fullType, id]);
      return { success: true, message: "Configuration updated successfully." };
    }

    case "sourcedby": {
      if (!dto.value?.trim()) return { success: false, message: "Sourced by is required." };
      const entity = await pool.query(`SELECT id FROM approvers WHERE id = $1`, [id]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM approvers WHERE TRIM(name) = $1 AND id != $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered sourced by value already exists." };
      await pool.query(`UPDATE approvers SET name = $1 WHERE id = $2`, [dto.value.trim(), id]);
      return { success: true, message: "Sourced by updated successfully." };
    }

    case "themes": {
      if (!dto.value?.trim()) return { success: false, message: "Theme is required." };
      const entity = await pool.query(`SELECT id FROM themes WHERE id = $1`, [id]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM themes WHERE TRIM(name) = $1 AND id != $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered theme value already exists." };

      const base64UpdThemeData = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64UpdThemeData) {
        const uploadResult = await uploadBase64Image(base64UpdThemeData, "themes");
        await pool.query(
          `UPDATE themes SET name = $1, description = $2, image_file_name = $3 WHERE id = $4`,
          [dto.value.trim(), dto.description || null, uploadResult.filePath, id]
        );
      } else {
        const existingThemePath = dto.imageFileName || dto.image || null;
        if (existingThemePath) {
          const normalized = ensureFolderPrefix(extractStoragePath(existingThemePath) || existingThemePath, "themes");
          await pool.query(
            `UPDATE themes SET name = $1, description = $2, image_file_name = $3 WHERE id = $4`,
            [dto.value.trim(), dto.description || null, normalized, id]
          );
        } else {
          const currentRow = await pool.query(`SELECT image_file_name FROM themes WHERE id = $1`, [id]);
          const currentImg = currentRow.rows[0]?.image_file_name || null;
          const normalizedCurrent = currentImg ? ensureFolderPrefix(currentImg, "themes") : null;
          await pool.query(
            `UPDATE themes SET name = $1, description = $2, image_file_name = $3 WHERE id = $4`,
            [dto.value.trim(), dto.description || null, normalizedCurrent, id]
          );
        }
      }
      return { success: true, message: "Theme updated successfully." };
    }

    case "special-filters": {
      if (!dto.value?.trim()) return { success: false, message: "Tag is required." };
      const entity = await pool.query(`SELECT id FROM investment_tags WHERE id = $1`, [id]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM investment_tags WHERE TRIM(tag) = $1 AND id != $2 AND (is_deleted IS NULL OR is_deleted = false)`,
        [dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered tag value already exists." };
      await pool.query(`UPDATE investment_tags SET tag = $1 WHERE id = $2`, [dto.value.trim(), id]);
      return { success: true, message: "Special filter updated successfully." };
    }

    case "transaction-type":
    case "investment-type-category":
    case "news-type":
    case "news-audience": {
      if (!dto.value?.trim()) return { success: false, message: `${type.replace(/-/g, " ")} is required.` };
      const configType = type === "transaction-type" ? SITE_CONFIG_TYPES.TransactionType
        : type === "investment-type-category" ? SITE_CONFIG_TYPES.InvestmentTypeCategory
        : type === "news-type" ? SITE_CONFIG_TYPES.NewsType : SITE_CONFIG_TYPES.NewsAudience;
      const entity = await pool.query(`SELECT id, value FROM site_configurations WHERE id = $1 AND type = $2`, [id, configType]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND id != $3 AND (is_deleted IS NULL OR is_deleted = false)`,
        [configType, dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: `Entered ${type.replace(/-/g, " ")} value already exists.` };
      const previousValue = entity.rows[0].value as string | null;
      const newValue = dto.value.trim();
      await pool.query(`UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`, [newValue, newValue, id]);
      if (type === "investment-type-category" && previousValue && previousValue !== newValue) {
        await pool.query(
          `UPDATE campaigns SET investment_type_category = $1 WHERE investment_type_category = $2`,
          [newValue, previousValue]
        );
      }
      const successMsg = type === "transaction-type" ? "Transaction type updated successfully."
        : type === "investment-type-category" ? "Investment type updated successfully."
        : type === "news-type" ? "News type updated successfully." : "News audience updated successfully.";
      return { success: true, message: successMsg };
    }

    case "contact-info": {
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const entity = await pool.query(
        `SELECT id FROM site_configurations WHERE id = $1 AND type LIKE $2`,
        [id, `${SITE_CONFIG_TYPES.ContactInfo}-%`]
      );
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      await pool.query(
        `UPDATE site_configurations SET value = $1, additional_details = $2 WHERE id = $3`,
        [dto.value.trim(), dto.additionalDetails?.trim() || null, id]
      );
      return { success: true, message: "Contact info updated successfully." };
    }

    case "daf-providers": {
      const name = (dto.value ?? "").trim();
      const url = (dto.link ?? "").trim();
      if (!name) return { success: false, message: "Provider name is required." };
      if (!url) return { success: false, message: "Provider URL is required." };
      const entity = await pool.query(`SELECT id FROM daf_providers WHERE id = $1`, [id]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM daf_providers WHERE LOWER(TRIM(provider_name)) = LOWER($1) AND id != $2`,
        [name, id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered provider name already exists." };
      await pool.query(
        `UPDATE daf_providers SET provider_name = $1, provider_url = $2 WHERE id = $3`,
        [name, url, id]
      );
      return { success: true, message: "DAF provider updated successfully." };
    }

    default:
      return { success: false, message: "Invalid configuration type." };
  }
}

export default router;
