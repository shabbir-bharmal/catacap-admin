import pool from "../db.js";
import { sendTemplateEmail } from "../utils/emailService.js";

const FORM_TYPE_LEARN_MORE = 4;

interface SeriesStep {
  dayOffset: number;
  category: number;
  label: string;
}

const SCHEDULE: SeriesStep[] = [
  { dayOffset: 1, category: 36, label: "Day1" },
  { dayOffset: 6, category: 37, label: "Day6" },
  { dayOffset: 10, category: 38, label: "Day10" },
];

const isProduction = process.env.NODE_ENV === "production";
const BASE_URL = isProduction
  ? "https://catacap.org"
  : "https://qa.catacap.org";

export async function runWelcomeSeries(): Promise<void> {
  const jobName = "WelcomeSeries";
  const startTime = new Date();
  const counts: Record<string, number> = { day1: 0, day6: 0, day10: 0 };
  const errors: string[] = [];
  let errorMessage: string | null = null;
  let schedulerLogId: number | null = null;
  let hasStatusCol = false;

  try {
    try {
      const statusCheck = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'status'`,
      );
      hasStatusCol = statusCheck.rows.length > 0;
      const insertResult = hasStatusCol
        ? await pool.query<{ id: number }>(
            `INSERT INTO scheduler_logs (start_time, job_name, status, metadata)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [startTime, jobName, "Running", counts],
          )
        : await pool.query<{ id: number }>(
            `INSERT INTO scheduler_logs (start_time, job_name, metadata)
             VALUES ($1, $2, $3) RETURNING id`,
            [startTime, jobName, counts],
          );
      schedulerLogId = insertResult.rows[0]?.id ?? null;
    } catch (logErr) {
      console.error("[SCHEDULER] Failed to insert WelcomeSeries start log:", logErr);
    }

    for (const step of SCHEDULE) {
      const result = await pool.query<{
        id: number;
        email: string;
        first_name: string | null;
      }>(
        `SELECT fs.id, fs.email, fs.first_name
           FROM form_submissions fs
           LEFT JOIN welcome_series_email_logs wsel
             ON wsel.form_submission_id = fs.id
            AND wsel.day_offset = $1
            AND wsel.success = true
          WHERE fs.form_type = $2
            AND fs.created_at IS NOT NULL
            AND (CURRENT_DATE - fs.created_at::date) = $1
            AND fs.email IS NOT NULL
            AND fs.email <> ''
            AND (fs.is_deleted IS NULL OR fs.is_deleted = false)
            AND wsel.id IS NULL`,
        [step.dayOffset, FORM_TYPE_LEARN_MORE],
      );

      console.log(
        `[SCHEDULER] WelcomeSeries ${step.label}: ${result.rows.length} recipient(s) eligible`,
      );

      const countKey = `day${step.dayOffset}`;

      for (const row of result.rows) {
        let success = false;
        let errMsg: string | null = null;

        try {
          success = await sendTemplateEmail(step.category, row.email, {
            firstName: row.first_name || "",
            unsubscribeUrl: `${BASE_URL}/settings`,
          });
          if (!success) {
            errMsg = `No active template found for category ${step.category} or send failed`;
          }
        } catch (err: unknown) {
          errMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[SCHEDULER] WelcomeSeries ${step.label} send error for submission ${row.id}:`,
            errMsg,
          );
        }

        let inserted = false;
        try {
          const insertResult = await pool.query<{ id: number }>(
            `INSERT INTO welcome_series_email_logs
               (form_submission_id, day_offset, success, error_message, scheduler_log_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (form_submission_id, day_offset) DO NOTHING
             RETURNING id`,
            [row.id, step.dayOffset, success, errMsg, schedulerLogId],
          );
          inserted = (insertResult.rowCount ?? 0) > 0;
        } catch (logErr) {
          console.error(
            `[SCHEDULER] WelcomeSeries failed to log result for submission ${row.id}:`,
            logErr,
          );
        }

        if (success && inserted) {
          counts[countKey] = (counts[countKey] || 0) + 1;
        } else if (!success) {
          errors.push(`Submission ${row.id} ${step.label}: ${errMsg}`);
        }
      }
    }

    console.log(
      `[SCHEDULER] WelcomeSeries complete: Day1=${counts.day1}, Day6=${counts.day6}, Day10=${counts.day10}, errors=${errors.length}`,
    );

    if (errors.length > 0) {
      errorMessage = `WelcomeSeries completed with ${errors.length} failure(s): ${errors.join("; ")}`;
      throw new Error(errorMessage);
    }
  } catch (err: unknown) {
    if (!errorMessage) {
      errorMessage = err instanceof Error ? err.toString() : String(err);
    }
    throw err;
  } finally {
    const status = errorMessage ? "Failed" : "Success";
    const endTime = new Date();
    try {
      if (schedulerLogId !== null) {
        if (hasStatusCol) {
          await pool.query(
            `UPDATE scheduler_logs
               SET end_time = $1, error_message = $2, status = $3, metadata = $4
             WHERE id = $5`,
            [endTime, errorMessage, status, counts, schedulerLogId],
          );
        } else {
          await pool.query(
            `UPDATE scheduler_logs
               SET end_time = $1, error_message = $2, metadata = $3
             WHERE id = $4`,
            [endTime, errorMessage, counts, schedulerLogId],
          );
        }
      } else if (hasStatusCol) {
        await pool.query(
          `INSERT INTO scheduler_logs
            (start_time, end_time, error_message, job_name, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [startTime, endTime, errorMessage, jobName, status, counts],
        );
      } else {
        await pool.query(
          `INSERT INTO scheduler_logs
            (start_time, end_time, error_message, job_name, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [startTime, endTime, errorMessage, jobName, counts],
        );
      }
    } catch (logErr) {
      console.error("[SCHEDULER] Failed to log WelcomeSeries run:", logErr);
    }
  }
}
