import type pg from "pg";
import pool from "../db.js";
import { sendTemplateEmail } from "./emailService.js";

const TEMPLATE_NEW_INVESTMENT = 30; // "CampaignInvestmentNotification"
const TEMPLATE_CAMPAIGN_OWNER_FUNDING = 15; // "Campaign Owner Funding Notification"

function formatUsdAmount(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  if (!isFinite(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Notify a campaign's contact email that a donor just funded the campaign
 * via a wallet / group-balance recommendation. Mirrors .NET's
 * `RecommendationsController.CreateRecommendation` and
 * `Admin/RecommendationsController.AddRecommendation` template-15 send.
 *
 * Best-effort: returns false (without throwing) when the campaign has no
 * contact email or any expected lookup row is missing. Caller should invoke
 * AFTER the recommendation transaction has committed and use a `.catch()`
 * so a failed email never rolls back the recommendation insert.
 */
export async function sendCampaignOwnerFundingNotification(args: {
  campaignId: number;
  recommendationAmount: number;
  donorUserId: string | number | null | undefined;
}): Promise<boolean> {
  const { campaignId, recommendationAmount, donorUserId } = args;
  try {
    const campaignRes = await pool.query(
      `SELECT id, name, description, property,
              contact_info_full_name,
              contact_info_email_address
         FROM campaigns
        WHERE id = $1
        LIMIT 1`,
      [campaignId],
    );
    const campaign = campaignRes.rows[0];
    if (!campaign) return false;

    const contactEmail = String(campaign.contact_info_email_address ?? "")
      .trim();
    if (!contactEmail) return false;

    let donorFirstName = "";
    let donorLastName = "";
    let isAnonymous = false;
    if (donorUserId != null && donorUserId !== "") {
      const donorRes = await pool.query(
        `SELECT first_name, last_name, is_anonymous_investment
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [donorUserId],
      );
      const donor = donorRes.rows[0];
      if (donor) {
        donorFirstName = String(donor.first_name ?? "").trim();
        donorLastName = String(donor.last_name ?? "").trim();
        isAnonymous = donor.is_anonymous_investment === true;
      }
    }

    const totalsRes = await pool.query(
      `SELECT COALESCE(SUM(r.amount), 0) AS total_raised,
              COUNT(DISTINCT r.user_email) AS total_investors
         FROM recommendations r
        WHERE r.campaign_id = $1
          AND LOWER(TRIM(r.status)) IN ('approved','pending')
          AND r.amount > 0
          AND r.user_email IS NOT NULL
          AND (r.is_deleted IS NULL OR r.is_deleted = false)`,
      [campaignId],
    );
    const totalsRow = totalsRes.rows[0] || {};
    const totalRaised = parseFloat(totalsRow.total_raised ?? "0") || 0;
    const totalInvestors = parseInt(totalsRow.total_investors ?? "0", 10) || 0;

    const requestOrigin =
      process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
    const origin = requestOrigin.replace(/\/$/, "");
    const logoUrl = process.env.LOGO_URL || "";

    const campaignIdentifier =
      (campaign.property && String(campaign.property).trim()) ||
      String(campaign.id);
    const campaignPageUrl = origin
      ? `${origin}/investments/${campaignIdentifier}`
      : "";

    const fullDonorName = `${donorFirstName} ${donorLastName}`.trim();
    const investorName = isAnonymous
      ? "a donor-investor"
      : fullDonorName || "a donor-investor";
    const investorDisplayName = isAnonymous
      ? "Someone"
      : fullDonorName || "Someone";
    const donorName = isAnonymous
      ? "An anonymous CataCap donor"
      : fullDonorName || "An anonymous CataCap donor";

    const contactFullName = String(campaign.contact_info_full_name ?? "").trim();
    const campaignFirstName = contactFullName ? contactFullName.split(/\s+/)[0] : "";

    const variables: Record<string, string> = {
      logoUrl,
      campaignName: String(campaign.name ?? ""),
      campaignDescription: String(campaign.description ?? ""),
      campaignUrl: campaignPageUrl,
      unsubscribeUrl: origin ? `${origin}/settings` : "",
      investorDisplayName,
      donorName,
      campaignFirstName,
      investorName,
      investmentAmount: formatUsdAmount(recommendationAmount),
      totalRaised: formatUsdAmount(totalRaised),
      totalInvestors: String(totalInvestors),
      campaignPageUrl,
    };

    return await sendTemplateEmail(
      TEMPLATE_CAMPAIGN_OWNER_FUNDING,
      contactEmail,
      variables,
    );
  } catch (err: any) {
    console.error(
      "sendCampaignOwnerFundingNotification: unexpected error:",
      err?.message || err,
    );
    return false;
  }
}

export interface InvestmentNotificationRecipient {
  id?: number;
  name: string;
  email: string;
}

type QueryExecutor = { query: typeof pool.query };

export async function getInvestmentNotificationRecipients(
  campaignId: number,
  executor: QueryExecutor = pool,
): Promise<InvestmentNotificationRecipient[]> {
  try {
    const result = await executor.query(
      `SELECT id, name, email
         FROM campaign_investment_notification_recipients
        WHERE campaign_id = $1
        ORDER BY position, id`,
      [campaignId],
    );
    return result.rows.map((r: any) => ({
      id: Number(r.id),
      name: r.name || "",
      email: r.email || "",
    }));
  } catch (err: any) {
    if (err?.code === "42P01") return [];
    throw err;
  }
}

/**
 * Replace the full list of notification recipients for a campaign.
 * Runs DELETE + INSERTs inside the caller's transaction so it stays
 * consistent with the surrounding campaign update.
 *
 * Empty/blank emails or emails without "@" are silently skipped.
 * Duplicate emails (case-insensitive) are de-duplicated.
 */
export async function replaceInvestmentNotificationRecipients(
  client: pg.PoolClient,
  campaignId: number,
  recipients: Array<{ name?: string | null; email?: string | null }> | null | undefined,
): Promise<void> {
  await client.query(
    `DELETE FROM campaign_investment_notification_recipients WHERE campaign_id = $1`,
    [campaignId],
  );
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const seen = new Set<string>();
  let position = 0;
  for (const r of recipients) {
    const email = String(r?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    const name = String(r?.name ?? "").trim();
    await client.query(
      `INSERT INTO campaign_investment_notification_recipients
         (campaign_id, name, email, position)
       VALUES ($1, $2, $3, $4)`,
      [campaignId, name, email, position],
    );
    position += 1;
  }
}

/**
 * Send a "new investor" notification email to every recipient
 * configured for the campaign. If no recipients are configured the
 * function falls back to the legacy single-recipient column
 * (investment_informational_email, then contact_info_email_address).
 *
 * Best-effort: per-recipient errors are logged but never thrown; the
 * caller's investment write is never rolled back because of email
 * delivery problems.
 */
export async function sendNewInvestmentNotifications(args: {
  campaignId: number;
  donorDisplayName: string;
  amount?: number | null;
}): Promise<void> {
  const { campaignId, donorDisplayName, amount } = args;
  try {
    const campaignRes = await pool.query(
      `SELECT id, name, property,
              contact_info_email_address,
              investment_informational_email
         FROM campaigns
        WHERE id = $1
        LIMIT 1`,
      [campaignId],
    );
    const campaign = campaignRes.rows[0];
    if (!campaign) return;

    const recipients = await getInvestmentNotificationRecipients(campaignId);

    let toSend: InvestmentNotificationRecipient[] = recipients;
    if (toSend.length === 0) {
      const fallback = String(
        campaign.investment_informational_email ||
          campaign.contact_info_email_address ||
          "",
      )
        .trim()
        .toLowerCase();
      if (fallback && fallback.includes("@")) {
        toSend = [{ name: "", email: fallback }];
      }
    }

    if (toSend.length === 0) return;

    const requestOrigin =
      process.env.REQUEST_ORIGIN || process.env.VITE_FRONTEND_URL || "";
    const logoUrl = process.env.LOGO_URL || "";
    const investmentLink = campaign.property
      ? `${requestOrigin.replace(/\/$/, "")}/investments/${campaign.property}`
      : requestOrigin || "";

    const seen = new Set<string>();
    for (const r of toSend) {
      const email = (r.email || "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      try {
        await sendTemplateEmail(TEMPLATE_NEW_INVESTMENT, email, {
          logoUrl,
          investorDisplayName: donorDisplayName || "An investor",
          donorName: donorDisplayName || "An investor",
          campaignName: campaign.name || "",
          investmentLink,
          recipientName: r.name || "",
          amount: amount != null ? String(amount) : "",
        });
      } catch (emailErr: any) {
        console.error(
          `sendNewInvestmentNotifications: failed for ${email}:`,
          emailErr?.message || emailErr,
        );
      }
    }
  } catch (err: any) {
    console.error(
      "sendNewInvestmentNotifications: unexpected error:",
      err?.message || err,
    );
  }
}
