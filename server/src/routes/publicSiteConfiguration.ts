import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { resolveFileUrl, uploadBase64Image, extractStoragePath, ensureFolderPrefix } from "../utils/uploadBase64Image.js";

const router = Router();

const SITE_CONFIG_TYPES = {
  StaticValue: "StaticValue",
  TransactionType: "TransactionType",
  InvestmentTypeCategory: "InvestmentTypeCategory",
  Statistics: "Statistics",
  MetaInformation: "MetaInformation",
  ContactInfo: "ContactInfo",
} as const;

router.get("/site-configuration", async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string || "").toLowerCase().trim();

    switch (type) {
      case "investment-terms": {
        const result = await pool.query(
          `SELECT id, key, value FROM site_configurations
           WHERE type = $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY key`,
          [SITE_CONFIG_TYPES.StaticValue]
        );
        res.json(result.rows);
        return;
      }

      case "sourcedby": {
        const result = await pool.query(
          `SELECT id, name AS value FROM approvers
           WHERE (is_deleted IS NULL OR is_deleted = false)
           ORDER BY name`
        );
        res.json(result.rows);
        return;
      }

      case "themes": {
        const result = await pool.query(
          `SELECT id, name AS value, image_file_name AS "imageFileName"
           FROM themes
           WHERE (is_deleted IS NULL OR is_deleted = false)
           ORDER BY name`
        );
        res.json(result.rows.map((r: any) => ({ ...r, imageFileName: resolveFileUrl(r.imageFileName, "themes") })));
        return;
      }

      case "special-filters": {
        const result = await pool.query(
          `SELECT id, tag AS value FROM investment_tags
           WHERE (is_deleted IS NULL OR is_deleted = false)
           ORDER BY tag`
        );
        res.json(result.rows);
        return;
      }

      case "transaction-type": {
        const result = await pool.query(
          `SELECT id, value FROM site_configurations
           WHERE type = $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY value`,
          [SITE_CONFIG_TYPES.TransactionType]
        );
        res.json(result.rows);
        return;
      }

      case "investment-type-category": {
        const result = await pool.query(
          `SELECT id, value FROM site_configurations
           WHERE type = $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY value`,
          [SITE_CONFIG_TYPES.InvestmentTypeCategory]
        );
        res.json(result.rows);
        return;
      }

      case "statistics": {
        const result = await pool.query(
          `SELECT id, key, value,
                  REPLACE(type, 'Statistics-', '') AS type
           FROM site_configurations
           WHERE type LIKE $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY value`,
          [`${SITE_CONFIG_TYPES.Statistics}%`]
        );
        res.json(result.rows);
        return;
      }

      case "meta-information": {
        const result = await pool.query(
          `SELECT id, key, value, image, image_name AS "imageName",
                  additional_details AS "additionalDetails"
           FROM site_configurations
           WHERE type LIKE $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY key`,
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
          `SELECT id, key, value,
                  additional_details AS "description",
                  REPLACE(type, 'ContactInfo-', '') AS type
           FROM site_configurations
           WHERE type LIKE $1
             AND (is_deleted IS NULL OR is_deleted = false)
           ORDER BY type, key`,
          [`${SITE_CONFIG_TYPES.ContactInfo}-%`]
        );
        const structured: Record<string, Record<string, string>> = {};
        for (const row of result.rows) {
          if (!structured[row.type]) structured[row.type] = {};
          structured[row.type][row.key] = row.value;
        }
        res.json(structured);
        return;
      }

      default:
        res.json([]);
    }
  } catch (err) {
    console.error("Public SiteConfig Get error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/site-configuration", async (req: Request, res: Response) => {
  try {
    const dto = req.body;
    if (!dto?.type?.trim()) {
      res.status(400).json({ message: "Type is required." });
      return;
    }

    const type = dto.type.toLowerCase().trim();
    const isUpdate = dto.id && dto.id > 0;

    const result = isUpdate
      ? await updateByType(type, dto)
      : await createByType(type, dto);

    res.json(result);
  } catch (err) {
    console.error("Public SiteConfig CreateOrUpdate error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/site-configuration", async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string || "").toLowerCase().trim();
    const id = parseInt(req.query.id as string, 10);

    if (!type) {
      res.status(400).json({ message: "Type is required." });
      return;
    }
    if (isNaN(id)) {
      res.status(400).json({ message: "Invalid ID" });
      return;
    }

    let result: { success: boolean; message: string };
    const loginUserId = req.user?.id;

    switch (type) {
      case "investment-terms": {
        const entity = await pool.query(
          `SELECT id, key FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.StaticValue]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE terms LIKE $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
          [`%{${entity.rows[0].key}}%`]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this term, it's being used in investments." });
          return;
        }
        await pool.query(`DELETE FROM site_configurations WHERE id = $1`, [id]);
        result = { success: true, message: "Configuration deleted successfully." };
        break;
      }

      case "sourcedby": {
        const entity = await pool.query(
          `SELECT id FROM approvers WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
          [id]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE (',' || approved_by || ',') LIKE $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
          [`%,${id},%`]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this sourced by, it's being used in investments." });
          return;
        }
        await pool.query(
          `UPDATE approvers SET is_deleted = true, deleted_at = NOW(), deleted_by = $2 WHERE id = $1`,
          [id, loginUserId]
        );
        result = { success: true, message: "Sourced by deleted successfully." };
        break;
      }

      case "themes": {
        const entity = await pool.query(
          `SELECT id FROM themes WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
          [id]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE (',' || themes || ',') LIKE $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
          [`%,${id},%`]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this theme, it's being used in investments." });
          return;
        }
        await pool.query(
          `UPDATE themes SET is_deleted = true, deleted_at = NOW(), deleted_by = $2 WHERE id = $1`,
          [id, loginUserId]
        );
        result = { success: true, message: "Theme deleted successfully." };
        break;
      }

      case "special-filters": {
        const entity = await pool.query(
          `SELECT id FROM investment_tags WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
          [id]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM investment_tag_mappings WHERE tag_id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this special filter, it's being used in investments." });
          return;
        }
        await pool.query(
          `UPDATE investment_tags SET is_deleted = true, deleted_at = NOW(), deleted_by = $2 WHERE id = $1`,
          [id, loginUserId]
        );
        result = { success: true, message: "Special filter deleted successfully." };
        break;
      }

      case "transaction-type": {
        const entity = await pool.query(
          `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.TransactionType]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM completed_investment_details WHERE site_configuration_id = $1 LIMIT 1`,
          [id]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this transaction type, it's being used in investments." });
          return;
        }
        await pool.query(`DELETE FROM site_configurations WHERE id = $1`, [id]);
        result = { success: true, message: "Transaction type deleted successfully." };
        break;
      }

      case "investment-type-category": {
        const entity = await pool.query(
          `SELECT id, value FROM site_configurations WHERE id = $1 AND type = $2`,
          [id, SITE_CONFIG_TYPES.InvestmentTypeCategory]
        );
        if (entity.rows.length === 0) {
          res.json({ success: false, message: "Record not found." });
          return;
        }
        const inUse = await pool.query(
          `SELECT 1 FROM campaigns WHERE investment_type_category = $1 LIMIT 1`,
          [entity.rows[0].value]
        );
        if (inUse.rows.length > 0) {
          res.json({ success: false, message: "Cannot delete this investment type, it's being used in investments." });
          return;
        }
        await pool.query(`DELETE FROM site_configurations WHERE id = $1`, [id]);
        result = { success: true, message: "Investment type deleted successfully." };
        break;
      }

      default:
        result = { success: false, message: "Invalid configuration type." };
    }

    res.json(result);
  } catch (err) {
    console.error("Public SiteConfig Delete error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/investment", async (req: Request, res: Response) => {
  try {
    const configurationType = (req.query.configurationType as string || "").toLowerCase();
    const configurationId = parseInt(req.query.configurationId as string, 10);

    if (!configurationType.trim()) {
      res.status(400).json({ message: "Type is required." });
      return;
    }
    if (isNaN(configurationId) || configurationId <= 0) {
      res.status(400).json({ message: "Id must be greater than zero." });
      return;
    }

    let result;

    if (configurationType === "specialfilters") {
      result = await pool.query(
        `SELECT c.id, c.name,
                EXISTS(SELECT 1 FROM investment_tag_mappings m WHERE m.campaign_id = c.id AND m.tag_id = $1 AND (m.is_deleted IS NULL OR m.is_deleted = false)) AS "isSelected"
         FROM campaigns c
         WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
         ORDER BY c.name`,
        [configurationId]
      );
    } else {
      const columnMap: Record<string, string> = {
        themes: "themes",
        sourcedby: "approved_by",
        sdgs: "sdgs",
      };
      const column = columnMap[configurationType];
      if (!column) {
        result = await pool.query(
          `SELECT c.id, c.name, false AS "isSelected"
           FROM campaigns c
           WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
           ORDER BY c.name`
        );
      } else {
        result = await pool.query(
          `SELECT c.id, c.name,
                  (',' || COALESCE(c.${column}, '') || ',') LIKE $1 AS "isSelected"
           FROM campaigns c
           WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
           ORDER BY c.name`,
          [`%,${configurationId},%`]
        );
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Public SiteConfig GetInvestment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/update-investment-mapping", async (req: Request, res: Response) => {
  try {
    const configurationType = (req.query.configurationType as string || "").toLowerCase();
    const configurationId = parseInt(req.query.configurationId as string, 10);
    const investmentId = parseInt(req.query.investmentId as string, 10);

    if (!configurationType.trim()) {
      res.status(400).json({ success: false, message: "Type is required." });
      return;
    }
    if (isNaN(configurationId) || configurationId <= 0 || isNaN(investmentId) || investmentId <= 0) {
      res.status(400).json({ success: false, message: "Invalid id." });
      return;
    }

    let isAdded: boolean;

    if (configurationType === "specialfilters") {
      const existing = await pool.query(
        `SELECT id FROM investment_tag_mappings WHERE campaign_id = $1 AND tag_id = $2`,
        [investmentId, configurationId]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `DELETE FROM investment_tag_mappings WHERE campaign_id = $1 AND tag_id = $2`,
          [investmentId, configurationId]
        );
        isAdded = false;
      } else {
        await pool.query(
          `INSERT INTO investment_tag_mappings (tag_id, campaign_id) VALUES ($1, $2)`,
          [configurationId, investmentId]
        );
        isAdded = true;
      }
    } else {
      const columnMap: Record<string, string> = {
        themes: "themes",
        sourcedby: "approved_by",
        sdgs: "sdgs",
      };
      const column = columnMap[configurationType];
      if (!column) {
        res.json({
          success: true,
          message: "Investment mapping added successfully.",
        });
        return;
      }

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

      const idx = list.indexOf(configurationId);
      if (idx !== -1) {
        list.splice(idx, 1);
        isAdded = false;
      } else {
        list.push(configurationId);
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
    console.error("Public SiteConfig UpdateInvestment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function createByType(type: string, dto: any): Promise<{ success: boolean; message: string }> {
  switch (type) {
    case "investment-terms": {
      if (!dto.key?.trim()) return { success: false, message: "Key is required." };
      if (!dto.value?.trim()) return { success: false, message: "Value is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2`,
        [SITE_CONFIG_TYPES.StaticValue, dto.key.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.key.trim(), dto.value.trim(), SITE_CONFIG_TYPES.StaticValue]
      );
      return { success: true, message: "Configuration created successfully." };
    }

    case "sourcedby": {
      if (!dto.value?.trim()) return { success: false, message: "Sourced by is required." };
      const dup = await pool.query(
        `SELECT 1 FROM approvers WHERE TRIM(name) = $1`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered sourced by value already exists." };
      await pool.query(`INSERT INTO approvers (name) VALUES ($1)`, [dto.value.trim()]);
      return { success: true, message: "Sourced by created successfully." };
    }

    case "themes": {
      if (!dto.value?.trim()) return { success: false, message: "Theme is required." };
      if (!dto.image?.trim()) return { success: false, message: "Image is required." };
      const dup = await pool.query(
        `SELECT 1 FROM themes WHERE TRIM(name) = $1`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered theme value already exists." };
      let themeFileName: string | null = null;
      const base64ThemeData = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64ThemeData) {
        const uploadResult = await uploadBase64Image(base64ThemeData, "themes");
        themeFileName = uploadResult.filePath;
      } else {
        const existingPath = dto.imageFileName || dto.image || null;
        if (existingPath) {
          themeFileName = ensureFolderPrefix(extractStoragePath(existingPath) || existingPath, "themes");
        }
      }
      await pool.query(
        `INSERT INTO themes (name, image_file_name) VALUES ($1, $2)`,
        [dto.value.trim(), themeFileName]
      );
      return { success: true, message: "Theme created successfully." };
    }

    case "special-filters": {
      if (!dto.value?.trim()) return { success: false, message: "Tag is required." };
      const dup = await pool.query(
        `SELECT 1 FROM investment_tags WHERE TRIM(tag) = $1`,
        [dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered tag value already exists." };
      await pool.query(`INSERT INTO investment_tags (tag) VALUES ($1)`, [dto.value.trim()]);
      return { success: true, message: "Special filter created successfully." };
    }

    case "transaction-type": {
      if (!dto.value?.trim()) return { success: false, message: "Transaction type is required." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2`,
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
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2`,
        [SITE_CONFIG_TYPES.InvestmentTypeCategory, dto.value.trim()]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered investment type value already exists." };
      await pool.query(
        `INSERT INTO site_configurations (key, value, type) VALUES ($1, $2, $3)`,
        [dto.value.trim(), dto.value.trim(), SITE_CONFIG_TYPES.InvestmentTypeCategory]
      );
      return { success: true, message: "Investment type created successfully." };
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
      const entity = await pool.query(
        `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
        [id, SITE_CONFIG_TYPES.StaticValue]
      );
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(key) = $2 AND id != $3`,
        [SITE_CONFIG_TYPES.StaticValue, dto.key.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered key already exists." };
      await pool.query(
        `UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`,
        [dto.key.trim(), dto.value.trim(), id]
      );
      return { success: true, message: "Configuration updated successfully." };
    }

    case "sourcedby": {
      if (!dto.value?.trim()) return { success: false, message: "Sourced by is required." };
      const entity = await pool.query(`SELECT id FROM approvers WHERE id = $1`, [id]);
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM approvers WHERE TRIM(name) = $1 AND id != $2`,
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
        `SELECT 1 FROM themes WHERE TRIM(name) = $1 AND id != $2`,
        [dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered theme value already exists." };
      const base64UpdTheme = [dto.image, dto.imageFileName].find((v: any) => v && typeof v === "string" && v.startsWith("data:"));
      if (base64UpdTheme) {
        const uploadResult = await uploadBase64Image(base64UpdTheme, "themes");
        await pool.query(
          `UPDATE themes SET name = $1, image_file_name = $2 WHERE id = $3`,
          [dto.value.trim(), uploadResult.filePath, id]
        );
      } else {
        const existingPath = dto.imageFileName || dto.image || null;
        if (existingPath) {
          const normalized = ensureFolderPrefix(extractStoragePath(existingPath) || existingPath, "themes");
          await pool.query(
            `UPDATE themes SET name = $1, image_file_name = $2 WHERE id = $3`,
            [dto.value.trim(), normalized, id]
          );
        } else {
          const currentRow = await pool.query(`SELECT image_file_name FROM themes WHERE id = $1`, [id]);
          const currentImg = currentRow.rows[0]?.image_file_name || null;
          const normalizedCurrent = currentImg ? ensureFolderPrefix(currentImg, "themes") : null;
          await pool.query(
            `UPDATE themes SET name = $1, image_file_name = $2 WHERE id = $3`,
            [dto.value.trim(), normalizedCurrent, id]
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
        `SELECT 1 FROM investment_tags WHERE TRIM(tag) = $1 AND id != $2`,
        [dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered tag value already exists." };
      await pool.query(`UPDATE investment_tags SET tag = $1 WHERE id = $2`, [dto.value.trim(), id]);
      return { success: true, message: "Special filter updated successfully." };
    }

    case "transaction-type": {
      if (!dto.value?.trim()) return { success: false, message: "Transaction type is required." };
      const entity = await pool.query(
        `SELECT id FROM site_configurations WHERE id = $1 AND type = $2`,
        [id, SITE_CONFIG_TYPES.TransactionType]
      );
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND id != $3`,
        [SITE_CONFIG_TYPES.TransactionType, dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered transaction type value already exists." };
      await pool.query(
        `UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`,
        [dto.value.trim(), dto.value.trim(), id]
      );
      return { success: true, message: "Transaction type updated successfully." };
    }

    case "investment-type-category": {
      if (!dto.value?.trim()) return { success: false, message: "Investment type is required." };
      const entity = await pool.query(
        `SELECT id, value FROM site_configurations WHERE id = $1 AND type = $2`,
        [id, SITE_CONFIG_TYPES.InvestmentTypeCategory]
      );
      if (entity.rows.length === 0) return { success: false, message: "Record not found." };
      const dup = await pool.query(
        `SELECT 1 FROM site_configurations WHERE type = $1 AND TRIM(value) = $2 AND id != $3`,
        [SITE_CONFIG_TYPES.InvestmentTypeCategory, dto.value.trim(), id]
      );
      if (dup.rows.length > 0) return { success: false, message: "Entered investment type value already exists." };
      const previousValue = entity.rows[0].value as string | null;
      const newValue = dto.value.trim();
      await pool.query(
        `UPDATE site_configurations SET key = $1, value = $2 WHERE id = $3`,
        [newValue, newValue, id]
      );
      if (previousValue && previousValue !== newValue) {
        await pool.query(
          `UPDATE campaigns SET investment_type_category = $1 WHERE investment_type_category = $2`,
          [newValue, previousValue]
        );
      }
      return { success: true, message: "Investment type updated successfully." };
    }

    default:
      return { success: false, message: "Invalid configuration type." };
  }
}

export default router;
