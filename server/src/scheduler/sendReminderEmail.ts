import pool from "../db.js";
import { queueEmail } from "./emailQueue.js";

const EMAIL_CATEGORY = {
  DAFReminderDay3: 10,
  FoundationReminderWeek2: 11,
  DAFReminderImpactAssetsDay3: 31,
  DAFReminderImpactAssetsWeek2: 32,
  DAFReminderWeek2: 33,
  FoundationReminderDay3: 34,
} as const;

const isProduction = process.env.NODE_ENV === "production";
const BASE_URL = isProduction
  ? "https://catacap.org"
  : "https://qa.catacap.org";

async function getDafLink(dafProviderName: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT provider_url FROM daf_providers
     WHERE LOWER(provider_name) = $1 AND is_active = true
     LIMIT 1`,
    [dafProviderName.toLowerCase()],
  );
  return result.rows.length > 0 ? result.rows[0].provider_url : null;
}

function formatAmount(amount: number): string {
  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function getDAFCategory(reminderType: string, dafProviderName: string): number {
  if (dafProviderName === "ImpactAssets") {
    return reminderType === "Day3"
      ? EMAIL_CATEGORY.DAFReminderImpactAssetsDay3
      : EMAIL_CATEGORY.DAFReminderImpactAssetsWeek2;
  }
  return reminderType === "Day3"
    ? EMAIL_CATEGORY.DAFReminderDay3
    : EMAIL_CATEGORY.DAFReminderWeek2;
}

function getFoundationCategory(reminderType: string): number {
  return reminderType === "Day3"
    ? EMAIL_CATEGORY.FoundationReminderDay3
    : EMAIL_CATEGORY.FoundationReminderWeek2;
}

function buildDafDonationRecipientSection(
  dafProviderName: string,
  dafProviderLink: string | null,
  dafName: string,
  formattedAmount: string,
): string {
  if (dafProviderName === "ImpactAssets") {
    return `<ol>
  <li><b>Initiate a grant </b>using the details below:</li>
  <p style='margin-top: 0px;'>Email ImpactAssets at <a href='mailto:clientservice@impactassets.org'>clientservice@impactassets.org</a> and CC <a href='mailto:support@catacap.org'>support@catacap.org</a></p>
  <p style='margin-bottom: 0px;'>Transfer Email Details:</p>
  <p style='margin-top: 0px;'>&ldquo;Please transfer from my DAF at ImpactAssets, ${dafName}, to CataCap DAF #439888 the amount of ${formattedAmount}.&rdquo;</p>
  <p>We will, upon receipt of the CC email to <a href='mailto:support@catacap.org'>support@catacap.org</a>, immediately apply your account contribution and - if targeted to a specific investment - also to that investment on CataCap.</p>
  <p>Thank you.</p>
  <li><b>Forward the confirmation email</b> to <b><a href='mailto:support@catacap.org'>support@catacap.org</a></b></li>
</ol>`;
  }

  const dafLink = dafProviderLink
    ? `<a href='${dafProviderLink}' target='_blank'>${dafProviderName}</a>`
    : dafProviderName;

  const donationRecipient = "CataCap";

  return `<ol>
  <li><b>Log in </b>to your ${dafLink} account</li>
  <li><b>Initiate a donation </b>using the following details:</li>
  <ul style='list-style-type: disc; padding-left: 10px; margin-left: 0;'>
    <li><b>Donation Recipient:</b> ${donationRecipient}</li>
    <li><b>Project Name/ Grant Purpose:</b> CataCap</li>
    <li><b>Amount:</b> ${formattedAmount}</li>
    <li><b>EIN:</b> 86-2370923</li>
    <li><b>Email:</b> <a href='mailto:support@catacap.org'>support@catacap.org</a></li>
    <li><b>Address:</b> 3749 Buchanan St Unit 475207, San Francisco, CA 94147</li>
  </ul>
  <li><b>Forward the confirmation email</b> to <b><a href='mailto:support@catacap.org'>support@catacap.org</a></b> so we can apply your investment right away.</li>
</ol>`;
}

function buildFoundationDonationRecipientSection(
  formattedAmount: string,
): string {
  return `<ol>
  <li>Prepare your foundation check using the following details:</li>
  <ul style='list-style-type:disc;'>
    <li><b>Donation Recipient:</b> CataCap</li>
    <li><b>Amount:</b> ${formattedAmount}</li>
    <li><b>EIN:</b> 86-2370923</li>
    <li><b>Email:</b> <a href='mailto:support@catacap.org'>support@catacap.org</a></li>
    <li><b>Address:</b> 3749 Buchanan Street Unit 475207, San Francisco, CA 94147</li>
  </ul>
  <li><b>Forward your grant confirmation</b> to <a href='mailto:support@catacap.org'>support@catacap.org</a> so we can apply your investment without delay.</li>
</ol>`;
}

export async function runSendReminderEmail(): Promise<void> {
  const jobName = "SendReminderEmail";
  let day3Count = 0;
  let week2Count = 0;
  let errorMessage: string | null = null;
  const processingErrors: string[] = [];
  const startTime = new Date();
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
            [startTime, jobName, "Running", { day3: 0, week2: 0 }],
          )
        : await pool.query<{ id: number }>(
            `INSERT INTO scheduler_logs (start_time, job_name, metadata)
             VALUES ($1, $2, $3) RETURNING id`,
            [startTime, jobName, { day3: 0, week2: 0 }],
          );
      schedulerLogId = insertResult.rows[0]?.id ?? null;
    } catch (logErr) {
      console.error("[SCHEDULER] Failed to insert SendReminderEmail start log:", logErr);
    }

    const queryParams: unknown[] = [];
    let paramIndex = 0;

    let pendingGrantsQuery = `
      SELECT
        pg.id AS pending_grant_id,
        pg.user_id,
        pg.amount,
        pg.daf_provider,
        pg.daf_name,
        pg.campaign_id,
        pg.status,
        pg.created_date,
        (CURRENT_DATE - pg.created_date::date) AS days_diff,
        u.email AS user_email,
        u.first_name AS user_first_name,
        c.name AS campaign_name,
        c.contact_info_full_name AS campaign_contact_name,
        c.property AS campaign_property
      FROM pending_grants pg
      JOIN users u ON u.id = pg.user_id
      LEFT JOIN campaigns c ON c.id = pg.campaign_id
      WHERE LOWER(pg.status) = 'pending'
        AND pg.created_date IS NOT NULL
        AND (CURRENT_DATE - pg.created_date::date) IN (3, 14)
        AND (pg.is_deleted = false OR pg.is_deleted IS NULL)
    `;

    const pendingGrants =
      queryParams.length > 0
        ? await pool.query(pendingGrantsQuery, queryParams)
        : await pool.query(pendingGrantsQuery);

    console.log(
      `[SCHEDULER] -> SendReminderEmail query returned ${pendingGrants.rows.length} pending grant(s)`,
    );

    if (pendingGrants.rows.length === 0) {
      const diagnosticResult = await pool.query(`
        SELECT 
          COUNT(*) AS total_pending,
          COUNT(*) FILTER (WHERE (CURRENT_DATE - pg.created_date::date) >= 3) AS day3_eligible,
          COUNT(*) FILTER (WHERE (CURRENT_DATE - pg.created_date::date) >= 14) AS week2_eligible,
          MIN(CURRENT_DATE - pg.created_date::date) AS min_days_diff,
          MAX(CURRENT_DATE - pg.created_date::date) AS max_days_diff
        FROM pending_grants pg
        WHERE LOWER(pg.status) = 'pending'
          AND pg.created_date IS NOT NULL
          AND (pg.is_deleted = false OR pg.is_deleted IS NULL)
      `);
      const diag = diagnosticResult.rows[0];
      console.log(
        `[SCHEDULER] Diagnostics: total pending grants=${diag.total_pending}, ` +
          `day3_eligible=${diag.day3_eligible}, week2_eligible=${diag.week2_eligible}, ` +
          `days range=${diag.min_days_diff}-${diag.max_days_diff}`,
      );
    }

    for (const grant of pendingGrants.rows) {
      const daysDiff = parseInt(grant.days_diff, 10);

      const reminderTypes: string[] = [];
      if (daysDiff === 14) {
        reminderTypes.push("Week2");
      } else if (daysDiff === 3) {
        reminderTypes.push("Day3");
      } else {
        continue;
      }

      for (const reminderType of reminderTypes) {
        try {
          const dafProvider = (grant.daf_provider || "").trim().toLowerCase();

          if (dafProvider && dafProvider !== "foundation grant") {
            const dafProviderLink = await getDafLink(dafProvider);
            const amount = parseFloat(grant.amount) || 0;
            const category = getDAFCategory(
              reminderType,
              (grant.daf_provider || "").trim(),
            );

            const resolvedDafName =
              grant.daf_name ?? (grant.daf_provider || "").trim();
            const trimmedProvider = (grant.daf_provider || "").trim();
            const donationRecipientSection = buildDafDonationRecipientSection(
              trimmedProvider,
              dafProviderLink,
              resolvedDafName,
              formatAmount(amount),
            );

            const variables: Record<string, string> = {
              logoUrl: process.env.LOGO_URL || "",
              firstName: grant.user_first_name || "",
              amount: formatAmount(amount),
              investmentScenario: grant.campaign_name || "",
              dafProviderName: trimmedProvider,
              dafProviderLink: dafProviderLink || "",
              dafName: resolvedDafName,
              investmentOwnerName: grant.campaign_contact_name || "",
              investmentUrl: `${BASE_URL}/investments/${grant.campaign_property || ""}`,
              unsubscribeUrl: `${BASE_URL}/settings`,
              donationRecipientSection,
            };

            if (reminderType === "Day3") day3Count++;
            if (reminderType === "Week2") week2Count++;

            queueEmail({
              category,
              toEmail: grant.user_email,
              variables,
              pendingGrantId: grant.pending_grant_id,
              userId: grant.user_id,
              reminderType,
              schedulerLogId,
            });
          } else if (dafProvider === "foundation grant") {
            const amount = parseFloat(grant.amount) || 0;
            const category = getFoundationCategory(reminderType);

            const investmentScenario = grant.campaign_name
              ? `to <b>${grant.campaign_name}</b>`
              : "to CataCap";

            const variables: Record<string, string> = {
              logoUrl: process.env.LOGO_URL || "",
              firstName: grant.user_first_name || "",
              amount: formatAmount(amount),
              investmentScenario,
              investmentOwnerName: grant.campaign_contact_name || "",
              investmentUrl: `${BASE_URL}/investments/${grant.campaign_property || ""}`,
              unsubscribeUrl: `${BASE_URL}/settings`,
              donationRecipientSection: buildFoundationDonationRecipientSection(
                formatAmount(amount),
              ),
            };

            if (reminderType === "Day3") day3Count++;
            if (reminderType === "Week2") week2Count++;

            queueEmail({
              category,
              toEmail: grant.user_email,
              variables,
              pendingGrantId: grant.pending_grant_id,
              userId: grant.user_id,
              reminderType,
              schedulerLogId,
            });
          } else {
            console.log(
              `[SCHEDULER] Grant ${grant.pending_grant_id} has no/unrecognized daf_provider="${grant.daf_provider}", skipping ${reminderType} reminder`,
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[SCHEDULER] Error processing grant ${grant.pending_grant_id} (${reminderType}):`,
            message,
          );
          processingErrors.push(`Grant ${grant.pending_grant_id} (${reminderType}): ${message}`);
        }
      }
    }

    if (processingErrors.length > 0) {
      const summary = `${processingErrors.length} grant(s) failed to process: ${processingErrors.join("; ")}`;
      console.error(`[SCHEDULER] SendReminderEmail completed with errors: ${summary}`);
      errorMessage = summary;
      throw new Error(summary);
    }

    console.log(
      `[SCHEDULER] SendReminderEmail complete: Day3=${day3Count}, Week2=${week2Count}, emails queued for async delivery`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.toString() : String(err);
    if (!errorMessage) {
      errorMessage = message;
    }
    console.error("[SCHEDULER] SendReminderEmail error:", err);
    throw err;
  } finally {
    const status = errorMessage ? "Failed" : "Success";
    const endTime = new Date();
    const metadata = { day3: day3Count, week2: week2Count };
    try {
      if (schedulerLogId !== null) {
        if (hasStatusCol) {
          await pool.query(
            `UPDATE scheduler_logs
               SET end_time = $1, error_message = $2, status = $3, metadata = $4
             WHERE id = $5`,
            [endTime, errorMessage, status, metadata, schedulerLogId],
          );
        } else {
          await pool.query(
            `UPDATE scheduler_logs
               SET end_time = $1, error_message = $2, metadata = $3
             WHERE id = $4`,
            [endTime, errorMessage, metadata, schedulerLogId],
          );
        }
      } else if (hasStatusCol) {
        await pool.query(
          `INSERT INTO scheduler_logs
            (start_time, end_time, error_message, job_name, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [startTime, endTime, errorMessage, jobName, status, metadata],
        );
      } else {
        await pool.query(
          `INSERT INTO scheduler_logs
            (start_time, end_time, error_message, job_name, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [startTime, endTime, errorMessage, jobName, metadata],
        );
      }
    } catch (logErr) {
      console.error("[SCHEDULER] Failed to log SendReminderEmail run:", logErr);
    }
  }
}
