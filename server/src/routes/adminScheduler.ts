import { Router } from "express";
import type { Request, Response } from "express";
import pool from "../db.js";
import { reloadScheduler, executeJobInBackground } from "../scheduler/index.js";
import { createBackupDownloadUrl } from "../scheduler/backupDatabase.js";

const router = Router();

const ALLOWED_TIMEZONES = new Set([
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "UTC",
]);

function isValidTimezone(tz: string): boolean {
  if (ALLOWED_TIMEZONES.has(tz)) return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const tableCheck = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'scheduler_configurations'`,
    );
    if (tableCheck.rows.length === 0) {
      res.json([]);
      return;
    }
    const result = await pool.query(
      `SELECT id, job_name AS "jobName", description, hour, minute, timezone,
              COALESCE(is_enabled, true) AS "isEnabled",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM scheduler_configurations
       ORDER BY id`,
    );

    let retentionDays: number | null = null;
    try {
      const retentionResult = await pool.query(
        `SELECT value FROM site_configurations
         WHERE type = 'Configuration'
           AND key = 'Auto Delete Archived Records After (Days)'
           AND (is_deleted = false OR is_deleted IS NULL)
         LIMIT 1`,
      );
      if (retentionResult.rows.length > 0) {
        const parsed = parseInt(retentionResult.rows[0].value, 10);
        if (!isNaN(parsed)) retentionDays = parsed;
      }
    } catch {}

    const rows = result.rows.map((row: Record<string, unknown>) => {
      if (row.jobName === "DeleteArchivedUsers" && retentionDays !== null) {
        return {
          ...row,
          description: `${row.description || "Archives and deletes soft-deleted records"} (Currently configured: ${retentionDays} days)`,
        };
      }
      return row;
    });

    res.json(rows);
  } catch (err) {
    console.error("Scheduler config list error:", err);
    res
      .status(500)
      .json({ message: "Failed to load scheduler configurations." });
  }
});

router.put("/:jobName", async (req: Request, res: Response) => {
  try {
    const { jobName } = req.params;
    const { hour, minute, timezone } = req.body;

    if (hour == null || minute == null || !timezone) {
      res
        .status(400)
        .json({ message: "hour, minute, and timezone are required." });
      return;
    }

    if (typeof hour !== "number" || typeof minute !== "number") {
      res.status(400).json({ message: "hour and minute must be numbers." });
      return;
    }

    const h = Math.trunc(hour);
    const m = Math.trunc(minute);

    if (!Number.isInteger(hour) || h < 0 || h > 23) {
      res
        .status(400)
        .json({ message: "hour must be an integer between 0 and 23." });
      return;
    }
    if (!Number.isInteger(minute) || m < 0 || m > 59) {
      res
        .status(400)
        .json({
          message:
            "minute must be an integer between 0 and 59 (displayed as two-digit format 00-59).",
        });
      return;
    }
    if (!isValidTimezone(timezone)) {
      res
        .status(400)
        .json({
          message: "Invalid timezone. Please select a valid IANA timezone.",
        });
      return;
    }

    const result = await pool.query(
      `UPDATE scheduler_configurations
       SET hour = $1, minute = $2, timezone = $3, updated_at = NOW()
       WHERE job_name = $4
       RETURNING id, job_name AS "jobName", description, hour, minute, timezone,
                 COALESCE(is_enabled, true) AS "isEnabled",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [h, m, timezone, jobName],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: "Job not found." });
      return;
    }

    let reloadWarning: string | undefined;
    try {
      await reloadScheduler();
    } catch (reloadErr) {
      console.error("Scheduler reload failed after config update:", reloadErr);
      reloadWarning =
        "Schedule saved but the running scheduler failed to reload. Changes will take effect on next server restart.";
    }

    res.json({ success: true, data: result.rows[0], warning: reloadWarning });
  } catch (err) {
    console.error("Scheduler config update error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:jobName/toggle", async (req: Request, res: Response) => {
  try {
    const { jobName } = req.params;
    const { isEnabled } = req.body;

    if (typeof isEnabled !== "boolean") {
      res.status(400).json({ message: "isEnabled (boolean) is required." });
      return;
    }

    const result = await pool.query(
      `UPDATE scheduler_configurations
       SET is_enabled = $1, updated_at = NOW()
       WHERE job_name = $2
       RETURNING id, job_name AS "jobName", description, hour, minute, timezone,
                 COALESCE(is_enabled, true) AS "isEnabled",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [isEnabled, jobName],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: "Job not found." });
      return;
    }

    let reloadWarning: string | undefined;
    try {
      await reloadScheduler();
    } catch (reloadErr) {
      console.error("Scheduler reload failed after toggle:", reloadErr);
      reloadWarning =
        "Toggle saved but the running scheduler failed to reload. Changes will take effect on next server restart.";
    }

    res.json({ success: true, data: result.rows[0], warning: reloadWarning });
  } catch (err) {
    console.error("Scheduler toggle error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:jobName/trigger", async (req: Request, res: Response) => {
  try {
    const jobName = String(req.params.jobName);

    const configCheck = await pool.query(
      `SELECT id FROM scheduler_configurations WHERE job_name = $1`,
      [jobName],
    );
    if (configCheck.rows.length === 0) {
      res.status(404).json({ message: "Job not found in configurations." });
      return;
    }

    try {
      const result = await executeJobInBackground(jobName);
      if (result.alreadyRunning) {
        res.json({
          started: false,
          alreadyRunning: true,
          message: `${jobName} is already running. Please try again later.`,
          startTime: result.startTime.toISOString(),
          runningLogId: null,
        });
        return;
      }
      res.json({
        started: true,
        alreadyRunning: false,
        message: `${jobName} started. Results will appear in Recent Logs when the job finishes.`,
        startTime: result.startTime.toISOString(),
        runningLogId: result.runningLogId,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[SCHEDULER] Failed to start ${jobName}:`, err);
      res.status(500).json({
        started: false,
        alreadyRunning: false,
        message: `Failed to start ${jobName}: ${errorMessage}`,
        error: errorMessage,
        startTime: new Date().toISOString(),
        runningLogId: null,
      });
    }
  } catch (err) {
    console.error("Scheduler trigger error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const tableCheck = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'scheduler_logs'`,
    );
    if (tableCheck.rows.length === 0) {
      res.json({ statuses: [] });
      return;
    }

    const statusColCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'status'`,
    );
    const hasStatusCol = statusColCheck.rows.length > 0;
    const metadataColCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'metadata'`,
    );
    const hasMetadataCol = metadataColCheck.rows.length > 0;

    const statusSelect = hasStatusCol
      ? `sl.status`
      : `CASE WHEN sl.error_message IS NOT NULL THEN 'Failed' ELSE 'Success' END AS status`;
    const metadataSelect = hasMetadataCol ? `sl.metadata` : `NULL::jsonb AS metadata`;
    const runningPredicate = hasStatusCol
      ? `sl.status = 'Running' AND sl.end_time IS NULL`
      : `FALSE`;
    const completedPredicate = hasStatusCol
      ? `(sl.status IS NULL OR sl.status <> 'Running') AND sl.end_time IS NOT NULL`
      : `sl.end_time IS NOT NULL`;

    const configsResult = await pool.query<{
      jobName: string;
      timezone: string;
    }>(
      `SELECT job_name AS "jobName", timezone FROM scheduler_configurations ORDER BY id`,
    );

    const statuses = [];
    for (const cfg of configsResult.rows) {
      const runningResult = await pool.query(
        `SELECT sl.id, sl.job_name AS "jobName", sl.start_time AS "startTime",
                sl.end_time AS "endTime", sl.error_message AS "errorMessage",
                ${statusSelect}, ${metadataSelect},
                $2::text AS "timezone"
         FROM scheduler_logs sl
         WHERE sl.job_name = $1 AND ${runningPredicate}
         ORDER BY sl.start_time DESC
         LIMIT 1`,
        [cfg.jobName, cfg.timezone],
      );
      const lastRunResult = await pool.query(
        `SELECT sl.id, sl.job_name AS "jobName", sl.start_time AS "startTime",
                sl.end_time AS "endTime", sl.error_message AS "errorMessage",
                ${statusSelect}, ${metadataSelect},
                $2::text AS "timezone"
         FROM scheduler_logs sl
         WHERE sl.job_name = $1 AND ${completedPredicate}
         ORDER BY sl.start_time DESC
         LIMIT 1`,
        [cfg.jobName, cfg.timezone],
      );
      const runningRow = runningResult.rows[0] || null;
      const lastRunRow = lastRunResult.rows[0] || null;
      statuses.push({
        jobName: cfg.jobName,
        running: !!runningRow,
        runningLogId: runningRow ? runningRow.id : null,
        runningSince: runningRow ? runningRow.startTime : null,
        lastRun: lastRunRow,
      });
    }

    res.json({ statuses });
  } catch (err) {
    console.error("Scheduler status error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post(
  "/BackupDatabase/download",
  async (req: Request, res: Response) => {
    try {
      const rawPath =
        typeof req.body?.path === "string" ? req.body.path : null;
      if (!rawPath) {
        res
          .status(400)
          .json({ message: "Missing required field: path (string)." });
        return;
      }
      const result = await createBackupDownloadUrl(rawPath);
      res.json({
        url: result.url,
        storagePath: result.storagePath,
        expiresInSeconds: result.expiresInSeconds,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("BackupDatabase download error:", message);
      res.status(400).json({ message });
    }
  },
);

router.get("/logs", async (req: Request, res: Response) => {
  try {
    const jobName = req.query.jobName as string | undefined;
    const rawLimit = parseInt(String(req.query.limit || "20"), 10);
    const rawOffset = parseInt(String(req.query.offset || "0"), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const statusColCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'status'`,
    );
    const hasStatusCol = statusColCheck.rows.length > 0;
    const statusSelect = hasStatusCol
      ? `, sl.status`
      : `, CASE WHEN sl.error_message IS NOT NULL THEN 'Failed' ELSE 'Success' END AS status`;

    let query: string;
    const params: unknown[] = [];

    const metadataColCheck = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'metadata'`
    );
    const metadataSelect = metadataColCheck.rows.length > 0
      ? `, sl.metadata`
      : `, NULL::jsonb AS metadata`;

    if (jobName) {
      query = `SELECT sl.id, sl.job_name AS "jobName", sl.start_time AS "startTime",
                      sl.end_time AS "endTime", sl.error_message AS "errorMessage",
                      COALESCE(sc.timezone, 'UTC') AS "timezone"
                      ${statusSelect}
                      ${metadataSelect}
               FROM scheduler_logs sl
               LEFT JOIN scheduler_configurations sc ON sc.job_name = sl.job_name
               WHERE sl.job_name = $1
               ORDER BY sl.start_time DESC
               LIMIT $2 OFFSET $3`;
      params.push(jobName, limit, offset);
    } else {
      query = `SELECT sl.id, sl.job_name AS "jobName", sl.start_time AS "startTime",
                      sl.end_time AS "endTime", sl.error_message AS "errorMessage",
                      COALESCE(sc.timezone, 'UTC') AS "timezone"
                      ${statusSelect}
                      ${metadataSelect}
               FROM scheduler_logs sl
               LEFT JOIN scheduler_configurations sc ON sc.job_name = sl.job_name
               ORDER BY sl.start_time DESC
               LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }

    const result = await pool.query(query, params);

    let totalCount = 0;
    if (jobName) {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM scheduler_logs WHERE job_name = $1`,
        [jobName],
      );
      totalCount = countResult.rows[0].count;
    } else {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM scheduler_logs`,
      );
      totalCount = countResult.rows[0].count;
    }

    res.json({ logs: result.rows, total: totalCount });
  } catch (err) {
    console.error("Scheduler logs error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/sent-emails", async (req: Request, res: Response) => {
  try {
    const startTime = req.query.startTime as string | undefined;
    const endTime = req.query.endTime as string | undefined;
    const schedulerLogIdRaw = req.query.schedulerLogId as string | undefined;
    const schedulerLogId = schedulerLogIdRaw
      ? parseInt(schedulerLogIdRaw, 10)
      : NaN;
    const rawLimit = parseInt(String(req.query.limit || "200"), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 200 : Math.min(rawLimit, 1000);

    const tableCheck = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'scheduled_email_logs'`,
    );
    if (tableCheck.rows.length === 0) {
      res.json({ emails: [] });
      return;
    }

    const params: unknown[] = [];
    let where = `WHERE (sel.is_deleted = false OR sel.is_deleted IS NULL)
                   AND sel.reminder_type IN ('Day3', 'Week2')`;
    if (!isNaN(schedulerLogId)) {
      params.push(schedulerLogId);
      const idx = params.length;
      where += ` AND (
        sel.scheduler_log_id = $${idx}
        OR (
          sel.scheduler_log_id IS NULL
          AND sel.sent_date >= (SELECT start_time FROM scheduler_logs WHERE id = $${idx})
          AND sel.sent_date < COALESCE(
            (SELECT MIN(start_time) FROM scheduler_logs sl2
              WHERE sl2.job_name = (SELECT job_name FROM scheduler_logs WHERE id = $${idx})
                AND sl2.start_time > (SELECT start_time FROM scheduler_logs WHERE id = $${idx})),
            NOW() + INTERVAL '100 years'
          )
        )
      )`;
    } else {
      if (startTime) {
        params.push(startTime);
        where += ` AND sel.sent_date >= $${params.length}`;
      }
      if (endTime) {
        params.push(endTime);
        where += ` AND sel.sent_date <= $${params.length}`;
      }
    }
    params.push(limit);

    const query = `
      SELECT sel.id,
             sel.pending_grant_id AS "pendingGrantId",
             sel.user_id AS "userId",
             sel.reminder_type AS "reminderType",
             sel.error_message AS "errorMessage",
             sel.sent_date AS "sentDate",
             u.email AS "userEmail",
             u.first_name AS "userFirstName",
             u.last_name AS "userLastName",
             pg.amount AS "amount",
             pg.daf_provider AS "dafProvider",
             c.name AS "campaignName"
      FROM scheduled_email_logs sel
      LEFT JOIN users u ON u.id = sel.user_id
      LEFT JOIN pending_grants pg ON pg.id = sel.pending_grant_id
      LEFT JOIN campaigns c ON c.id = pg.campaign_id
      ${where}
      ORDER BY sel.sent_date DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json({ emails: result.rows });
  } catch (err) {
    console.error("Scheduler sent-emails error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/sent-welcome-emails", async (req: Request, res: Response) => {
  try {
    const startTime = req.query.startTime as string | undefined;
    const endTime = req.query.endTime as string | undefined;
    const schedulerLogIdRaw = req.query.schedulerLogId as string | undefined;
    const schedulerLogId = schedulerLogIdRaw
      ? parseInt(schedulerLogIdRaw, 10)
      : NaN;
    const rawLimit = parseInt(String(req.query.limit || "200"), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 200 : Math.min(rawLimit, 1000);

    const tableCheck = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'welcome_series_email_logs'`
    );
    if (tableCheck.rows.length === 0) {
      res.json({ emails: [] });
      return;
    }

    const params: unknown[] = [];
    let where = `WHERE 1=1`;
    if (!isNaN(schedulerLogId)) {
      params.push(schedulerLogId);
      const idx = params.length;
      where += ` AND (
        wsel.scheduler_log_id = $${idx}
        OR (
          wsel.scheduler_log_id IS NULL
          AND wsel.sent_at >= (SELECT start_time FROM scheduler_logs WHERE id = $${idx})
          AND wsel.sent_at < COALESCE(
            (SELECT MIN(start_time) FROM scheduler_logs sl2
              WHERE sl2.job_name = (SELECT job_name FROM scheduler_logs WHERE id = $${idx})
                AND sl2.start_time > (SELECT start_time FROM scheduler_logs WHERE id = $${idx})),
            NOW() + INTERVAL '100 years'
          )
        )
      )`;
    } else {
      if (startTime) {
        params.push(startTime);
        where += ` AND wsel.sent_at >= $${params.length}`;
      }
      if (endTime) {
        params.push(endTime);
        where += ` AND wsel.sent_at <= $${params.length}`;
      }
    }
    params.push(limit);

    const query = `
      SELECT wsel.id,
             wsel.form_submission_id AS "formSubmissionId",
             wsel.day_offset AS "dayOffset",
             wsel.success AS "success",
             wsel.error_message AS "errorMessage",
             wsel.sent_at AS "sentDate",
             fs.email AS "userEmail",
             fs.first_name AS "userFirstName",
             fs.last_name AS "userLastName"
      FROM welcome_series_email_logs wsel
      LEFT JOIN form_submissions fs ON fs.id = wsel.form_submission_id
      ${where}
      ORDER BY wsel.sent_at DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json({ emails: result.rows });
  } catch (err) {
    console.error("Scheduler sent-welcome-emails error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
