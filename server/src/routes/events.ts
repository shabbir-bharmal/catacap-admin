import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { parsePagination, softDeleteFilter, buildSortClause, handleMissingTableError } from "../utils/softDelete.js";
import { resolveFileUrl, uploadBase64Image, extractStoragePath, ensureFolderPrefix } from "../utils/uploadBase64Image.js";
import { modulePermission } from "../middleware/jwtAuth.js";

const router = Router();

function noStore(_req: Request, res: Response, next: () => void): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

const ALLOWED_LINK_TARGET_TYPES = new Set(["investments", "groups", "custom-pages"]);

type EventLinkTargetsByType = {
  investments: number[];
  groups: number[];
  "custom-pages": string[];
};

function emptyLinkTargets(): EventLinkTargetsByType {
  return { investments: [], groups: [], "custom-pages": [] };
}

function normalizeIntIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((v: unknown) => parseInt(String(v), 10))
        .filter((n: number) => Number.isInteger(n) && n > 0)
    )
  ) as number[];
}

function normalizeSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((v: unknown) => (v == null ? "" : String(v).trim()))
        .filter((s: string) => s.length > 0)
    )
  ) as string[];
}

type NormalizeResult =
  | { ok: true; targets: EventLinkTargetsByType }
  | { ok: false; error: string };

function normalizeLinkTargets(dto: any): NormalizeResult {
  const targets = emptyLinkTargets();

  const grouped = dto?.linkTargetsByType;
  if (grouped !== undefined && grouped !== null) {
    if (typeof grouped !== "object" || Array.isArray(grouped)) {
      return { ok: false, error: "linkTargetsByType must be an object." };
    }
    for (const key of Object.keys(grouped)) {
      if (!ALLOWED_LINK_TARGET_TYPES.has(key)) {
        return { ok: false, error: `Unknown link target type: ${key}` };
      }
    }
    targets.investments = normalizeIntIds((grouped as any).investments);
    targets.groups = normalizeIntIds((grouped as any).groups);
    targets["custom-pages"] = normalizeSlugs((grouped as any)["custom-pages"]);
    const populatedTypes = [
      targets.investments.length > 0 ? "investments" : null,
      targets.groups.length > 0 ? "groups" : null,
      targets["custom-pages"].length > 0 ? "custom-pages" : null,
    ].filter((v): v is string => v !== null);
    if (populatedTypes.length > 1) {
      return {
        ok: false,
        error: `An event can only be linked to one type at a time. Received items for: ${populatedTypes.join(", ")}.`,
      };
    }
    return { ok: true, targets };
  }

  if (dto?.linkTargetType !== undefined && dto?.linkTargetType !== null) {
    const rawType = typeof dto.linkTargetType === "string" ? dto.linkTargetType.trim() : "";
    if (rawType.length > 0 && !ALLOWED_LINK_TARGET_TYPES.has(rawType)) {
      return { ok: false, error: `Unknown link target type: ${rawType}` };
    }
    const rawList = Array.isArray(dto?.linkTargetIds) ? dto.linkTargetIds : [];
    if (rawType === "custom-pages") {
      targets["custom-pages"] = normalizeSlugs(rawList);
    } else if (rawType === "investments") {
      targets.investments = normalizeIntIds(rawList);
    } else if (rawType === "groups") {
      targets.groups = normalizeIntIds(rawList);
    }
  }
  return { ok: true, targets };
}

async function insertLinkRowsForType(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  eventId: number,
  type: "investments" | "groups",
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const valuesSql = ids.map((_, i) => `($1, $2, $${i + 3}, NULL)`).join(", ");
  await client.query(
    `INSERT INTO event_links (event_id, target_type, target_id, target_slug)
     VALUES ${valuesSql}
     ON CONFLICT DO NOTHING`,
    [eventId, type, ...ids]
  );
}

async function insertLinkRowsForSlugs(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  eventId: number,
  slugs: string[]
): Promise<void> {
  if (slugs.length === 0) return;
  const valuesSql = slugs.map((_, i) => `($1, 'custom-pages', NULL, $${i + 2})`).join(", ");
  await client.query(
    `INSERT INTO event_links (event_id, target_type, target_id, target_slug)
     VALUES ${valuesSql}
     ON CONFLICT DO NOTHING`,
    [eventId, ...slugs]
  );
}

async function replaceEventLinks(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  eventId: number,
  targets: EventLinkTargetsByType
): Promise<void> {
  await client.query(`DELETE FROM event_links WHERE event_id = $1`, [eventId]);
  await insertLinkRowsForType(client, eventId, "investments", targets.investments);
  await insertLinkRowsForType(client, eventId, "groups", targets.groups);
  await insertLinkRowsForSlugs(client, eventId, targets["custom-pages"]);
}

const LINK_TARGETS_BY_TYPE_SUBQUERY = `jsonb_build_object(
  'investments',
    COALESCE(
      (SELECT jsonb_agg(el.target_id ORDER BY el.target_id)
         FROM event_links el
         JOIN campaigns c
           ON c.id = el.target_id
          AND (c.is_deleted IS NULL OR c.is_deleted = false)
          AND c.deleted_at IS NULL
        WHERE el.event_id = e.id AND el.target_type = 'investments'),
      '[]'::jsonb
    ),
  'groups',
    COALESCE(
      (SELECT jsonb_agg(el.target_id ORDER BY el.target_id)
         FROM event_links el
         JOIN groups g
           ON g.id = el.target_id
          AND (g.is_deleted IS NULL OR g.is_deleted = false)
          AND g.deleted_at IS NULL
        WHERE el.event_id = e.id AND el.target_type = 'groups'),
      '[]'::jsonb
    ),
  'custom-pages',
    COALESCE(
      (SELECT jsonb_agg(target_slug ORDER BY target_slug)
         FROM event_links
        WHERE event_id = e.id AND target_type = 'custom-pages'),
      '[]'::jsonb
    )
)`;

function decodeLinkTargetsByType(raw: unknown): EventLinkTargetsByType {
  const out = emptyLinkTargets();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  out.investments = normalizeIntIds(r.investments);
  out.groups = normalizeIntIds(r.groups);
  out["custom-pages"] = normalizeSlugs(r["custom-pages"]);
  return out;
}

function deriveLegacyLinkFields(grouped: EventLinkTargetsByType): {
  linkTargetType: "investments" | "groups" | "custom-pages" | null;
  linkTargetIds: Array<number | string>;
} {
  if (grouped.investments.length > 0) {
    return { linkTargetType: "investments", linkTargetIds: [...grouped.investments] };
  }
  if (grouped.groups.length > 0) {
    return { linkTargetType: "groups", linkTargetIds: [...grouped.groups] };
  }
  if (grouped["custom-pages"].length > 0) {
    return { linkTargetType: "custom-pages", linkTargetIds: [...grouped["custom-pages"]] };
  }
  return { linkTargetType: null, linkTargetIds: [] };
}

router.get("/", noStore, async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    softDeleteFilter("e", params.isDeleted, conditions);

    if (params.searchValue) {
      conditions.push(`LOWER(e.title) LIKE $${paramIdx}`);
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortCol = buildSortClause(params.sortField, isAsc, {
      title: "e.title",
      eventdate: "e.event_date",
      status: "e.status",
    }, "e.created_at");

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM events e ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT
         e.id, e.title, e.description, e.event_date, e.event_time,
         e.registration_link, e.status, e.image_file_name, e.image,
         e.type, e.duration, e.page_url, e.show_on_home,
         ${LINK_TARGETS_BY_TYPE_SUBQUERY} AS link_targets_by_type,
         e.deleted_at,
         du.first_name || ' ' || du.last_name AS deleted_by_name
       FROM events e
       LEFT JOIN users du ON e.deleted_by = du.id
       ${whereClause}
       ORDER BY ${sortCol}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((r: any) => {
      const linkTargetsByType = decodeLinkTargetsByType(r.link_targets_by_type);
      const legacy = deriveLegacyLinkFields(linkTargetsByType);
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        eventDate: r.event_date,
        eventTime: r.event_time,
        registrationLink: r.registration_link,
        status: r.status ?? false,
        imageFileName: resolveFileUrl(r.image_file_name, "events"),
        image: resolveFileUrl(r.image, "events") || resolveFileUrl(r.image_file_name, "events"),
        type: r.type,
        duration: r.duration,
        pageUrl: r.page_url,
        showOnHome: r.show_on_home ?? null,
        linkTargetsByType,
        linkTargetType: legacy.linkTargetType,
        linkTargetIds: legacy.linkTargetIds,
        deletedAt: r.deleted_at,
        deletedBy: r.deleted_by_name,
      };
    });

    res.json({ totalRecords: parseInt(countResult.rows[0].total) || 0, items });
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("Events GetAll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/registrations", modulePermission("event-registrations", "Manage"), async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req.query as Record<string, unknown>);
    const isAsc = params.sortDirection?.toLowerCase() === "asc";
    const offset = (params.currentPage - 1) * params.perPage;

    const conditions: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIdx = 1;

    softDeleteFilter("er", params.isDeleted, conditions);

    if (params.searchValue) {
      conditions.push(
        `(LOWER(er.first_name) LIKE $${paramIdx} OR LOWER(er.last_name) LIKE $${paramIdx} OR LOWER(er.email) LIKE $${paramIdx} OR LOWER(er.event_slug) LIKE $${paramIdx})`
      );
      values.push(`%${params.searchValue.toLowerCase()}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortCol = buildSortClause(
      params.sortField,
      isAsc,
      {
        eventslug: "er.event_slug",
        firstname: "er.first_name",
        lastname: "er.last_name",
        email: "er.email",
        createdat: "er.created_at",
      },
      "er.created_at"
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM event_registrations er ${whereClause}`,
      values
    );

    const dataResult = await pool.query(
      `SELECT er.id, er.event_slug, er.first_name, er.last_name, er.email,
              er.guest_name, er.referred_by, er.created_at,
              er.attending, er.interested_in_future_events, er.requested_intro_call
       FROM event_registrations er
       ${whereClause}
       ORDER BY ${sortCol}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, params.perPage, offset]
    );

    const items = dataResult.rows.map((r: any) => ({
      id: r.id,
      eventSlug: r.event_slug,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      guestName: r.guest_name,
      referredBy: r.referred_by,
      createdAt: r.created_at,
      attending: r.attending,
      interestedInFutureEvents: r.interested_in_future_events,
      requestedIntroCall: r.requested_intro_call,
    }));

    res.json({ totalRecords: parseInt(countResult.rows[0].total) || 0, items });
  } catch (err: any) {
    if (handleMissingTableError(err, res)) return;
    console.error("Event Registrations GetAll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/registrations/:id", modulePermission("event-registrations", "Delete"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ message: "Invalid ID" });
      return;
    }

    const userId = req.user?.id || null;

    const existing = await pool.query(
      `SELECT id FROM event_registrations WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
      [id]
    );
    if (existing.rows.length === 0) {
      res.json({ success: false, message: "Event registration not found." });
      return;
    }

    await pool.query(
      `UPDATE event_registrations SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
      [userId, id]
    );

    res.json({ success: true, message: "Event registration deleted successfully." });
  } catch (err) {
    console.error("Event Registration Delete error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", noStore, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid ID" }); return; }

    const result = await pool.query(
      `SELECT e.id, e.title, e.description, e.event_date, e.event_time,
              e.registration_link, e.status, e.image, e.image_file_name, e.type, e.duration, e.page_url,
              e.show_on_home,
              ${LINK_TARGETS_BY_TYPE_SUBQUERY} AS link_targets_by_type
       FROM events e
       WHERE e.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.json({ success: false, message: "Event not found." });
      return;
    }

    const r = result.rows[0];
    const linkTargetsByType = decodeLinkTargetsByType(r.link_targets_by_type);
    const legacy = deriveLegacyLinkFields(linkTargetsByType);
    res.json({
      id: r.id,
      title: r.title,
      description: r.description,
      eventDate: r.event_date,
      eventTime: r.event_time,
      registrationLink: r.registration_link,
      status: r.status ?? false,
      image: resolveFileUrl(r.image, "events") || resolveFileUrl(r.image_file_name, "events"),
      imageFileName: resolveFileUrl(r.image_file_name, "events"),
      type: r.type,
      duration: r.duration,
      pageUrl: r.page_url,
      showOnHome: r.show_on_home ?? null,
      linkTargetsByType,
      linkTargetType: legacy.linkTargetType,
      linkTargetIds: legacy.linkTargetIds,
    });
  } catch (err) {
    console.error("Events GetById error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const dto = req.body;
    if (!dto) { res.status(400).json({ message: "Invalid data." }); return; }

    const userId = req.user?.id || null;

    let imageFileName: string | null = null;
    let image: string | null = null;
    const base64Data = [dto.image, dto.imageFileName].find((v) => v && typeof v === "string" && v.startsWith("data:"));
    if (base64Data) {
      const uploadResult = await uploadBase64Image(base64Data, "events");
      imageFileName = uploadResult.filePath;
      image = uploadResult.filePath;
    } else {
      const existingPath = dto.imageFileName || dto.image || null;
      if (existingPath) {
        const resolved = ensureFolderPrefix(extractStoragePath(existingPath) || existingPath, "events");
        imageFileName = resolved;
        image = resolved;
      }
    }

    const linkTargetsResult = normalizeLinkTargets(dto);
    if (!linkTargetsResult.ok) {
      res.status(400).json({ success: false, message: linkTargetsResult.error });
      return;
    }
    const linkTargets = linkTargetsResult.targets;

    await client.query("BEGIN");

    let savedId: number;

    if (dto.id && dto.id > 0) {
      const existing = await client.query(`SELECT id FROM events WHERE id = $1`, [dto.id]);
      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        res.json({ success: false, message: "Event not found." });
        return;
      }

      await client.query(
        `UPDATE events SET
           title = $1, description = $2, event_date = $3, event_time = $4,
           registration_link = $5, status = $6,
           image_file_name = COALESCE(NULLIF($7, ''), image_file_name),
           image = COALESCE(NULLIF($8, ''), image),
           type = $9, duration = $10, page_url = $11,
           show_on_home = $12,
           modified_at = NOW(), modified_by = $13
         WHERE id = $14`,
        [
          dto.title, dto.description, dto.eventDate, dto.eventTime,
          dto.registrationLink, dto.status,
          imageFileName, image,
          dto.type, dto.duration, dto.pageUrl ?? null,
          dto.showOnHome === true ? true : dto.showOnHome === false ? false : null,
          userId, dto.id,
        ]
      );

      savedId = dto.id;
      await replaceEventLinks(client, savedId, linkTargets);
      await client.query("COMMIT");
      res.json({ success: true, message: "Event updated successfully.", data: savedId });
    } else {
      const result = await client.query(
        `INSERT INTO events (title, description, event_date, event_time, registration_link, status,
           image_file_name, image, type, duration, page_url, show_on_home,
           created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         RETURNING id`,
        [
          dto.title, dto.description, dto.eventDate, dto.eventTime,
          dto.registrationLink, dto.status,
          imageFileName, image,
          dto.type, dto.duration, dto.pageUrl ?? null,
          dto.showOnHome === true ? true : dto.showOnHome === false ? false : null,
          userId,
        ]
      );

      savedId = result.rows[0].id as number;
      await replaceEventLinks(client, savedId, linkTargets);
      await client.query("COMMIT");
      res.json({ success: true, message: "Event created successfully.", data: savedId });
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    console.error("Events Save error:", err);
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

    const existing = await pool.query(`SELECT id FROM events WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      res.json({ success: false, message: "Event not found." });
      return;
    }

    await pool.query(
      `UPDATE events SET is_deleted = true, deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
      [userId, id]
    );

    res.json({ success: true, message: "Event deleted successfully." });
  } catch (err) {
    console.error("Events Delete error:", err);
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
      `UPDATE events SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
       WHERE id = ANY($1) AND is_deleted = true
       RETURNING id`,
      [ids]
    );

    if (result.rowCount === 0) {
      res.json({ success: false, message: "No deleted events found to restore." });
      return;
    }

    res.json({ success: true, message: `${result.rowCount} event(s) restored successfully.` });
  } catch (err) {
    console.error("Events Restore error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
