import { sendTemplateEmail } from "../utils/emailService.js";
import pool from "../db.js";

interface EmailWorkItem {
  category: number;
  toEmail: string;
  variables: Record<string, string>;
  pendingGrantId: number;
  userId: string;
  reminderType: string;
  schedulerLogId?: number | null;
}

const queue: EmailWorkItem[] = [];
let processing = false;

export function queueEmail(item: EmailWorkItem): void {
  queue.push(item);
  if (!processing) {
    processQueue();
  }
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    let errorMessage: string | null = null;
    try {
      const success = await sendTemplateEmail(
        item.category,
        item.toEmail,
        item.variables
      );
      if (!success) {
        errorMessage = "Email send returned false";
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errorMessage = message;
      console.error(
        `[EMAIL_QUEUE] Failed to send email category=${item.category} to=${item.toEmail}:`,
        message
      );
    }

    try {
      await pool.query(
        `INSERT INTO scheduled_email_logs
          (pending_grant_id, user_id, reminder_type, error_message, sent_date, is_deleted, scheduler_log_id)
         VALUES ($1, $2, $3, $4, NOW(), false, $5)`,
        [
          item.pendingGrantId,
          item.userId,
          item.reminderType,
          errorMessage,
          item.schedulerLogId ?? null,
        ]
      );
    } catch (logErr: unknown) {
      const message = logErr instanceof Error ? logErr.message : String(logErr);
      console.error(
        `[EMAIL_QUEUE] Failed to log email result for grant ${item.pendingGrantId}:`,
        message
      );
    }
  }

  processing = false;
}
