import { schedulerPool as pool } from "../db.js";
import type { PoolClient } from "pg";

const TABLE_NAME_MAP: Record<string, string> = {
  AspNetUsers: "users",
  AspNetUserRoles: "user_roles",
  Campaigns: "campaigns",
  Groups: "groups",
  PendingGrants: "pending_grants",
  PendingGrantNotes: "pending_grant_notes",
  DisbursalRequest: "disbursal_requests",
  DisbursalRequestNotes: "disbursal_request_notes",
  AssetBasedPaymentRequest: "asset_based_payment_requests",
  AssetBasedPaymentRequestNotes: "asset_based_payment_request_notes",
  FormSubmission: "form_submissions",
  FormSubmissionNotes: "form_submission_notes",
  InvestmentNotes: "investment_notes",
  CompletedInvestmentsDetails: "completed_investment_details",
  CompletedInvestmentNotes: "completed_investment_notes",
  ACHPaymentRequests: "ach_payment_requests",
  InvestmentTagMapping: "investment_tag_mappings",
  CampaignDtoGroup: "campaign_groups",
  ReturnMasters: "return_masters",
  ScheduledEmailLogs: "scheduled_email_logs",
  AccountBalanceChangeLogs: "account_balance_change_logs",
  ReturnDetails: "return_details",
  Recommendations: "recommendations",
  UserInvestments: "user_investments",
  InvestmentRequest: "investment_requests",
  InvestmentFeedback: "investment_feedbacks",
  Requests: "requests",
  LeaderGroup: "leader_groups",
  GroupAccountBalance: "group_account_balances",
  UsersNotifications: "user_notifications",
  SiteConfiguration: "site_configurations",
  ApprovedBy: "approvers",
  CataCapTeam: "catacap_teams",
  EmailTemplate: "email_templates",
  Event: "events",
  Faq: "faqs",
  InvestmentTag: "investment_tags",
  ModuleAccessPermission: "module_access_permissions",
  News: "news",
  Testimonial: "testimonials",
  Themes: "themes",
};

const COL_NAME_MAP: Record<string, string> = {
  Id: "id",
  UserId: "user_id",
  OwnerId: "owner_id",
  DeletedBy: "deleted_by",
  CreatedBy: "created_by",
  ModifiedBy: "modified_by",
  UpdatedBy: "updated_by",
  RejectedBy: "rejected_by",
  RequestOwnerId: "request_owner_id",
  UserToFollowId: "user_to_follow_id",
  TargetUserId: "target_user_id",
  PendingGrantId: "pending_grant_id",
  DisbursalRequestId: "disbursal_request_id",
  RequestId: "request_id",
  FormSubmissionId: "form_submission_id",
  CampaignId: "campaign_id",
  CompletedInvestmentId: "completed_investment_id",
  PendingGrantsId: "pending_grants_id",
  AssetBasedPaymentRequestId: "asset_based_payment_request_id",
  DeletedAt: "deleted_at",
  CampaignsId: "campaigns_id",
  GroupToFollowId: "group_to_follow_id",
};

function t(name: string): string {
  return TABLE_NAME_MAP[name] || name;
}

function c(name: string): string {
  return COL_NAME_MAP[name] || name;
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

async function runStep(
  stepName: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CLEANUP] FAILED at step: ${stepName} — ${message}`);
    throw new Error(`Step "${stepName}" failed: ${message}`);
  }
}

async function archiveAndDelete(
  client: PoolClient,
  tableName: string,
  pkColumn: string,
  userIdColumn: string | null,
  cutoffDate: string
): Promise<void> {
  const pgTable = t(tableName);
  const pgPk = c(pkColumn);
  const pgUserId = userIdColumn ? c(userIdColumn) : null;

  if (!(await tableExists(client, pgTable))) {
    console.log(`  SKIP (table not found): ${pgTable}`);
    return;
  }

  if (!(await columnExists(client, pgTable, "deleted_at"))) {
    console.log(`  SKIP (no deleted_at): ${pgTable}`);
    return;
  }

  const userIdSelect = pgUserId
    ? `CAST(${pgUserId} AS VARCHAR(450))`
    : "NULL";

  await client.query(
    `INSERT INTO archived_user_data
      (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
     SELECT
       $1,
       CAST(${pgPk} AS TEXT),
       ${userIdSelect},
       deleted_at,
       (CURRENT_DATE - deleted_at::date),
       row_to_json(t)::TEXT,
       NOW()
     FROM ${pgTable} t
     WHERE deleted_at IS NOT NULL
       AND deleted_at <= $2
       AND NOT EXISTS (
         SELECT 1 FROM archived_user_data a
         WHERE a.source_table = $1
           AND a.record_id = CAST(t.${pgPk} AS TEXT)
           AND CAST(a.archived_at AS DATE) = CURRENT_DATE
       )`,
    [pgTable, cutoffDate]
  );

  const deleteResult = await client.query(
    `DELETE FROM ${pgTable}
     WHERE deleted_at IS NOT NULL AND deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgTable}: archived & deleted ${deleteResult.rowCount} row(s)`
  );
}

async function archiveAndDeleteOrphan(
  client: PoolClient,
  childTable: string,
  fkColumn: string,
  parentTable: string,
  parentPkCol: string,
  cutoffDate: string
): Promise<void> {
  const pgChild = t(childTable);
  const pgParent = t(parentTable);
  const pgFk = c(fkColumn);
  const pgParentPk = c(parentPkCol);

  if (!(await tableExists(client, pgChild))) {
    console.log(`  SKIP (table not found): ${pgChild}`);
    return;
  }

  if (!(await tableExists(client, pgParent))) {
    console.log(`  SKIP (parent not found): ${pgParent}`);
    return;
  }

  if (!(await columnExists(client, pgChild, pgFk))) {
    console.log(`  SKIP (column not found): ${pgChild}.${pgFk}`);
    return;
  }

  await client.query(
    `INSERT INTO archived_user_data
      (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
     SELECT
       $1,
       CAST(c.id AS TEXT),
       NULL,
       p.deleted_at,
       (CURRENT_DATE - p.deleted_at::date),
       row_to_json(c)::TEXT,
       NOW()
     FROM ${pgChild} c
     JOIN ${pgParent} p
       ON p.${pgParentPk} = c.${pgFk}
       AND p.deleted_at IS NOT NULL
       AND p.deleted_at <= $2
     WHERE NOT EXISTS (
       SELECT 1 FROM archived_user_data a
       WHERE a.source_table = $1
         AND a.record_id = CAST(c.id AS TEXT)
         AND CAST(a.archived_at AS DATE) = CURRENT_DATE
     )`,
    [pgChild, cutoffDate]
  );

  const deleteResult = await client.query(
    `DELETE FROM ${pgChild} c
     USING ${pgParent} p
     WHERE p.${pgParentPk} = c.${pgFk}
       AND p.deleted_at IS NOT NULL
       AND p.deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgChild} (orphan): archived & deleted ${deleteResult.rowCount} row(s)`
  );
}

async function archiveAndDeleteOrphanByGrandparent(
  client: PoolClient,
  childTable: string,
  fkToParent: string,
  parentTable: string,
  parentPkCol: string,
  parentFkToGrandparent: string,
  grandparentTable: string,
  grandparentPkCol: string,
  cutoffDate: string
): Promise<void> {
  const pgChild = t(childTable);
  const pgParent = t(parentTable);
  const pgGrand = t(grandparentTable);
  const pgFkChild = c(fkToParent);
  const pgParentPk = c(parentPkCol);
  const pgFkParent = c(parentFkToGrandparent);
  const pgGrandPk = c(grandparentPkCol);

  if (!(await tableExists(client, pgChild))) {
    console.log(`  SKIP (table not found): ${pgChild}`);
    return;
  }
  if (!(await tableExists(client, pgParent))) {
    console.log(`  SKIP (parent not found): ${pgParent}`);
    return;
  }
  if (!(await tableExists(client, pgGrand))) {
    console.log(`  SKIP (grandparent not found): ${pgGrand}`);
    return;
  }

  if (!(await columnExists(client, pgChild, pgFkChild))) {
    console.log(`  SKIP (column not found): ${pgChild}.${pgFkChild}`);
    return;
  }
  if (!(await columnExists(client, pgParent, pgFkParent))) {
    console.log(`  SKIP (column not found): ${pgParent}.${pgFkParent}`);
    return;
  }

  await client.query(
    `INSERT INTO archived_user_data
      (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
     SELECT
       $1,
       CAST(c.id AS TEXT),
       NULL,
       g.deleted_at,
       (CURRENT_DATE - g.deleted_at::date),
       row_to_json(c)::TEXT,
       NOW()
     FROM ${pgChild} c
     JOIN ${pgParent} p ON p.${pgParentPk} = c.${pgFkChild}
     JOIN ${pgGrand}  g ON g.${pgGrandPk}  = p.${pgFkParent}
       AND g.deleted_at IS NOT NULL
       AND g.deleted_at <= $2
     WHERE NOT EXISTS (
       SELECT 1 FROM archived_user_data a
       WHERE a.source_table = $1
         AND a.record_id = CAST(c.id AS TEXT)
         AND CAST(a.archived_at AS DATE) = CURRENT_DATE
     )`,
    [pgChild, cutoffDate]
  );

  const deleteResult = await client.query(
    `DELETE FROM ${pgChild} c
     USING ${pgParent} p, ${pgGrand} g
     WHERE p.${pgParentPk} = c.${pgFkChild}
       AND g.${pgGrandPk}  = p.${pgFkParent}
       AND g.deleted_at IS NOT NULL
       AND g.deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgChild} (orphan via ${pgParent}→${pgGrand}): archived & deleted ${deleteResult.rowCount} row(s)`
  );
}

async function nullifyFkColumn(
  client: PoolClient,
  childTable: string,
  fkColumn: string,
  cutoffDate: string
): Promise<void> {
  const pgChild = t(childTable);
  const pgFk = c(fkColumn);

  if (!(await tableExists(client, pgChild))) return;
  if (!(await columnExists(client, pgChild, pgFk))) return;

  const result = await client.query(
    `UPDATE ${pgChild} ch
     SET ${pgFk} = NULL
     FROM users u
     WHERE u.id = ch.${pgFk}
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgChild}.${pgFk} → nullified ${result.rowCount} row(s)`
  );
}

async function archiveAndDeleteByUserFK(
  client: PoolClient,
  tableName: string,
  userFkColumn: string,
  cutoffDate: string
): Promise<void> {
  const pgTable = t(tableName);
  const pgFk = c(userFkColumn);

  if (!(await tableExists(client, pgTable))) {
    console.log(`  SKIP (table not found): ${pgTable}`);
    return;
  }

  await client.query(
    `INSERT INTO archived_user_data
      (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
     SELECT
       $1,
       CAST(ch.id AS TEXT),
       CAST(ch.${pgFk} AS VARCHAR(450)),
       u.deleted_at,
       (CURRENT_DATE - u.deleted_at::date),
       row_to_json(ch)::TEXT,
       NOW()
     FROM ${pgTable} ch
     JOIN users u
       ON u.id = ch.${pgFk}
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at <= $2
     WHERE NOT EXISTS (
       SELECT 1 FROM archived_user_data a
       WHERE a.source_table = $1
         AND a.record_id = CAST(ch.id AS TEXT)
         AND CAST(a.archived_at AS DATE) = CURRENT_DATE
     )`,
    [pgTable, cutoffDate]
  );

  const deleteResult = await client.query(
    `DELETE FROM ${pgTable} ch
     USING users u
     WHERE u.id = ch.${pgFk}
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgTable} (by user FK ${pgFk}): archived & deleted ${deleteResult.rowCount} row(s)`
  );
}

async function archiveAndDeleteCampaignChildByUser(
  client: PoolClient,
  childTable: string,
  campaignFkColumn: string,
  cutoffDate: string
): Promise<void> {
  const pgChild = t(childTable);
  const pgFk = c(campaignFkColumn);

  if (!(await tableExists(client, pgChild))) {
    console.log(`  SKIP (table not found): ${pgChild}`);
    return;
  }

  await client.query(
    `INSERT INTO archived_user_data
      (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
     SELECT
       $1,
       CAST(ch.id AS TEXT),
       NULL,
       u.deleted_at,
       (CURRENT_DATE - u.deleted_at::date),
       row_to_json(ch)::TEXT,
       NOW()
     FROM ${pgChild} ch
     JOIN campaigns cam ON cam.id = ch.${pgFk}
     JOIN users u
       ON u.id = cam.user_id
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at <= $2
     WHERE NOT EXISTS (
       SELECT 1 FROM archived_user_data a
       WHERE a.source_table = $1
         AND a.record_id = CAST(ch.id AS TEXT)
         AND CAST(a.archived_at AS DATE) = CURRENT_DATE
     )`,
    [pgChild, cutoffDate]
  );

  const deleteResult = await client.query(
    `DELETE FROM ${pgChild} ch
     USING campaigns cam, users u
     WHERE cam.id = ch.${pgFk}
       AND u.id = cam.user_id
       AND u.deleted_at IS NOT NULL
       AND u.deleted_at <= $1`,
    [cutoffDate]
  );

  console.log(
    `  ${pgChild} (user-campaign orphan via ${pgFk}): archived & deleted ${deleteResult.rowCount} row(s)`
  );
}

async function ensureArchivedUserDataTable(client: PoolClient): Promise<void> {
  const exists = await tableExists(client, "archived_user_data");
  if (!exists) {
    console.log("[CLEANUP] Creating archived_user_data table...");
    await client.query(`
      CREATE TABLE archived_user_data (
        id SERIAL PRIMARY KEY,
        source_table TEXT NOT NULL,
        record_id TEXT NOT NULL,
        user_id TEXT,
        days_old INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        archived_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    console.log("[CLEANUP] archived_user_data table created.");
  }
}

export async function runDailyCleanup(): Promise<void> {
  const client = await pool.connect();

  try {
    // The default per-connection statement_timeout is 20s (set via
    // connection-string options=). The nightly archive+purge legitimately
    // moves thousands of rows across several tables and can run longer
    // than that. Lift the cap on THIS client only; we restore it in the
    // finally block before the client returns to the scheduler pool so
    // future callers see the standard 20s default again.
    await client.query("SET statement_timeout = '10min'");

    await ensureArchivedUserDataTable(client);

    const configResult = await client.query(
      `SELECT value FROM site_configurations
       WHERE type = 'Configuration'
         AND key = 'Auto Delete Archived Records After (Days)'
         AND (is_deleted = false OR is_deleted IS NULL)
       LIMIT 1`
    );

    if (configResult.rows.length === 0) {
      throw new Error(
        "sp_DailyCleanup: Configuration not found in site_configurations. Aborting."
      );
    }

    const retentionDays = parseInt(configResult.rows[0].value, 10);
    if (isNaN(retentionDays)) {
      throw new Error(
        "sp_DailyCleanup: Invalid retention days value. Aborting."
      );
    }

    const now = new Date();
    const cutoffDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - retentionDays,
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    )).toISOString();

    console.log(`[CLEANUP] Retention days: ${retentionDays}`);
    console.log(`[CLEANUP] Cutoff date: ${cutoffDate}`);
    console.log(`[CLEANUP] Started at: ${new Date().toISOString()}`);

    const backfillTables = [
      "users", "campaigns", "groups", "pending_grants", "pending_grant_notes",
      "disbursal_requests", "disbursal_request_notes", "asset_based_payment_requests",
      "asset_based_payment_request_notes", "form_submissions", "form_submission_notes",
      "investment_notes", "completed_investment_details", "completed_investment_notes",
      "scheduled_email_logs", "account_balance_change_logs", "return_details",
      "recommendations", "user_investments", "investment_requests", "investment_feedbacks",
      "requests", "leader_groups", "group_account_balances", "user_notifications",
      "user_roles", "return_masters", "catacap_teams",
      "email_templates",
    ];

    console.log("[CLEANUP] -- Backfilling missing deleted_at timestamps --");
    for (const tbl of backfillTables) {
      if (!(await tableExists(client, tbl))) continue;
      if (!(await columnExists(client, tbl, "is_deleted"))) continue;
      if (!(await columnExists(client, tbl, "deleted_at"))) continue;

      const hasCreatedAt = await columnExists(client, tbl, "created_at");
      const hasUpdatedAt = await columnExists(client, tbl, "updated_at");

      let fallbackExpr: string;
      if (hasCreatedAt && hasUpdatedAt) {
        fallbackExpr = "COALESCE(created_at, updated_at, NOW())";
      } else if (hasCreatedAt) {
        fallbackExpr = "COALESCE(created_at, NOW())";
      } else if (hasUpdatedAt) {
        fallbackExpr = "COALESCE(updated_at, NOW())";
      } else {
        fallbackExpr = "NOW()";
      }

      const backfillResult = await client.query(
        `UPDATE ${tbl} SET deleted_at = ${fallbackExpr}
         WHERE is_deleted = true AND deleted_at IS NULL`
      );
      if (backfillResult.rowCount && backfillResult.rowCount > 0) {
        console.log(`[CLEANUP]   ${tbl}: backfilled deleted_at on ${backfillResult.rowCount} row(s)`);
      }
    }

    const preflightResult = await client.query(
      `SELECT
         COUNT(*)::int AS total_users,
         COUNT(*) FILTER (WHERE is_deleted = true)::int AS soft_deleted_total,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS has_deleted_at,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_at <= $1)::int AS qualifying
       FROM users`,
      [cutoffDate]
    );
    const { total_users, soft_deleted_total, has_deleted_at, qualifying } = preflightResult.rows[0];
    console.log(`[CLEANUP] -- Users preflight --`);
    console.log(`[CLEANUP]   Total users: ${total_users}`);
    console.log(`[CLEANUP]   Soft-deleted (is_deleted=true): ${soft_deleted_total}`);
    console.log(`[CLEANUP]   With deleted_at set: ${has_deleted_at}`);
    console.log(`[CLEANUP]   Qualifying for deletion (deleted_at <= cutoff): ${qualifying}`);

    if (qualifying === 0) {
      if (soft_deleted_total > 0 && has_deleted_at === 0) {
        console.log("[CLEANUP]   WARNING: Soft-deleted users exist but have no deleted_at timestamp.");
      } else if (has_deleted_at > 0) {
        console.log("[CLEANUP]   Soft-deleted users exist but are within the retention period.");
      }
    }

    const preflightCheckTables = [
      "users", "campaigns", "groups", "pending_grants", "disbursal_requests",
      "asset_based_payment_requests", "form_submissions", "scheduled_email_logs",
      "account_balance_change_logs", "return_details", "recommendations",
      "user_investments", "investment_requests", "investment_feedbacks",
      "requests", "leader_groups", "group_account_balances", "user_notifications",
      "completed_investment_details", "user_roles",
      "email_templates",
    ];

    let totalQualifying = 0;
    console.log(`[CLEANUP] -- Per-table qualifying record counts --`);
    for (const tbl of preflightCheckTables) {
      if (!(await tableExists(client, tbl))) continue;
      if (!(await columnExists(client, tbl, "deleted_at"))) continue;

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM ${tbl}
         WHERE deleted_at IS NOT NULL AND deleted_at <= $1`,
        [cutoffDate]
      );
      const cnt = countResult.rows[0].cnt;
      console.log(`[CLEANUP]   ${tbl}: ${cnt} record(s) qualifying`);
      totalQualifying += cnt;
    }
    console.log(`[CLEANUP] Total qualifying records across all tables: ${totalQualifying}`);

    if (totalQualifying === 0) {
      console.log("[CLEANUP] No records qualify for deletion across any table. Exiting early.");
      return;
    }

    await client.query("BEGIN");

    try {
      console.log("-- LEVEL 5: Leaf tables --");
      await runStep("Level5: PendingGrantNotes orphan", () =>
        archiveAndDeleteOrphan(client, "PendingGrantNotes", "PendingGrantId", "PendingGrants", "Id", cutoffDate));
      await runStep("Level5: DisbursalRequestNotes orphan", () =>
        archiveAndDeleteOrphan(client, "DisbursalRequestNotes", "DisbursalRequestId", "DisbursalRequest", "Id", cutoffDate));
      await runStep("Level5: AssetBasedPaymentRequestNotes orphan", () =>
        archiveAndDeleteOrphan(client, "AssetBasedPaymentRequestNotes", "RequestId", "AssetBasedPaymentRequest", "Id", cutoffDate));
      await runStep("Level5: FormSubmissionNotes orphan", () =>
        archiveAndDeleteOrphan(client, "FormSubmissionNotes", "FormSubmissionId", "FormSubmission", "Id", cutoffDate));
      await runStep("Level5: InvestmentNotes orphan", () =>
        archiveAndDeleteOrphan(client, "InvestmentNotes", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level5: CompletedInvestmentNotes orphan", () =>
        archiveAndDeleteOrphan(client, "CompletedInvestmentNotes", "CompletedInvestmentId", "CompletedInvestmentsDetails", "Id", cutoffDate));
      await runStep("Level5: ACHPaymentRequests orphan", () =>
        archiveAndDeleteOrphan(client, "ACHPaymentRequests", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level5: InvestmentTagMapping orphan", () =>
        archiveAndDeleteOrphan(client, "InvestmentTagMapping", "CampaignId", "Campaigns", "Id", cutoffDate));

      await runStep("Level5: CampaignGroups delete by campaign", async () => {
        const result = await client.query(
          `DELETE FROM campaign_groups cdg
           USING campaigns c
           WHERE c.id = cdg.campaigns_id
             AND c.deleted_at IS NOT NULL
             AND c.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  campaign_groups: deleted ${result.rowCount} row(s)`);
      });

      await runStep("Level5: CampaignGroups delete by group", async () => {
        const byGroup = await client.query(
          `DELETE FROM campaign_groups cdg
           USING groups g
           WHERE g.id = cdg.groups_id
             AND g.deleted_at IS NOT NULL
             AND g.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  campaign_groups (by deleted group): deleted ${byGroup.rowCount} row(s)`);

        const byOwner = await client.query(
          `DELETE FROM campaign_groups cdg
           USING groups g, users u
           WHERE g.id = cdg.groups_id
             AND u.id = g.owner_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  campaign_groups (by group owner user): deleted ${byOwner.rowCount} row(s)`);
      });

      await runStep("Level5: ReturnMasters orphan", () =>
        archiveAndDeleteOrphan(client, "ReturnMasters", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level5: ScheduledEmailLogs", () =>
        archiveAndDelete(client, "ScheduledEmailLogs", "Id", "UserId", cutoffDate));

      await runStep("Level5: EmailTemplate", () =>
        archiveAndDelete(client, "EmailTemplate", "Id", null, cutoffDate));

      console.log("-- LEVEL 4: AccountBalanceChangeLogs (all 3 parent FKs) --");
      await runStep("Level4: AccountBalanceChangeLogs orphan by ABPR", () =>
        archiveAndDeleteOrphan(client, "AccountBalanceChangeLogs", "AssetBasedPaymentRequestId", "AssetBasedPaymentRequest", "Id", cutoffDate));
      await runStep("Level4: AccountBalanceChangeLogs orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "AccountBalanceChangeLogs", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level4: AccountBalanceChangeLogs orphan by PendingGrants", () =>
        archiveAndDeleteOrphan(client, "AccountBalanceChangeLogs", "PendingGrantsId", "PendingGrants", "Id", cutoffDate));
      await runStep("Level4: AccountBalanceChangeLogs self", () =>
        archiveAndDelete(client, "AccountBalanceChangeLogs", "Id", "UserId", cutoffDate));

      await runStep("Level4: CompletedInvestmentsDetails", () =>
        archiveAndDelete(client, "CompletedInvestmentsDetails", "Id", null, cutoffDate));
      await runStep("Level4: ReturnDetails", () =>
        archiveAndDelete(client, "ReturnDetails", "Id", "UserId", cutoffDate));

      console.log("-- LEVEL 3: Mid-level parents --");
      await runStep("Level3: AssetBasedPaymentRequest", () =>
        archiveAndDelete(client, "AssetBasedPaymentRequest", "Id", "UserId", cutoffDate));
      await runStep("Level3: DisbursalRequest", () =>
        archiveAndDelete(client, "DisbursalRequest", "Id", "UserId", cutoffDate));
      await runStep("Level3: PendingGrants", () =>
        archiveAndDelete(client, "PendingGrants", "Id", "UserId", cutoffDate));
      await runStep("Level3: Recommendations", () =>
        archiveAndDelete(client, "Recommendations", "Id", "UserId", cutoffDate));
      await runStep("Level3: UserInvestments", () =>
        archiveAndDelete(client, "UserInvestments", "Id", "UserId", cutoffDate));
      await runStep("Level3: InvestmentRequest", () =>
        archiveAndDelete(client, "InvestmentRequest", "Id", "UserId", cutoffDate));
      await runStep("Level3: InvestmentFeedback", () =>
        archiveAndDelete(client, "InvestmentFeedback", "Id", "UserId", cutoffDate));
      await runStep("Level3: Requests", () =>
        archiveAndDelete(client, "Requests", "Id", "RequestOwnerId", cutoffDate));
      await runStep("Level3: LeaderGroup", () =>
        archiveAndDelete(client, "LeaderGroup", "Id", "UserId", cutoffDate));
      await runStep("Level3: GroupAccountBalance", () =>
        archiveAndDelete(client, "GroupAccountBalance", "Id", "UserId", cutoffDate));
      await runStep("Level3: FormSubmission", () =>
        archiveAndDelete(client, "FormSubmission", "Id", null, cutoffDate));
      await runStep("Level3: UsersNotifications", () =>
        archiveAndDelete(client, "UsersNotifications", "Id", "TargetUserId", cutoffDate));
      await runStep("Level3: AspNetUserRoles", () =>
        archiveAndDelete(client, "AspNetUserRoles", "UserId", "UserId", cutoffDate));

      console.log("-- LEVEL 2.5: Campaign-orphan non-CASCADE children (pre-Level2) --");
      // Children of pending_grants (clean leaves first so the parent delete below succeeds)
      await runStep("Level2.5: PendingGrantNotes orphan via Campaign→PendingGrants", () =>
        archiveAndDeleteOrphanByGrandparent(
          client,
          "PendingGrantNotes", "PendingGrantId",
          "PendingGrants",     "Id",
          "CampaignId",        "Campaigns", "Id",
          cutoffDate
        ));
      await runStep("Level2.5: AccountBalanceChangeLogs orphan via Campaign→PendingGrants", () =>
        archiveAndDeleteOrphanByGrandparent(
          client,
          "AccountBalanceChangeLogs", "PendingGrantsId",
          "PendingGrants",            "Id",
          "CampaignId",               "Campaigns", "Id",
          cutoffDate
        ));
      // pending_grants whose campaign has been purged (donor user may still be alive)
      await runStep("Level2.5: PendingGrants orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "PendingGrants", "CampaignId", "Campaigns", "Id", cutoffDate));

      // completed_investment_details + its notes (parent campaign purged, owner of the row may differ)
      await runStep("Level2.5: CompletedInvestmentNotes orphan via Campaign→CompletedInvestmentsDetails", () =>
        archiveAndDeleteOrphanByGrandparent(
          client,
          "CompletedInvestmentNotes",     "CompletedInvestmentId",
          "CompletedInvestmentsDetails",  "Id",
          "CampaignId",                   "Campaigns", "Id",
          cutoffDate
        ));
      await runStep("Level2.5: CompletedInvestmentsDetails orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "CompletedInvestmentsDetails", "CampaignId", "Campaigns", "Id", cutoffDate));

      // Other direct non-CASCADE children of campaigns whose owning user is independent of the campaign owner
      await runStep("Level2.5: Recommendations orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "Recommendations", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level2.5: UserInvestments orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "UserInvestments", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level2.5: InvestmentRequest orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "InvestmentRequest", "CampaignId", "Campaigns", "Id", cutoffDate));
      await runStep("Level2.5: InvestmentFeedback orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "InvestmentFeedback", "CampaignId", "Campaigns", "Id", cutoffDate));
      // campaign_updates uses a non-CASCADE FK to campaigns; its own children
      // (campaign_update_email_logs, campaign_update_attachments) cascade on
      // delete, so cleaning the parent is sufficient.
      await runStep("Level2.5: campaign_updates orphan by Campaign", () =>
        archiveAndDeleteOrphan(client, "campaign_updates", "campaign_id", "campaigns", "id", cutoffDate));

      console.log("-- LEVEL 2: Top-level domain parents --");
      await runStep("Level2: Groups", () =>
        archiveAndDelete(client, "Groups", "Id", "OwnerId", cutoffDate));
      await runStep("Level2: Campaigns", () =>
        archiveAndDelete(client, "Campaigns", "Id", "UserId", cutoffDate));

      await runStep("Level2: event_links investment orphans", async () => {
        if (!(await tableExists(client, "event_links"))) {
          console.log(`  SKIP (table not found): event_links`);
          return;
        }
        const result = await client.query(
          `DELETE FROM event_links el
           WHERE el.target_type = 'investments'
             AND el.target_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM campaigns c WHERE c.id = el.target_id
             )`
        );
        console.log(`  event_links (investment orphan): deleted ${result.rowCount} row(s)`);
      });

      await runStep("Level2: event_links group orphans", async () => {
        if (!(await tableExists(client, "event_links"))) {
          console.log(`  SKIP (table not found): event_links`);
          return;
        }
        const result = await client.query(
          `DELETE FROM event_links el
           WHERE el.target_type = 'groups'
             AND el.target_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM groups g WHERE g.id = el.target_id
             )`
        );
        console.log(`  event_links (group orphan): deleted ${result.rowCount} row(s)`);
      });

      console.log("-- NULLIFY: Audit FK columns referencing deleted users --");
      await runStep("Nullify: AspNetUsers.DeletedBy", () =>
        nullifyFkColumn(client, "AspNetUsers", "DeletedBy", cutoffDate));

      await runStep("Nullify: Requests.DeletedBy", () =>
        nullifyFkColumn(client, "Requests", "DeletedBy", cutoffDate));
      await runStep("Nullify: Requests.RequestOwnerId", () =>
        nullifyFkColumn(client, "Requests", "RequestOwnerId", cutoffDate));
      await runStep("Nullify: Requests.UserToFollowId", () =>
        nullifyFkColumn(client, "Requests", "UserToFollowId", cutoffDate));

      await runStep("Nullify: AccountBalanceChangeLogs.DeletedBy", () =>
        nullifyFkColumn(client, "AccountBalanceChangeLogs", "DeletedBy", cutoffDate));
      await runStep("Nullify: ApprovedBy.DeletedBy", () =>
        nullifyFkColumn(client, "ApprovedBy", "DeletedBy", cutoffDate));
      await runStep("Nullify: AssetBasedPaymentRequest.DeletedBy", () =>
        nullifyFkColumn(client, "AssetBasedPaymentRequest", "DeletedBy", cutoffDate));
      await runStep("Nullify: AssetBasedPaymentRequest.UpdatedBy", () =>
        nullifyFkColumn(client, "AssetBasedPaymentRequest", "UpdatedBy", cutoffDate));
      await runStep("Nullify: Campaigns.DeletedBy", () =>
        nullifyFkColumn(client, "Campaigns", "DeletedBy", cutoffDate));
      await runStep("Nullify: CataCapTeam.DeletedBy", () =>
        nullifyFkColumn(client, "CataCapTeam", "DeletedBy", cutoffDate));
      await runStep("Nullify: CataCapTeam.CreatedBy", () =>
        nullifyFkColumn(client, "CataCapTeam", "CreatedBy", cutoffDate));
      await runStep("Nullify: CataCapTeam.ModifiedBy", () =>
        nullifyFkColumn(client, "CataCapTeam", "ModifiedBy", cutoffDate));
      await runStep("Nullify: CompletedInvestmentsDetails.DeletedBy", () =>
        nullifyFkColumn(client, "CompletedInvestmentsDetails", "DeletedBy", cutoffDate));
      await runStep("Nullify: DisbursalRequest.DeletedBy", () =>
        nullifyFkColumn(client, "DisbursalRequest", "DeletedBy", cutoffDate));
      await runStep("Nullify: EmailTemplate.DeletedBy", () =>
        nullifyFkColumn(client, "EmailTemplate", "DeletedBy", cutoffDate));
      await runStep("Nullify: Event.DeletedBy", () =>
        nullifyFkColumn(client, "Event", "DeletedBy", cutoffDate));
      await runStep("Nullify: Event.CreatedBy", () =>
        nullifyFkColumn(client, "Event", "CreatedBy", cutoffDate));
      await runStep("Nullify: Event.ModifiedBy", () =>
        nullifyFkColumn(client, "Event", "ModifiedBy", cutoffDate));
      await runStep("Nullify: Faq.DeletedBy", () =>
        nullifyFkColumn(client, "Faq", "DeletedBy", cutoffDate));
      await runStep("Nullify: FormSubmission.DeletedBy", () =>
        nullifyFkColumn(client, "FormSubmission", "DeletedBy", cutoffDate));
      await runStep("Nullify: GroupAccountBalance.DeletedBy", () =>
        nullifyFkColumn(client, "GroupAccountBalance", "DeletedBy", cutoffDate));
      await runStep("Nullify: Groups.DeletedBy", () =>
        nullifyFkColumn(client, "Groups", "DeletedBy", cutoffDate));
      await runStep("Nullify: InvestmentFeedback.DeletedBy", () =>
        nullifyFkColumn(client, "InvestmentFeedback", "DeletedBy", cutoffDate));
      await runStep("Nullify: InvestmentRequest.DeletedBy", () =>
        nullifyFkColumn(client, "InvestmentRequest", "DeletedBy", cutoffDate));
      await runStep("Nullify: InvestmentRequest.ModifiedBy", () =>
        nullifyFkColumn(client, "InvestmentRequest", "ModifiedBy", cutoffDate));
      await runStep("Nullify: InvestmentTag.DeletedBy", () =>
        nullifyFkColumn(client, "InvestmentTag", "DeletedBy", cutoffDate));
      await runStep("Nullify: LeaderGroup.DeletedBy", () =>
        nullifyFkColumn(client, "LeaderGroup", "DeletedBy", cutoffDate));
      await runStep("Nullify: News.DeletedBy", () =>
        nullifyFkColumn(client, "News", "DeletedBy", cutoffDate));
      await runStep("Nullify: PendingGrants.DeletedBy", () =>
        nullifyFkColumn(client, "PendingGrants", "DeletedBy", cutoffDate));
      await runStep("Nullify: PendingGrants.RejectedBy", () =>
        nullifyFkColumn(client, "PendingGrants", "RejectedBy", cutoffDate));
      await runStep("Nullify: Recommendations.DeletedBy", () =>
        nullifyFkColumn(client, "Recommendations", "DeletedBy", cutoffDate));
      await runStep("Nullify: Recommendations.RejectedBy", () =>
        nullifyFkColumn(client, "Recommendations", "RejectedBy", cutoffDate));
      await runStep("Nullify: ReturnDetails.DeletedBy", () =>
        nullifyFkColumn(client, "ReturnDetails", "DeletedBy", cutoffDate));
      await runStep("Nullify: ScheduledEmailLogs.DeletedBy", () =>
        nullifyFkColumn(client, "ScheduledEmailLogs", "DeletedBy", cutoffDate));
      await runStep("Nullify: SiteConfiguration.DeletedBy", () =>
        nullifyFkColumn(client, "SiteConfiguration", "DeletedBy", cutoffDate));
      await runStep("Nullify: Testimonial.DeletedBy", () =>
        nullifyFkColumn(client, "Testimonial", "DeletedBy", cutoffDate));
      await runStep("Nullify: Themes.DeletedBy", () =>
        nullifyFkColumn(client, "Themes", "DeletedBy", cutoffDate));
      await runStep("Nullify: UserInvestments.DeletedBy", () =>
        nullifyFkColumn(client, "UserInvestments", "DeletedBy", cutoffDate));
      await runStep("Nullify: UsersNotifications.DeletedBy", () =>
        nullifyFkColumn(client, "UsersNotifications", "DeletedBy", cutoffDate));

      await runStep("Nullify: AssetBasedPaymentRequestNotes.CreatedBy", () =>
        nullifyFkColumn(client, "AssetBasedPaymentRequestNotes", "CreatedBy", cutoffDate));
      await runStep("Nullify: CompletedInvestmentNotes.CreatedBy", () =>
        nullifyFkColumn(client, "CompletedInvestmentNotes", "CreatedBy", cutoffDate));
      await runStep("Nullify: DisbursalRequestNotes.CreatedBy", () =>
        nullifyFkColumn(client, "DisbursalRequestNotes", "CreatedBy", cutoffDate));
      await runStep("Nullify: FormSubmissionNotes.CreatedBy", () =>
        nullifyFkColumn(client, "FormSubmissionNotes", "CreatedBy", cutoffDate));
      await runStep("Nullify: InvestmentNotes.CreatedBy", () =>
        nullifyFkColumn(client, "InvestmentNotes", "CreatedBy", cutoffDate));
      await runStep("Nullify: PendingGrantNotes.CreatedBy", () =>
        nullifyFkColumn(client, "PendingGrantNotes", "CreatedBy", cutoffDate));

      await runStep("Nullify: ModuleAccessPermission.UpdatedBy", () =>
        nullifyFkColumn(client, "ModuleAccessPermission", "UpdatedBy", cutoffDate));
      await runStep("Nullify: ReturnMasters.CreatedBy", () =>
        nullifyFkColumn(client, "ReturnMasters", "CreatedBy", cutoffDate));

      console.log("-- FK RESOLUTION: Remove non-deleted records blocking user deletion --");

      await runStep("FK-resolve: completed_investment_notes via completed_investment_details→campaigns→users", async () => {
        await client.query(
          `INSERT INTO archived_user_data
            (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
           SELECT
             'completed_investment_notes',
             CAST(cn.id AS TEXT),
             NULL,
             u.deleted_at,
             (CURRENT_DATE - u.deleted_at::date),
             row_to_json(cn)::TEXT,
             NOW()
           FROM completed_investment_notes cn
           JOIN completed_investment_details cid ON cid.id = cn.completed_investment_id
           JOIN campaigns cam ON cam.id = cid.campaign_id
           JOIN users u ON u.id = cam.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1
           WHERE NOT EXISTS (
             SELECT 1 FROM archived_user_data a
             WHERE a.source_table = 'completed_investment_notes'
               AND a.record_id = CAST(cn.id AS TEXT)
               AND CAST(a.archived_at AS DATE) = CURRENT_DATE
           )`,
          [cutoffDate]
        );
        const deleteResult = await client.query(
          `DELETE FROM completed_investment_notes cn
           USING completed_investment_details cid, campaigns cam, users u
           WHERE cid.id = cn.completed_investment_id
             AND cam.id = cid.campaign_id
             AND u.id = cam.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  completed_investment_notes (user-campaign-cid orphan): archived & deleted ${deleteResult.rowCount} row(s)`);
      });

      await runStep("FK-resolve: InvestmentNotes via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "InvestmentNotes", "CampaignId", cutoffDate));
      await runStep("FK-resolve: ACHPaymentRequests via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "ACHPaymentRequests", "CampaignId", cutoffDate));
      await runStep("FK-resolve: InvestmentTagMapping via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "InvestmentTagMapping", "CampaignId", cutoffDate));

      await runStep("FK-resolve: CampaignGroups via user-campaign", async () => {
        const result = await client.query(
          `DELETE FROM campaign_groups cdg
           USING campaigns cam, users u
           WHERE cam.id = cdg.campaigns_id
             AND u.id = cam.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  campaign_groups (user-campaign orphan): deleted ${result.rowCount} row(s)`);
      });

      await runStep("FK-resolve: ReturnMasters via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "ReturnMasters", "CampaignId", cutoffDate));
      await runStep("FK-resolve: CompletedInvestmentsDetails via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "CompletedInvestmentsDetails", "CampaignId", cutoffDate));
      await runStep("FK-resolve: AccountBalanceChangeLogs via user-campaign", () =>
        archiveAndDeleteCampaignChildByUser(client, "AccountBalanceChangeLogs", "CampaignId", cutoffDate));

      await runStep("FK-resolve: AspNetUserRoles by user_id", async () => {
        await client.query(
          `INSERT INTO archived_user_data
            (source_table, record_id, user_id, deleted_at, days_old, record_json, archived_at)
           SELECT
             'user_roles',
             CAST(ur.user_id AS TEXT) || ':' || CAST(ur.role_id AS TEXT),
             CAST(ur.user_id AS VARCHAR(450)),
             u.deleted_at,
             (CURRENT_DATE - u.deleted_at::date),
             row_to_json(ur)::TEXT,
             NOW()
           FROM user_roles ur
           JOIN users u
             ON u.id = ur.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1
           WHERE NOT EXISTS (
             SELECT 1 FROM archived_user_data a
             WHERE a.source_table = 'user_roles'
               AND a.record_id = CAST(ur.user_id AS TEXT) || ':' || CAST(ur.role_id AS TEXT)
               AND CAST(a.archived_at AS DATE) = CURRENT_DATE
           )`,
          [cutoffDate]
        );
        const result = await client.query(
          `DELETE FROM user_roles ur
           USING users u
           WHERE u.id = ur.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  user_roles (by deleted user): archived & deleted ${result.rowCount} row(s)`);
      });

      await runStep("FK-resolve: Campaigns by user_id", () =>
        archiveAndDeleteByUserFK(client, "Campaigns", "UserId", cutoffDate));

      await runStep("FK-resolve: GroupAccountBalance by user_id", () =>
        archiveAndDeleteByUserFK(client, "GroupAccountBalance", "UserId", cutoffDate));

      await runStep("FK-resolve: AssetBasedPaymentRequest by user_id", () =>
        archiveAndDeleteByUserFK(client, "AssetBasedPaymentRequest", "UserId", cutoffDate));
      await runStep("FK-resolve: DisbursalRequest by user_id", () =>
        archiveAndDeleteByUserFK(client, "DisbursalRequest", "UserId", cutoffDate));
      await runStep("FK-resolve: InvestmentFeedback by user_id", () =>
        archiveAndDeleteByUserFK(client, "InvestmentFeedback", "UserId", cutoffDate));
      await runStep("FK-resolve: InvestmentRequest by user_id", () =>
        archiveAndDeleteByUserFK(client, "InvestmentRequest", "UserId", cutoffDate));
      await runStep("FK-resolve: LeaderGroup by user_id", () =>
        archiveAndDeleteByUserFK(client, "LeaderGroup", "UserId", cutoffDate));
      await runStep("FK-resolve: PendingGrants by user_id", () =>
        archiveAndDeleteByUserFK(client, "PendingGrants", "UserId", cutoffDate));
      await runStep("FK-resolve: Recommendations by user_id", () =>
        archiveAndDeleteByUserFK(client, "Recommendations", "UserId", cutoffDate));
      await runStep("FK-resolve: ReturnDetails by user_id", () =>
        archiveAndDeleteByUserFK(client, "ReturnDetails", "UserId", cutoffDate));
      await runStep("FK-resolve: ScheduledEmailLogs by user_id", () =>
        archiveAndDeleteByUserFK(client, "ScheduledEmailLogs", "UserId", cutoffDate));
      await runStep("FK-resolve: Testimonial by user_id", () =>
        archiveAndDeleteByUserFK(client, "Testimonial", "UserId", cutoffDate));
      await runStep("FK-resolve: UserInvestments by user_id", () =>
        archiveAndDeleteByUserFK(client, "UserInvestments", "UserId", cutoffDate));
      await runStep("FK-resolve: UsersNotifications by target_user_id", () =>
        archiveAndDeleteByUserFK(client, "UsersNotifications", "TargetUserId", cutoffDate));

      await runStep("FK-resolve: AspNetUserClaims by user_id", async () => {
        if (!(await tableExists(client, "user_claims"))) {
          console.log(`  SKIP (table not found): user_claims`);
          return;
        }
        const result = await client.query(
          `DELETE FROM user_claims uc
           USING users u
           WHERE u.id = uc.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  user_claims (by deleted user): deleted ${result.rowCount} row(s)`);
      });

      await runStep("FK-resolve: AspNetUserLogins by user_id", async () => {
        if (!(await tableExists(client, "user_logins"))) {
          console.log(`  SKIP (table not found): user_logins`);
          return;
        }
        const result = await client.query(
          `DELETE FROM user_logins ul
           USING users u
           WHERE u.id = ul.user_id
             AND u.deleted_at IS NOT NULL
             AND u.deleted_at <= $1`,
          [cutoffDate]
        );
        console.log(`  user_logins (by deleted user): deleted ${result.rowCount} row(s)`);
      });

      await runStep("Nullify: CompletedInvestmentsDetails.CreatedBy", () =>
        nullifyFkColumn(client, "CompletedInvestmentsDetails", "CreatedBy", cutoffDate));

      console.log("-- LEVEL 1: Root --");
      await runStep("Level1: AspNetUsers", () =>
        archiveAndDelete(client, "AspNetUsers", "Id", "Id", cutoffDate));

      await client.query("COMMIT");
      console.log(`[CLEANUP] Cleanup finished at ${new Date().toISOString()}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    // Restore the per-client default before returning to the pool, so a
    // future scheduler task acquiring this same client doesn't inherit
    // the lifted 10-minute cap.
    try {
      await client.query("SET statement_timeout = '20s'");
    } catch (resetErr) {
      console.warn(
        "[CLEANUP] failed to reset statement_timeout (non-fatal):",
        (resetErr as any)?.message || resetErr,
      );
    }
    client.release();
  }
}
