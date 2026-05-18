import { Resend } from "resend";
import pool from "../db.js";
import { buildFromEmail } from "../utils/emailService.js";

const RECIPIENT = "ken@catacap.org";
const PERIOD_DAYS = 7;

interface CampaignDistribution {
  campaign_name: string;
  total_amount: number;
  investor_count: number;
}

interface WeeklyStats {
  periodStart: Date;
  periodEnd: Date;
  pendingGrantsThisWeekCount: number;
  pendingGrantsThisWeekAmount: number;
  grantsReceivedThisWeekCount: number;
  grantsReceivedThisWeekAmount: number;
  creditCardDonationsCount: number;
  creditCardDonationsAmount: number;
  achDonationsCount: number;
  achDonationsAmount: number;
  newRecommendationsCount: number;
  newRecommendationsAmount: number;
  approvedInvestmentsCount: number;
  approvedInvestmentsAmount: number;
  distributionsCount: number;
  distributionsAmount: number;
  distributionsByCampaign: CampaignDistribution[];
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n || 0);
}

function fmtDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  const s = new Intl.DateTimeFormat("en-US", opts).format(start);
  const e = new Intl.DateTimeFormat("en-US", opts).format(end);
  return `${s} → ${e}`;
}

async function gatherStats(periodEnd: Date): Promise<WeeklyStats> {
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const pendingThisWeek = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(grant_amount), 0) AS total
     FROM pending_grants
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND created_date >= $1 AND created_date < $2`,
    [periodStart, periodEnd],
  );

  // "Grants Received" approximates received-this-week as records currently in
  // status='received' whose modified_date falls in the window. Without a status
  // change history table, this is the best signal available; it could overcount
  // if a received grant is edited again later within the same week.
  const grantsReceived = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(grant_amount), 0) AS total
     FROM pending_grants
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND LOWER(TRIM(COALESCE(status, ''))) = 'received'
       AND modified_date >= $1 AND modified_date < $2`,
    [periodStart, periodEnd],
  );

  const ccDonations = await pool.query(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(COALESCE(gross_amount, GREATEST(new_value - old_value, 0))), 0) AS total
     FROM account_balance_change_logs
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND change_date >= $1 AND change_date < $2
       AND payment_type ILIKE '%card%'`,
    [periodStart, periodEnd],
  );

  const achDonations = await pool.query(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(COALESCE(gross_amount, GREATEST(new_value - old_value, 0))), 0) AS total
     FROM account_balance_change_logs
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND change_date >= $1 AND change_date < $2
       AND (payment_type ILIKE 'ach%' OR payment_type ILIKE '%bank%')`,
    [periodStart, periodEnd],
  );

  const newRecommendations = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
     FROM recommendations
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND date_created >= $1 AND date_created < $2`,
    [periodStart, periodEnd],
  );

  const approvedInvestments = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
     FROM recommendations
     WHERE (is_deleted IS NULL OR is_deleted = false)
       AND LOWER(TRIM(COALESCE(status, ''))) = 'approved'
       AND date_created >= $1 AND date_created < $2`,
    [periodStart, periodEnd],
  );

  const distRollup = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(rm.return_amount), 0) AS total
     FROM return_masters rm
     WHERE COALESCE(rm.post_date::timestamp, rm.created_on) >= $1
       AND COALESCE(rm.post_date::timestamp, rm.created_on) < $2`,
    [periodStart, periodEnd],
  );

  const distByCampaign = await pool.query(
    `WITH masters_in_window AS (
       SELECT rm.id, rm.campaign_id, rm.return_amount
       FROM return_masters rm
       WHERE COALESCE(rm.post_date::timestamp, rm.created_on) >= $1
         AND COALESCE(rm.post_date::timestamp, rm.created_on) < $2
     ),
     campaign_totals AS (
       SELECT campaign_id, SUM(return_amount) AS total_amount
       FROM masters_in_window
       GROUP BY campaign_id
     ),
     campaign_investors AS (
       SELECT m.campaign_id, COUNT(DISTINCT rd.user_id) AS investor_count
       FROM masters_in_window m
       LEFT JOIN return_details rd ON rd.return_master_id = m.id
         AND (rd.is_deleted IS NULL OR rd.is_deleted = false)
       GROUP BY m.campaign_id
     )
     SELECT COALESCE(c.name, 'Unknown') AS campaign_name,
            COALESCE(t.total_amount, 0) AS total_amount,
            COALESCE(i.investor_count, 0) AS investor_count
     FROM campaign_totals t
     LEFT JOIN campaign_investors i ON i.campaign_id = t.campaign_id
     LEFT JOIN campaigns c ON c.id = t.campaign_id
     ORDER BY total_amount DESC`,
    [periodStart, periodEnd],
  );

  return {
    periodStart,
    periodEnd,
    pendingGrantsThisWeekCount: parseInt(pendingThisWeek.rows[0].cnt) || 0,
    pendingGrantsThisWeekAmount: parseFloat(pendingThisWeek.rows[0].total) || 0,
    grantsReceivedThisWeekCount: parseInt(grantsReceived.rows[0].cnt) || 0,
    grantsReceivedThisWeekAmount: parseFloat(grantsReceived.rows[0].total) || 0,
    creditCardDonationsCount: parseInt(ccDonations.rows[0].cnt) || 0,
    creditCardDonationsAmount: parseFloat(ccDonations.rows[0].total) || 0,
    achDonationsCount: parseInt(achDonations.rows[0].cnt) || 0,
    achDonationsAmount: parseFloat(achDonations.rows[0].total) || 0,
    newRecommendationsCount: parseInt(newRecommendations.rows[0].cnt) || 0,
    newRecommendationsAmount: parseFloat(newRecommendations.rows[0].total) || 0,
    approvedInvestmentsCount: parseInt(approvedInvestments.rows[0].cnt) || 0,
    approvedInvestmentsAmount: parseFloat(approvedInvestments.rows[0].total) || 0,
    distributionsCount: parseInt(distRollup.rows[0].cnt) || 0,
    distributionsAmount: parseFloat(distRollup.rows[0].total) || 0,
    distributionsByCampaign: distByCampaign.rows.map((r: any) => ({
      campaign_name: r.campaign_name,
      total_amount: parseFloat(r.total_amount) || 0,
      investor_count: parseInt(r.investor_count) || 0,
    })),
  };
}

function buildEmailHtml(stats: WeeklyStats): string {
  const totalDonations = stats.creditCardDonationsAmount + stats.achDonationsAmount;
  const totalDonationsCount = stats.creditCardDonationsCount + stats.achDonationsCount;

  const distRows = stats.distributionsByCampaign.length === 0
    ? `<tr><td colspan="3" style="padding:12px;text-align:center;color:#888;font-style:italic;">No distributions in this period.</td></tr>`
    : stats.distributionsByCampaign
        .map(
          (d) =>
            `<tr>
              <td style="padding:8px 12px;border-top:1px solid #eee;">${escapeHtml(d.campaign_name)}</td>
              <td style="padding:8px 12px;border-top:1px solid #eee;text-align:right;">${fmtMoney(d.total_amount)}</td>
              <td style="padding:8px 12px;border-top:1px solid #eee;text-align:right;">${fmtNumber(d.investor_count)}</td>
            </tr>`,
        )
        .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <div style="background:#405189;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;">CataCap Weekly Admin Stats</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escapeHtml(fmtDateRange(stats.periodStart, stats.periodEnd))}</p>
    </div>

    <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;">

      <h2 style="font-size:15px;margin:0 0 12px;color:#405189;">Grants This Week</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;">New Pending Grants</td>
          <td style="padding:8px 12px;background:#f9fafb;text-align:right;font-weight:600;">${fmtNumber(stats.pendingGrantsThisWeekCount)} grants · ${fmtMoney(stats.pendingGrantsThisWeekAmount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;">Grants Received</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600;">${fmtNumber(stats.grantsReceivedThisWeekCount)} grants · ${fmtMoney(stats.grantsReceivedThisWeekAmount)}</td>
        </tr>
      </table>

      <h2 style="font-size:15px;margin:0 0 12px;color:#405189;">Donations Received This Week</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;">Credit Card</td>
          <td style="padding:8px 12px;background:#f9fafb;text-align:right;font-weight:600;">${fmtNumber(stats.creditCardDonationsCount)} · ${fmtMoney(stats.creditCardDonationsAmount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;">ACH / Bank</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600;">${fmtNumber(stats.achDonationsCount)} · ${fmtMoney(stats.achDonationsAmount)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#eef2ff;border-top:2px solid #c7d2fe;">Total Donations</td>
          <td style="padding:10px 12px;background:#eef2ff;border-top:2px solid #c7d2fe;text-align:right;font-weight:700;">${fmtNumber(totalDonationsCount)} · ${fmtMoney(totalDonations)}</td>
        </tr>
      </table>

      <h2 style="font-size:15px;margin:0 0 12px;color:#405189;">Investment Recommendations This Week</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;">New recommendations made</td>
          <td style="padding:8px 12px;background:#f9fafb;text-align:right;font-weight:600;">${fmtNumber(stats.newRecommendationsCount)} · ${fmtMoney(stats.newRecommendationsAmount)}</td>
        </tr>
      </table>

      <h2 style="font-size:15px;margin:0 0 12px;color:#405189;">Investment Activity This Week</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;">New Investments Approved</td>
          <td style="padding:8px 12px;background:#f9fafb;text-align:right;font-weight:600;">${fmtNumber(stats.approvedInvestmentsCount)} · ${fmtMoney(stats.approvedInvestmentsAmount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;">Total distributions</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600;">${fmtNumber(stats.distributionsCount)} · ${fmtMoney(stats.distributionsAmount)}</td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;border:1px solid #eee;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Investment</th>
            <th style="padding:8px 12px;text-align:right;font-weight:600;">Amount</th>
            <th style="padding:8px 12px;text-align:right;font-weight:600;">Investors Paid</th>
          </tr>
        </thead>
        <tbody>${distRows}</tbody>
      </table>

      <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
        Internal admin email · Sent automatically every Monday at noon PT.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function runWeeklyKenStats(options?: { recipients?: string[] }): Promise<void> {
  const now = new Date();
  const stats = await gatherStats(now);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[WEEKLY_KEN_STATS] RESEND_API_KEY not set — skipping send.");
    return;
  }

  const fromEmail = await buildFromEmail();
  let subject = `CataCap Weekly Stats — week ending ${now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" })}`;
  let html = buildEmailHtml(stats);

  // Default recipients = the legacy single RECIPIENT, but callers can override
  // (e.g. one-off scripts that need to send the digest to the leadership team).
  const overrideRecipients = (options?.recipients ?? [])
    .map((e) => (e || "").trim())
    .filter((e) => e.length > 0);
  let recipients: string[] = overrideRecipients.length > 0 ? overrideRecipients : [RECIPIENT];
  const originalRecipientsLabel = recipients.join(", ");

  const testOverride = process.env.TEST_EMAIL_OVERRIDE;
  if (testOverride) {
    subject = `[TEST] ${subject} (Original recipients: ${originalRecipientsLabel})`;
    const notice = `<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px;margin-bottom:15px;font-size:13px;color:#856404;border-radius:4px;"><strong>TEST MODE:</strong> This email was originally intended for <strong>${originalRecipientsLabel}</strong></div>`;
    html = notice + html;
    recipients = [testOverride];
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html,
  });

  if (error) {
    console.error("[WEEKLY_KEN_STATS] Resend error:", error);
    throw new Error(typeof error === "string" ? error : JSON.stringify(error));
  }

  console.log(
    `[WEEKLY_KEN_STATS] Sent to ${recipients.join(", ")}${
      testOverride ? ` (original: ${originalRecipientsLabel})` : ""
    } (id: ${data?.id})`,
  );
}
