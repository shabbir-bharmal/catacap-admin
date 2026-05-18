import pool from "../db.js";
import type { PoolClient } from "pg";

interface PgDatabaseError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  where?: string;
  severity?: string;
}

function formatPgError(err: unknown): string {
  const pgErr = err as PgDatabaseError;
  const parts: string[] = [];

  parts.push(`Message: ${pgErr.message || String(err)}`);

  if (pgErr.code) parts.push(`SQLSTATE: ${pgErr.code}`);
  if (pgErr.severity) parts.push(`Severity: ${pgErr.severity}`);
  if (pgErr.table) parts.push(`Table: ${pgErr.schema ? pgErr.schema + "." : ""}${pgErr.table}`);
  if (pgErr.column) parts.push(`Column: ${pgErr.column}`);
  if (pgErr.constraint) parts.push(`Constraint: ${pgErr.constraint}`);
  if (pgErr.detail) parts.push(`Detail: ${pgErr.detail}`);
  if (pgErr.hint) parts.push(`Hint: ${pgErr.hint}`);
  if (pgErr.where) parts.push(`Where: ${pgErr.where}`);

  return parts.join(" | ");
}

async function tableExists(
  client: PoolClient,
  tableName: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return result.rows.length > 0;
}

async function columnExists(
  client: PoolClient,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2`,
    [tableName, columnName]
  );
  return result.rows.length > 0;
}

async function safeSoftDelete(
  client: PoolClient,
  table: string,
  where: string,
  params: unknown[]
): Promise<number> {
  if (!(await tableExists(client, table))) return 0;
  if (await columnExists(client, table, "is_deleted")) {
    const result = await client.query(
      `UPDATE ${table} SET is_deleted = true, deleted_at = NOW(), deleted_by = NULL WHERE ${where}`,
      params
    );
    return result.rowCount || 0;
  }
  const result = await client.query(
    `DELETE FROM ${table} WHERE ${where}`,
    params
  );
  return result.rowCount || 0;
}

async function safeUpdate(
  client: PoolClient,
  table: string,
  setClause: string,
  where: string,
  params: unknown[]
): Promise<number> {
  if (!(await tableExists(client, table))) return 0;
  const result = await client.query(
    `UPDATE ${table} SET ${setClause} WHERE ${where}`,
    params
  );
  return result.rowCount || 0;
}

async function archiveTable(
  client: PoolClient,
  sourceTable: string,
  query: string,
  params: unknown[],
  userIdExpr: string | null,
  useRecordId: boolean = true
): Promise<number> {
  if (!(await tableExists(client, sourceTable))) return 0;
  const rows = await client.query(query, params);
  for (const row of rows.rows) {
    const recordId = useRecordId && row.id != null ? String(row.id) : "0";
    const userId = userIdExpr && row[userIdExpr] ? row[userIdExpr] : null;
    await client.query(
      `INSERT INTO archived_user_data
        (source_table, record_id, user_id, record_json, days_old, deleted_at, archived_at)
       VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
      [sourceTable, recordId, userId, JSON.stringify(row)]
    );
  }
  return rows.rows.length;
}

export async function runDeleteTestUsers(): Promise<void> {
  const TAG = "[DELETE_TEST_USERS]";
  const client = await pool.connect();

  try {
    const testUsersResult = await client.query(
      `SELECT id, email FROM users
       WHERE user_name ILIKE '%test%'
          OR email ILIKE '%test%'
          OR first_name ILIKE '%test%'
          OR last_name ILIKE '%test%'`
    );

    if (testUsersResult.rows.length === 0) {
      console.log(`${TAG} No test users found. Exiting.`);
      return;
    }

    const testUserIds = testUsersResult.rows.map((r) => r.id);
    const testUserEmails = testUsersResult.rows
      .map((r) => r.email)
      .filter(Boolean);

    console.log(
      `${TAG} Found ${testUserIds.length} test user(s): ${testUserEmails.join(", ")}`
    );

    const campaignIds = (
      await client.query(
        `SELECT id FROM campaigns WHERE user_id = ANY($1)`,
        [testUserIds]
      )
    ).rows.map((r) => r.id);

    const groupIds = (
      await client.query(
        `SELECT id FROM groups WHERE owner_id = ANY($1)`,
        [testUserIds]
      )
    ).rows.map((r) => r.id);

    const pendingGrantIds = (
      await client.query(
        `SELECT id FROM pending_grants WHERE user_id = ANY($1)`,
        [testUserIds]
      )
    ).rows.map((r) => r.id);

    const disbursalRequestIds = (
      await client.query(
        `SELECT id FROM disbursal_requests WHERE user_id = ANY($1)`,
        [testUserIds]
      )
    ).rows.map((r) => r.id);

    const assetRequestIds = (
      await client.query(
        `SELECT id FROM asset_based_payment_requests WHERE user_id = ANY($1)`,
        [testUserIds]
      )
    ).rows.map((r) => r.id);

    const formSubmissionIds = (
      await client.query(
        `SELECT id FROM form_submissions WHERE email = ANY($1)`,
        [testUserEmails]
      )
    ).rows.map((r) => r.id);

    const returnMasterIds =
      campaignIds.length > 0
        ? (
            await client.query(
              `SELECT id FROM return_masters WHERE campaign_id = ANY($1)`,
              [campaignIds]
            )
          ).rows.map((r) => r.id)
        : [];

    const completedInvestmentIds =
      campaignIds.length > 0
        ? (
            await client.query(
              `SELECT id FROM completed_investment_details WHERE campaign_id = ANY($1)`,
              [campaignIds]
            )
          ).rows.map((r) => r.id)
        : [];

    console.log(`${TAG} Related records collected:`);
    console.log(`${TAG}   campaigns: ${campaignIds.length}`);
    console.log(`${TAG}   groups: ${groupIds.length}`);
    console.log(`${TAG}   pending_grants: ${pendingGrantIds.length}`);
    console.log(`${TAG}   disbursal_requests: ${disbursalRequestIds.length}`);
    console.log(`${TAG}   asset_requests: ${assetRequestIds.length}`);
    console.log(`${TAG}   form_submissions: ${formSubmissionIds.length}`);
    console.log(`${TAG}   return_masters: ${returnMasterIds.length}`);
    console.log(`${TAG}   completed_investments: ${completedInvestmentIds.length}`);

    await client.query("BEGIN");
    let totalNullified = 0;
    let totalArchived = 0;
    let totalDeleted = 0;

    try {
      console.log(`${TAG} Step 1: Nullifying FK audit columns...`);
      totalNullified += await safeUpdate(client, "approvers", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "users", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "catacap_teams", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "catacap_teams", "modified_by = NULL", "modified_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "catacap_teams", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "email_templates", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "email_templates", "modified_by = NULL", "modified_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "email_templates", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "events", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "events", "modified_by = NULL", "modified_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "events", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "faqs", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "faqs", "modified_by = NULL", "modified_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "faqs", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "news", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "news", "modified_by = NULL", "modified_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "news", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "investment_tags", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      // NOTE: The following NOT NULL columns are intentionally NOT nullified
      // (setting them to NULL would cause a constraint violation and roll back the transaction):
      //   - module_access_permissions.updated_by (NOT NULL, no FK to users)
      //   - return_masters.created_by (NOT NULL, no FK to users)
      //   - completed_investment_details.created_by (NOT NULL, no FK to users)
      // See sp_DailyCleanup.sql lines 89-93 for reference documentation.

      totalNullified += await safeUpdate(client, "completed_investment_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);

      if (completedInvestmentIds.length > 0) {
        totalNullified += await safeUpdate(client, "completed_investment_details", "deleted_by = NULL", "deleted_by = ANY($1) AND id != ALL($2)", [testUserIds, completedInvestmentIds]);
      } else {
        totalNullified += await safeUpdate(client, "completed_investment_details", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);
      }

      totalNullified += await safeUpdate(client, "site_configurations", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "themes", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "testimonials", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "scheduled_email_logs", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "account_balance_change_logs", "deleted_by = NULL", "deleted_by = ANY($1)", [testUserIds]);

      if (assetRequestIds.length > 0) {
        totalNullified += await safeUpdate(client, "asset_based_payment_request_notes", "created_by = NULL", "created_by = ANY($1) AND request_id != ALL($2)", [testUserIds, assetRequestIds]);
      } else {
        totalNullified += await safeUpdate(client, "asset_based_payment_request_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      }

      if (disbursalRequestIds.length > 0) {
        totalNullified += await safeUpdate(client, "disbursal_request_notes", "created_by = NULL", "created_by = ANY($1) AND disbursal_request_id != ALL($2)", [testUserIds, disbursalRequestIds]);
      } else {
        totalNullified += await safeUpdate(client, "disbursal_request_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      }

      if (formSubmissionIds.length > 0) {
        totalNullified += await safeUpdate(client, "form_submission_notes", "created_by = NULL", "created_by = ANY($1) AND form_submission_id != ALL($2)", [testUserIds, formSubmissionIds]);
      } else {
        totalNullified += await safeUpdate(client, "form_submission_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      }

      if (campaignIds.length > 0) {
        totalNullified += await safeUpdate(client, "investment_notes", "created_by = NULL", "created_by = ANY($1) AND campaign_id != ALL($2)", [testUserIds, campaignIds]);
      } else {
        totalNullified += await safeUpdate(client, "investment_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      }

      if (pendingGrantIds.length > 0) {
        totalNullified += await safeUpdate(client, "pending_grant_notes", "created_by = NULL", "created_by = ANY($1) AND pending_grant_id != ALL($2)", [testUserIds, pendingGrantIds]);
      } else {
        totalNullified += await safeUpdate(client, "pending_grant_notes", "created_by = NULL", "created_by = ANY($1)", [testUserIds]);
      }

      totalNullified += await safeUpdate(client, "asset_based_payment_requests", "updated_by = NULL", "updated_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "asset_based_payment_requests", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "disbursal_requests", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "campaigns", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "groups", "deleted_by = NULL", "deleted_by = ANY($1) AND owner_id != ALL($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "pending_grants", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "pending_grants", "rejected_by = NULL", "rejected_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "recommendations", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "recommendations", "rejected_by = NULL", "rejected_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);

      totalNullified += await safeUpdate(client, "requests", "deleted_by = NULL", "deleted_by = ANY($1) AND request_owner_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "return_details", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "investment_requests", "modified_by = NULL", "modified_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "investment_requests", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "investment_feedbacks", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "user_investments", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "leader_groups", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "group_account_balances", "deleted_by = NULL", "deleted_by = ANY($1) AND user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "user_notifications", "deleted_by = NULL", "deleted_by = ANY($1) AND target_user_id != ALL($1)", [testUserIds]);
      totalNullified += await safeUpdate(client, "form_submissions", "deleted_by = NULL", "deleted_by = ANY($1) AND email != ALL($2)", [testUserIds, testUserEmails]);
      console.log(`${TAG} Step 1 complete: ${totalNullified} rows nullified.`);

      console.log(`${TAG} Step 2: Archiving related records...`);
      totalArchived += await archiveTable(client, "users", "SELECT * FROM users WHERE id = ANY($1)", [testUserIds], "id");
      totalArchived += await archiveTable(client, "user_roles", "SELECT * FROM user_roles WHERE user_id = ANY($1)", [testUserIds], null);
      totalArchived += await archiveTable(client, "campaigns", "SELECT * FROM campaigns WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "groups", "SELECT * FROM groups WHERE owner_id = ANY($1)", [testUserIds], "owner_id");
      totalArchived += await archiveTable(client, "pending_grants", "SELECT * FROM pending_grants WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "asset_based_payment_requests", "SELECT * FROM asset_based_payment_requests WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "disbursal_requests", "SELECT * FROM disbursal_requests WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "form_submissions", "SELECT * FROM form_submissions WHERE email = ANY($1)", [testUserEmails], null);

      if (await tableExists(client, "user_stripe_customer_mappings")) {
        totalArchived += await archiveTable(client, "user_stripe_customer_mappings", "SELECT * FROM user_stripe_customer_mappings WHERE user_id = ANY($1)", [testUserIds], null, false);
      }
      if (await tableExists(client, "user_stripe_transaction_mappings")) {
        totalArchived += await archiveTable(client, "user_stripe_transaction_mappings", "SELECT * FROM user_stripe_transaction_mappings WHERE user_id = ANY($1)", [testUserIds], null, false);
      }

      totalArchived += await archiveTable(client, "recommendations", "SELECT * FROM recommendations WHERE user_id = ANY($1) OR user_email = ANY($2)", [testUserIds, testUserEmails], "user_id");
      totalArchived += await archiveTable(client, "user_investments", "SELECT * FROM user_investments WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "investment_requests", "SELECT * FROM investment_requests WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "investment_feedbacks", "SELECT * FROM investment_feedbacks WHERE user_id = ANY($1)", [testUserIds], "user_id");
      totalArchived += await archiveTable(client, "user_notifications", "SELECT * FROM user_notifications WHERE target_user_id = ANY($1)", [testUserIds], null);
      totalArchived += await archiveTable(client, "testimonials", "SELECT * FROM testimonials WHERE user_id = ANY($1)", [testUserIds], "user_id");

      if (groupIds.length > 0) {
        totalArchived += await archiveTable(client, "requests", "SELECT * FROM requests WHERE group_to_follow_id = ANY($1) OR request_owner_id = ANY($2) OR user_to_follow_id = ANY($2)", [groupIds, testUserIds], null);
        totalArchived += await archiveTable(client, "leader_groups", "SELECT * FROM leader_groups WHERE user_id = ANY($1) OR group_id = ANY($2)", [testUserIds, groupIds], null);
        totalArchived += await archiveTable(client, "group_account_balances", "SELECT * FROM group_account_balances WHERE user_id = ANY($1) OR group_id = ANY($2)", [testUserIds, groupIds], null);
      } else {
        totalArchived += await archiveTable(client, "requests", "SELECT * FROM requests WHERE request_owner_id = ANY($1) OR user_to_follow_id = ANY($1)", [testUserIds], null);
        totalArchived += await archiveTable(client, "leader_groups", "SELECT * FROM leader_groups WHERE user_id = ANY($1)", [testUserIds], null);
        totalArchived += await archiveTable(client, "group_account_balances", "SELECT * FROM group_account_balances WHERE user_id = ANY($1)", [testUserIds], null);
      }

      if (campaignIds.length > 0) {
        totalArchived += await archiveTable(client, "ach_payment_requests", "SELECT * FROM ach_payment_requests WHERE campaign_id = ANY($1)", [campaignIds], null);
        totalArchived += await archiveTable(client, "completed_investment_details", "SELECT * FROM completed_investment_details WHERE campaign_id = ANY($1)", [campaignIds], null);
        totalArchived += await archiveTable(client, "return_masters", "SELECT * FROM return_masters WHERE campaign_id = ANY($1)", [campaignIds], null);
      }

      if (returnMasterIds.length > 0 || testUserIds.length > 0) {
        totalArchived += await archiveTable(client, "return_details", "SELECT * FROM return_details WHERE return_master_id = ANY($1) OR user_id = ANY($2)", [returnMasterIds.length > 0 ? returnMasterIds : [0], testUserIds], "user_id");
      }

      if (pendingGrantIds.length > 0 || testUserIds.length > 0) {
        totalArchived += await archiveTable(client, "scheduled_email_logs", "SELECT * FROM scheduled_email_logs WHERE pending_grant_id = ANY($1) OR user_id = ANY($2)", [pendingGrantIds.length > 0 ? pendingGrantIds : [0], testUserIds], "user_id");
      }

      if (pendingGrantIds.length > 0 || assetRequestIds.length > 0 || campaignIds.length > 0 || testUserIds.length > 0) {
        totalArchived += await archiveTable(
          client,
          "account_balance_change_logs",
          `SELECT * FROM account_balance_change_logs
           WHERE pending_grants_id = ANY($1)
              OR asset_based_payment_request_id = ANY($2)
              OR campaign_id = ANY($3)
              OR user_id = ANY($4)`,
          [
            pendingGrantIds.length > 0 ? pendingGrantIds : [0],
            assetRequestIds.length > 0 ? assetRequestIds : [0],
            campaignIds.length > 0 ? campaignIds : [0],
            testUserIds,
          ],
          "user_id"
        );
      }

      if (completedInvestmentIds.length > 0) {
        totalArchived += await archiveTable(client, "completed_investment_notes", "SELECT * FROM completed_investment_notes WHERE completed_investment_id = ANY($1)", [completedInvestmentIds], null);
      }

      if (pendingGrantIds.length > 0) {
        totalArchived += await archiveTable(client, "pending_grant_notes", "SELECT * FROM pending_grant_notes WHERE pending_grant_id = ANY($1)", [pendingGrantIds], null);
      }

      if (assetRequestIds.length > 0) {
        totalArchived += await archiveTable(client, "asset_based_payment_request_notes", "SELECT * FROM asset_based_payment_request_notes WHERE request_id = ANY($1)", [assetRequestIds], null);
      }

      if (disbursalRequestIds.length > 0) {
        totalArchived += await archiveTable(client, "disbursal_request_notes", "SELECT * FROM disbursal_request_notes WHERE disbursal_request_id = ANY($1)", [disbursalRequestIds], null);
      }

      if (formSubmissionIds.length > 0) {
        totalArchived += await archiveTable(client, "form_submission_notes", "SELECT * FROM form_submission_notes WHERE form_submission_id = ANY($1)", [formSubmissionIds], null);
      }

      if (campaignIds.length > 0) {
        totalArchived += await archiveTable(client, "investment_notes", "SELECT * FROM investment_notes WHERE campaign_id = ANY($1)", [campaignIds], null);
        totalArchived += await archiveTable(client, "investment_tag_mappings", "SELECT * FROM investment_tag_mappings WHERE campaign_id = ANY($1)", [campaignIds], null, false);
      }

      if (campaignIds.length > 0 || groupIds.length > 0) {
        const cIds = campaignIds.length > 0 ? campaignIds : [0];
        const gIds = groupIds.length > 0 ? groupIds : [0];
        totalArchived += await archiveTable(client, "campaign_groups", "SELECT * FROM campaign_groups WHERE campaigns_id = ANY($1) OR groups_id = ANY($2)", [cIds, gIds], null);
      }
      console.log(`${TAG} Step 2 complete: ${totalArchived} records archived.`);

      console.log(`${TAG} Step 3: Deleting/soft-deleting related records...`);
      if (completedInvestmentIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "completed_investment_notes", "completed_investment_id = ANY($1)", [completedInvestmentIds]);
      }

      if (returnMasterIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "return_details", "return_master_id = ANY($1)", [returnMasterIds]);
      }

      if (pendingGrantIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "pending_grant_notes", "pending_grant_id = ANY($1)", [pendingGrantIds]);
        totalDeleted += await safeSoftDelete(client, "scheduled_email_logs", "pending_grant_id = ANY($1)", [pendingGrantIds]);
        totalDeleted += await safeSoftDelete(client, "account_balance_change_logs", "pending_grants_id = ANY($1)", [pendingGrantIds]);
      }

      if (assetRequestIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "asset_based_payment_request_notes", "request_id = ANY($1)", [assetRequestIds]);
        totalDeleted += await safeSoftDelete(client, "account_balance_change_logs", "asset_based_payment_request_id = ANY($1)", [assetRequestIds]);
      }

      if (disbursalRequestIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "disbursal_request_notes", "disbursal_request_id = ANY($1)", [disbursalRequestIds]);
      }

      if (formSubmissionIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "form_submission_notes", "form_submission_id = ANY($1)", [formSubmissionIds]);
      }

      if (campaignIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "investment_notes", "campaign_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "investment_tag_mappings", "campaign_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "campaign_groups", "campaigns_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "ach_payment_requests", "campaign_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "account_balance_change_logs", "campaign_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "completed_investment_details", "campaign_id = ANY($1)", [campaignIds]);
        totalDeleted += await safeSoftDelete(client, "return_masters", "campaign_id = ANY($1)", [campaignIds]);
      }

      if (groupIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "requests", "group_to_follow_id = ANY($1)", [groupIds]);
        totalDeleted += await safeSoftDelete(client, "campaign_groups", "groups_id = ANY($1)", [groupIds]);
      }

      totalDeleted += await safeSoftDelete(client, "user_stripe_customer_mappings", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "user_stripe_transaction_mappings", "user_id = ANY($1)", [testUserIds]);

      totalDeleted += await safeSoftDelete(client, "pending_grants", "user_id = ANY($1)", [testUserIds]);

      if (campaignIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "asset_based_payment_requests", "user_id = ANY($1) OR campaign_id = ANY($2)", [testUserIds, campaignIds]);
      } else {
        totalDeleted += await safeSoftDelete(client, "asset_based_payment_requests", "user_id = ANY($1)", [testUserIds]);
      }

      totalDeleted += await safeSoftDelete(client, "disbursal_requests", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "form_submissions", "email = ANY($1)", [testUserEmails]);

      if (testUserEmails.length > 0) {
        totalDeleted += await safeSoftDelete(client, "recommendations", "user_id = ANY($1) OR user_email = ANY($2)", [testUserIds, testUserEmails]);
      } else {
        totalDeleted += await safeSoftDelete(client, "recommendations", "user_id = ANY($1)", [testUserIds]);
      }

      totalDeleted += await safeSoftDelete(client, "user_investments", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "investment_requests", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "return_details", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "investment_feedbacks", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "user_notifications", "target_user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "account_balance_change_logs", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "scheduled_email_logs", "user_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "testimonials", "user_id = ANY($1)", [testUserIds]);

      if (groupIds.length > 0) {
        totalDeleted += await safeSoftDelete(client, "leader_groups", "user_id = ANY($1) OR group_id = ANY($2)", [testUserIds, groupIds]);
        totalDeleted += await safeSoftDelete(client, "group_account_balances", "user_id = ANY($1) OR group_id = ANY($2)", [testUserIds, groupIds]);
      } else {
        totalDeleted += await safeSoftDelete(client, "leader_groups", "user_id = ANY($1)", [testUserIds]);
        totalDeleted += await safeSoftDelete(client, "group_account_balances", "user_id = ANY($1)", [testUserIds]);
      }

      if (groupIds.length > 0) {
        totalNullified += await safeUpdate(client, "campaigns", "group_for_private_access_id = NULL", "group_for_private_access_id = ANY($1) AND user_id != ALL($2)", [groupIds, testUserIds]);
      }

      totalDeleted += await safeSoftDelete(client, "groups", "owner_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "campaigns", "user_id = ANY($1)", [testUserIds]);

      totalDeleted += await safeSoftDelete(client, "requests", "request_owner_id = ANY($1) OR user_to_follow_id = ANY($1)", [testUserIds]);
      totalDeleted += await safeSoftDelete(client, "user_roles", "user_id = ANY($1)", [testUserIds]);

      const softDeleteCount = await safeSoftDelete(client, "users", "id = ANY($1)", [testUserIds]);
      totalDeleted += softDeleteCount;

      await client.query("COMMIT");

      console.log(`${TAG} Step 3 complete: ${totalDeleted} related records deleted/soft-deleted.`);
      console.log(`${TAG} Summary: ${softDeleteCount} test user(s) soft-deleted, ${totalNullified} FK references nullified, ${totalArchived} records archived, ${totalDeleted} related records removed.`);
    } catch (err) {
      await client.query("ROLLBACK");
      const errorDetail = formatPgError(err);
      console.error(`${TAG} TRANSACTION ROLLED BACK — ${errorDetail}`);
      const wrappedError = new Error(errorDetail);
      (wrappedError as PgDatabaseError).code = (err as PgDatabaseError).code;
      (wrappedError as PgDatabaseError).table = (err as PgDatabaseError).table;
      (wrappedError as PgDatabaseError).column = (err as PgDatabaseError).column;
      (wrappedError as PgDatabaseError).constraint = (err as PgDatabaseError).constraint;
      throw wrappedError;
    }
  } finally {
    client.release();
  }
}
