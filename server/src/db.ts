import pg from "pg";

const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;
const DATE_OID = 1082;
pg.types.setTypeParser(TIMESTAMP_OID, (val: string) => val);
pg.types.setTypeParser(TIMESTAMPTZ_OID, (val: string) => val);
// Plain `date` columns (e.g. events.event_date) must also be returned as raw
// strings. The default pg parser builds a JS Date at midnight UTC, which gets
// JSON-serialized as "...T00:00:00.000Z" and then re-interpreted by the
// browser in local time, causing dates to render one day earlier in any
// westward (negative-offset) timezone like US Eastern.
pg.types.setTypeParser(DATE_OID, (val: string) => val);

// Append `options=-c TimeZone=UTC` to the connection string so Postgres
// applies the session timezone during the startup handshake — *before* the
// first query runs on any new connection. The `pool.on("connect")` listener
// below is fire-and-forget (the pool does not await it), so relying on it
// alone leaves a small race where the first query on a freshly-created
// client could execute before the SET TIME ZONE statement. Setting the
// startup option eliminates that race.
function buildConnectionString(): string | undefined {
  const raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!raw) return raw;
  const tzOption = "-c TimeZone=UTC";
  try {
    const u = new URL(raw);
    const existing = u.searchParams.get("options");
    if (existing == null) {
      u.searchParams.set("options", tzOption);
    } else if (!/(?:^|\s)-c\s*TimeZone=/i.test(existing)) {
      u.searchParams.set("options", `${existing} ${tzOption}`.trim());
    }
    return u.toString();
  } catch {
    // Fall back to naive concatenation for non-URL connection strings.
    if (/(?:[?&])options=/.test(raw)) {
      if (/-c\s*TimeZone=/i.test(raw)) return raw;
      return raw.replace(/(options=)([^&]*)/, (_m, k, v) => `${k}${v}%20${encodeURIComponent(tzOption)}`);
    }
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}options=${encodeURIComponent(tzOption)}`;
  }
}

// Pool sizing: Supabase's Supavisor pooler caps total client connections at
// 15 in session mode (port 5432). The previous `max: 20` setting could
// individually exceed that ceiling and, combined with the scheduler /
// nightly backup / pg_dump / ad-hoc admin overhead, was the root cause of
// `EMAXCONNSESSION ... pool_size: 15` 500s on the admin app. We now cap
// `max` at 10 — burst-heavy pages (Dashboard, Site Configuration, Edit
// Investment) have been batched onto a single pinned client per request,
// so 10 in-flight HTTP queries is plenty while leaving ~5 sessions of
// headroom for schedulers, pg_dump and one-off admin connections.
const pool = new pg.Pool({
  connectionString: buildConnectionString(),
  ssl: { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

// NOTE: We intentionally do NOT register a `pool.on("connect")` listener that
// fires `client.query("SET TIME ZONE 'UTC'")` — the pool does not await the
// listener, so the very first user query on a freshly-created pooled client
// would race against the unawaited SET, producing the
// `Calling client.query() when the client is already executing a query`
// deprecation warning, and on newer `pg` builds the same race surfaces as a
// hard query error (one of the root causes of the intermittent 500s on
// /admin/site-configuration). The session timezone is set during the Postgres
// startup handshake via `options=-c TimeZone=UTC` in `buildConnectionString()`
// above, which runs before the connection is handed to any query.

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

async function runSoftDeleteMigration(client: pg.PoolClient): Promise<void> {
  const tables = [
    "account_balance_change_logs",
    "campaigns",
    "groups",
    "recommendations",
    "themes",
    "users",
  ];

  for (const table of tables) {
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (tableCheck.rows.length === 0) continue;

    await client.query(`
      ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(450)
    `);
  }
}

async function ensureSchedulerTables(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS archived_user_data (
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

  await client.query(`
    CREATE TABLE IF NOT EXISTS scheduler_logs (
      id SERIAL PRIMARY KEY,
      job_name VARCHAR(100),
      start_time TIMESTAMP,
      end_time TIMESTAMP,
      error_message TEXT,
      status VARCHAR(20) DEFAULT 'Success',
      metadata JSONB
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'scheduler_logs' AND column_name = 'status'
      ) THEN
        ALTER TABLE scheduler_logs ADD COLUMN status VARCHAR(20) DEFAULT 'Success';
      END IF;
    END $$;
  `);

  await client.query(`
    ALTER TABLE scheduler_logs
      ADD COLUMN IF NOT EXISTS metadata JSONB
  `);

  await client.query(`
    ALTER TABLE scheduler_logs
      ALTER COLUMN end_time DROP NOT NULL
  `);

  const sel = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'scheduled_email_logs'`,
  );
  if (sel.rows.length > 0) {
    await client.query(
      `ALTER TABLE scheduled_email_logs
         ADD COLUMN IF NOT EXISTS scheduler_log_id INTEGER REFERENCES scheduler_logs(id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_email_logs_scheduler_log_id
         ON scheduled_email_logs(scheduler_log_id)`,
    );
  }

  const wsel = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'welcome_series_email_logs'`,
  );
  if (wsel.rows.length > 0) {
    await client.query(
      `ALTER TABLE welcome_series_email_logs
         ADD COLUMN IF NOT EXISTS scheduler_log_id INTEGER REFERENCES scheduler_logs(id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_welcome_series_email_logs_scheduler_log_id
         ON welcome_series_email_logs(scheduler_log_id)`,
    );
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS scheduler_configurations (
      id SERIAL PRIMARY KEY,
      job_name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      hour INTEGER NOT NULL DEFAULT 0,
      minute INTEGER NOT NULL DEFAULT 0,
      timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
      is_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`
    INSERT INTO scheduler_configurations (job_name, description, hour, minute, timezone, is_enabled)
    VALUES
      ('SendReminderEmail', 'Sends reminder emails to users', 8, 0, 'America/New_York', true),
      ('DeleteArchivedUsers', 'Archives and deletes soft-deleted records past retention period', 2, 0, 'America/New_York', true),
      ('DeleteTestUsers', 'Deletes test user accounts', 18, 0, 'Asia/Kolkata', true),
      ('WelcomeSeries', 'Sends Day 1, Day 6, and Day 10 welcome emails to Learn More form submitters', 9, 0, 'America/New_York', true),
      ('WeeklyKenStats', 'Weekly Friday-noon stats email to Ken (pending grants, donations, investments, distributions)', 12, 0, 'America/Los_Angeles', true),
      ('BackupDatabase', 'Takes a full pg_dump of the database (gzipped) and uploads it to Supabase Storage under database-backups/', 3, 30, 'America/New_York', true)
    ON CONFLICT (job_name) DO NOTHING
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS site_configurations (
      id SERIAL PRIMARY KEY,
      type VARCHAR(100),
      key VARCHAR(255),
      value TEXT,
      is_deleted BOOLEAN DEFAULT false,
      deleted_at TIMESTAMP,
      deleted_by VARCHAR(450)
    )
  `);

  await client.query(`
    INSERT INTO site_configurations (type, key, value)
    SELECT 'Configuration', 'Auto Delete Archived Records After (Days)', '14'
    WHERE NOT EXISTS (
      SELECT 1 FROM site_configurations
      WHERE type = 'Configuration'
        AND key = 'Auto Delete Archived Records After (Days)'
    )
  `);
}

async function backfillSchedulerLogIds(client: pg.PoolClient): Promise<void> {
  const migrationKey = "BackfillSchedulerLogIdsApplied_v2";
  try {
    const check = await client.query(
      `SELECT 1 FROM site_configurations WHERE key = $1 LIMIT 1`,
      [migrationKey],
    );
    if (check.rows.length > 0) return;
  } catch {
    return;
  }

  const selTable = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'scheduled_email_logs'`,
  );
  const selCol = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'scheduled_email_logs' AND column_name = 'scheduler_log_id'`,
  );
  if (selTable.rows.length > 0 && selCol.rows.length > 0) {
    try {
      const result = await client.query(`
        WITH ranked AS (
          SELECT id, job_name, start_time,
                 LEAD(start_time) OVER (PARTITION BY job_name ORDER BY start_time) AS next_start
          FROM scheduler_logs
          WHERE job_name = 'SendReminderEmail'
        )
        UPDATE scheduled_email_logs sel
           SET scheduler_log_id = r.id
          FROM ranked r
         WHERE sel.scheduler_log_id IS NULL
           AND sel.sent_date >= r.start_time
           AND (r.next_start IS NULL OR sel.sent_date < r.next_start)
      `);
      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[BackfillSchedulerLogIds] Linked ${result.rowCount} scheduled_email_logs row(s) to scheduler_logs.`,
        );
      }
    } catch (err) {
      console.error("[BackfillSchedulerLogIds] scheduled_email_logs backfill failed:", err);
    }
  }

  const wselTable = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'welcome_series_email_logs'`,
  );
  const wselCol = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'welcome_series_email_logs' AND column_name = 'scheduler_log_id'`,
  );
  if (wselTable.rows.length > 0 && wselCol.rows.length > 0) {
    try {
      const result = await client.query(`
        WITH ranked AS (
          SELECT id, job_name, start_time,
                 LEAD(start_time) OVER (PARTITION BY job_name ORDER BY start_time) AS next_start
          FROM scheduler_logs
          WHERE job_name = 'WelcomeSeries'
        )
        UPDATE welcome_series_email_logs wsel
           SET scheduler_log_id = r.id
          FROM ranked r
         WHERE wsel.scheduler_log_id IS NULL
           AND wsel.sent_at >= r.start_time
           AND (r.next_start IS NULL OR wsel.sent_at < r.next_start)
      `);
      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[BackfillSchedulerLogIds] Linked ${result.rowCount} welcome_series_email_logs row(s) to scheduler_logs.`,
        );
      }
    } catch (err) {
      console.error("[BackfillSchedulerLogIds] welcome_series_email_logs backfill failed:", err);
    }
  }

  try {
    await client.query(
      `INSERT INTO site_configurations (type, key, value)
       VALUES ('Migration', $1, 'true')
       ON CONFLICT DO NOTHING`,
      [migrationKey],
    );
  } catch {}
}

async function backfillSoftDeleteTimestamps(
  client: pg.PoolClient,
): Promise<void> {
  const tables = [
    "account_balance_change_logs",
    "campaigns",
    "groups",
    "recommendations",
    "themes",
    "users",
  ];

  for (const table of tables) {
    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (tableCheck.rows.length === 0) continue;

    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'is_deleted'`,
      [table],
    );
    if (colCheck.rows.length === 0) continue;

    const delAtCheck = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'deleted_at'`,
      [table],
    );
    if (delAtCheck.rows.length === 0) continue;

    const result = await client.query(
      `UPDATE ${table} SET deleted_at = NOW() - INTERVAL '30 days'
       WHERE is_deleted = true AND deleted_at IS NULL`,
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(
        `Backfilled deleted_at for ${result.rowCount} soft-deleted row(s) in ${table} (set to 30 days ago).`,
      );
    }
  }
}

async function fixIncorrectBackfillDates(client: pg.PoolClient): Promise<void> {
  const migrationKey = "BackfillDeletedAtFixV2Applied";
  try {
    const check = await client.query(
      `SELECT 1 FROM site_configurations WHERE key = $1 LIMIT 1`,
      [migrationKey],
    );
    if (check.rows.length > 0) return;
  } catch {
    return;
  }

  const tables = [
    "account_balance_change_logs",
    "campaigns",
    "groups",
    "recommendations",
    "themes",
    "users",
  ];

  for (const table of tables) {
    try {
      const result = await client.query(
        `UPDATE ${table} SET deleted_at = NOW() - INTERVAL '30 days'
         WHERE is_deleted = true
           AND (deleted_at IS NULL OR deleted_at > NOW() - INTERVAL '30 days')`,
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[BackfillV2] Set deleted_at to 30 days ago for ${result.rowCount} row(s) in ${table}.`,
        );
      }
    } catch {}
  }

  try {
    await client.query(
      `INSERT INTO site_configurations (type, key, value)
       VALUES ('Migration', $1, 'true')
       ON CONFLICT DO NOTHING`,
      [migrationKey],
    );
  } catch {}
}

async function ensureInvestmentInstruments(
  client: pg.PoolClient,
): Promise<void> {
  // The product previously called this concept "Investment Types" and the
  // schema used `investment_types` (table) and `campaigns.investment_types`
  // (column). The canonical name is now `investment_instruments`. This
  // helper reconciles any DB to the new naming without losing data.
  //
  // Strategy:
  //  - If the new name is missing and the old name exists -> RENAME (preserves data).
  //  - If both are missing entirely -> create empty so the API endpoints don't 500.
  //  - If the new name already exists -> nothing to do.

  const campaignsExists = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'campaigns'`,
  );
  if (campaignsExists.rows.length === 0) {
    return;
  }

  // 1) Lookup table reconciliation
  const newTable = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'investment_instruments'`,
  );
  const oldTable = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'investment_types'`,
  );

  if (newTable.rows.length === 0 && oldTable.rows.length > 0) {
    await client.query(
      `ALTER TABLE investment_types RENAME TO investment_instruments`,
    );
    console.log(
      "Renamed lookup table investment_types -> investment_instruments.",
    );
  } else if (newTable.rows.length === 0 && oldTable.rows.length === 0) {
    await client.query(`
      CREATE TABLE investment_instruments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    console.log("Created empty investment_instruments lookup table.");
  } else if (newTable.rows.length > 0 && oldTable.rows.length > 0) {
    // Both exist — recover from a partial/aborted prior migration.
    const newCount = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM investment_instruments`,
    );
    const oldCount = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM investment_types`,
    );
    if (newCount.rows[0].cnt === 0 && oldCount.rows[0].cnt > 0) {
      await client.query(`DROP TABLE investment_instruments`);
      await client.query(
        `ALTER TABLE investment_types RENAME TO investment_instruments`,
      );
      console.log(
        "Reconciled dual lookup tables: dropped empty investment_instruments and renamed investment_types -> investment_instruments.",
      );
    } else if (oldCount.rows[0].cnt === 0) {
      await client.query(`DROP TABLE investment_types`);
      console.log("Dropped empty legacy investment_types table.");
    } else {
      console.warn(
        `Both investment_instruments (${newCount.rows[0].cnt} rows) and investment_types (${oldCount.rows[0].cnt} rows) contain data. Manual reconciliation required.`,
      );
    }
  }

  // 2) Campaign column reconciliation
  const newCol = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'campaigns'
        AND column_name = 'investment_instruments'`,
  );
  const oldCol = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'campaigns'
        AND column_name = 'investment_types'`,
  );

  if (newCol.rows.length === 0 && oldCol.rows.length > 0) {
    await client.query(
      `ALTER TABLE campaigns RENAME COLUMN investment_types TO investment_instruments`,
    );
    console.log(
      "Renamed column campaigns.investment_types -> campaigns.investment_instruments.",
    );
  } else if (newCol.rows.length === 0 && oldCol.rows.length === 0) {
    await client.query(
      `ALTER TABLE campaigns ADD COLUMN investment_instruments TEXT`,
    );
    console.log("Added empty campaigns.investment_instruments column.");
  } else if (newCol.rows.length > 0 && oldCol.rows.length > 0) {
    const newFilled = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM campaigns
        WHERE investment_instruments IS NOT NULL AND investment_instruments <> ''`,
    );
    const oldFilled = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM campaigns
        WHERE investment_types IS NOT NULL AND investment_types <> ''`,
    );
    if (newFilled.rows[0].cnt === 0 && oldFilled.rows[0].cnt > 0) {
      await client.query(
        `ALTER TABLE campaigns DROP COLUMN investment_instruments`,
      );
      await client.query(
        `ALTER TABLE campaigns RENAME COLUMN investment_types TO investment_instruments`,
      );
      console.log(
        "Reconciled dual campaign columns: dropped empty investment_instruments and renamed investment_types -> investment_instruments.",
      );
    } else if (oldFilled.rows[0].cnt === 0) {
      await client.query(
        `ALTER TABLE campaigns DROP COLUMN investment_types`,
      );
      console.log("Dropped empty legacy campaigns.investment_types column.");
    } else {
      console.warn(
        `Both campaigns.investment_instruments (${newFilled.rows[0].cnt} rows) and campaigns.investment_types (${oldFilled.rows[0].cnt} rows) contain data. Manual reconciliation required.`,
      );
    }
  }
}

async function ensureCampaignsOwnerGroupColumns(
  client: pg.PoolClient,
): Promise<void> {
  try {
    await client.query(`
      ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS owner_group_id        INTEGER,
        ADD COLUMN IF NOT EXISTS auto_enroll_investors BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'campaigns'
            AND constraint_name = 'campaigns_owner_group_id_fkey'
        ) THEN
          ALTER TABLE campaigns
            ADD CONSTRAINT campaigns_owner_group_id_fkey
            FOREIGN KEY (owner_group_id) REFERENCES groups(id);
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_owner_group_id
        ON campaigns (owner_group_id)
        WHERE owner_group_id IS NOT NULL
    `);
  } catch (err: any) {
    console.warn(
      "ensureCampaignsOwnerGroupColumns: could not ensure owner_group columns:",
      err?.message || err,
    );
  }
}

async function ensureInvestmentNotificationRecipientsTable(
  client: pg.PoolClient,
): Promise<void> {
  // Per-campaign list of {name, email} pairs that receive an email
  // when someone invests in the campaign. See migration
  // releases/30_04_2026/migrations/2026_04_30_campaign_investment_notification_recipients.sql
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_investment_notification_recipients (
        id          SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        name        TEXT NOT NULL DEFAULT '',
        email       TEXT NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'campaign_investment_notification_recipients'
            AND constraint_name = 'campaign_investment_notification_recipients_campaign_id_fkey'
        ) THEN
          ALTER TABLE campaign_investment_notification_recipients
            ADD CONSTRAINT campaign_investment_notification_recipients_campaign_id_fkey
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cinr_campaign_id
        ON campaign_investment_notification_recipients (campaign_id)
    `);
  } catch (err: any) {
    console.warn(
      "ensureInvestmentNotificationRecipientsTable: could not ensure table:",
      err?.message || err,
    );
  }
}

async function ensureAdminPerformanceIndexes(
  client: pg.PoolClient,
): Promise<void> {
  // Adds B-tree / expression indexes that back the most frequent admin
  // queries (Investments list, Users list, Groups list, Pending Grants list,
  // Dashboard, Consolidated Finances). All statements are
  // CREATE INDEX IF NOT EXISTS so this is safe to run on every startup.
  // We only create an index when the underlying table actually exists so a
  // partial deployment doesn't break startup.
  const indexes: Array<{ table: string; name: string; ddl: string }> = [
    // recommendations: aggregated by campaign_id and joined on lower(user_email)
    { table: "recommendations", name: "idx_recommendations_campaign_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_recommendations_campaign_id ON recommendations (campaign_id)` },
    { table: "recommendations", name: "idx_recommendations_lower_email",
      ddl: `CREATE INDEX IF NOT EXISTS idx_recommendations_lower_email ON recommendations (LOWER(user_email))` },
    { table: "recommendations", name: "idx_recommendations_status",
      ddl: `CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations (status)` },

    // users: joined via lower(email) in dashboard, finance, top-donors etc.
    { table: "users", name: "idx_users_lower_email",
      ddl: `CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email))` },

    // user_roles: joined on both sides in nearly every admin query
    { table: "user_roles", name: "idx_user_roles_role_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id)` },
    { table: "user_roles", name: "idx_user_roles_user_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id)` },

    // requests: lookups by group and by owner (Users list filter, Groups members)
    { table: "requests", name: "idx_requests_group_status",
      ddl: `CREATE INDEX IF NOT EXISTS idx_requests_group_status ON requests (group_to_follow_id, status)` },
    { table: "requests", name: "idx_requests_owner",
      ddl: `CREATE INDEX IF NOT EXISTS idx_requests_owner ON requests (request_owner_id)` },

    // pending_grants and notes
    { table: "pending_grants", name: "idx_pending_grants_user_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_pending_grants_user_id ON pending_grants (user_id)` },
    { table: "pending_grants", name: "idx_pending_grants_campaign_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_pending_grants_campaign_id ON pending_grants (campaign_id)` },
    { table: "pending_grant_notes", name: "idx_pending_grant_notes_grant_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_pending_grant_notes_grant_id ON pending_grant_notes (pending_grant_id)` },

    // investment_notes
    { table: "investment_notes", name: "idx_investment_notes_campaign_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_investment_notes_campaign_id ON investment_notes (campaign_id)` },

    // account_balance_change_logs and group_account_balances
    { table: "account_balance_change_logs", name: "idx_acl_user_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_acl_user_id ON account_balance_change_logs (user_id)` },
    { table: "account_balance_change_logs", name: "idx_acl_group_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_acl_group_id ON account_balance_change_logs (group_id)` },
    { table: "group_account_balances", name: "idx_gab_user_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_gab_user_id ON group_account_balances (user_id)` },
    { table: "group_account_balances", name: "idx_gab_group_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_gab_group_id ON group_account_balances (group_id)` },

    // campaign_groups (join membership table; PK already covers (campaigns_id, groups_id))
    { table: "campaign_groups", name: "idx_campaign_groups_groups_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_campaign_groups_groups_id ON campaign_groups (groups_id)` },

    // campaigns: deleted_by lookup join, group_for_private_access_id used in groups list UNION
    { table: "campaigns", name: "idx_campaigns_deleted_by",
      ddl: `CREATE INDEX IF NOT EXISTS idx_campaigns_deleted_by ON campaigns (deleted_by)` },
    { table: "campaigns", name: "idx_campaigns_private_access_group",
      ddl: `CREATE INDEX IF NOT EXISTS idx_campaigns_private_access_group ON campaigns (group_for_private_access_id)` },

    // groups: owner_id IN (...) lookup in finance.ts getFinancesData
    { table: "groups", name: "idx_groups_owner_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups (owner_id)` },

    // asset_based_payment_requests: filtered by user_id IN (...) in finance.ts
    { table: "asset_based_payment_requests", name: "idx_asset_based_payment_requests_user_id",
      ddl: `CREATE INDEX IF NOT EXISTS idx_asset_based_payment_requests_user_id ON asset_based_payment_requests (user_id)` },
  ];

  let created = 0;
  for (const idx of indexes) {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1`,
      [idx.table],
    );
    if (exists.rows.length === 0) continue;
    const before = await client.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`,
      [idx.name],
    );
    if (before.rows.length > 0) continue;
    try {
      await client.query(idx.ddl);
      created++;
    } catch (err) {
      console.warn(
        `Could not create index ${idx.name}: ${(err as Error).message}`,
      );
    }
  }
  if (created > 0) {
    console.log(`Created ${created} admin performance indexes.`);
  }
}

async function backfillOrphanedUserRoles(client: pg.PoolClient): Promise<void> {
  const roleCheck = await client.query(
    `SELECT id FROM roles WHERE name = 'User' LIMIT 1`,
  );
  if (roleCheck.rows.length > 0) {
    const userRoleId = roleCheck.rows[0].id;
    const result = await client.query(
      `INSERT INTO user_roles (user_id, role_id, discriminator, is_deleted)
       SELECT u.id, $1, 'IdentityUserRole<string>', false
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       WHERE ur.user_id IS NULL
       ON CONFLICT DO NOTHING`,
      [userRoleId],
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(
        `Backfilled user_roles for ${result.rowCount} orphaned user(s).`,
      );
    }
  }

  const updateResult = await client.query(
    `UPDATE users
     SET is_active = COALESCE(is_active, true),
         date_created = COALESCE(date_created, NOW())
     WHERE is_active IS NULL OR date_created IS NULL`,
  );
  if (updateResult.rowCount && updateResult.rowCount > 0) {
    console.log(
      `Backfilled is_active/date_created for ${updateResult.rowCount} user(s).`,
    );
  }
}

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log("Database connection established.");

    const tableCheck = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')",
    );
    if (tableCheck.rows[0].exists) {
      const result = await client.query("SELECT COUNT(*) FROM users");
      console.log(`Users table found with ${result.rows[0].count} rows.`);
    } else {
      console.warn(
        "Warning: 'users' table not found. Auth endpoints will not work until the schema is deployed.",
      );
    }

    try {
      await client.query("SET statement_timeout = '3s'");
    } catch (err) {
      console.warn("[migration] failed to apply statement_timeout (non-fatal):", err);
    }

    const steps: [string, () => Promise<void>][] = [
      ["runSoftDeleteMigration", () => runSoftDeleteMigration(client)],
      ["ensureSchedulerTables", () => ensureSchedulerTables(client)],
      ["ensureNoteAttachmentsTables", () => ensureNoteAttachmentsTables(client)],
      ["ensureCampaignUpdateExtras", () => ensureCampaignUpdateExtras(client)],
      ["ensureInvestmentInstruments", () => ensureInvestmentInstruments(client)],
      ["ensureAdminPerformanceIndexes", () => ensureAdminPerformanceIndexes(client)],
      ["ensureCampaignsOwnerGroupColumns", () => ensureCampaignsOwnerGroupColumns(client)],
      ["ensureInvestmentNotificationRecipientsTable", () => ensureInvestmentNotificationRecipientsTable(client)],
      ["ensureSchemaChangeLogTable", () => ensureSchemaChangeLogTable(client)],
      ["ensureDbSchemaLogsModule", () => ensureDbSchemaLogsModule(client)],
      ["backfillSchedulerLogIds", () => backfillSchedulerLogIds(client)],
      ["backfillSoftDeleteTimestamps", () => backfillSoftDeleteTimestamps(client)],
      ["fixIncorrectBackfillDates", () => fixIncorrectBackfillDates(client)],
      ["backfillOrphanedUserRoles", () => backfillOrphanedUserRoles(client)],
    ];

    for (const [name, fn] of steps) {
      try {
        await fn();
      } catch (err) {
        console.warn(`[migration] ${name} failed (non-fatal):`, err);
      }
    }

  } finally {
    // Always reset statement_timeout before returning the client to the pool —
    // otherwise a 3s cap could leak onto a long-running query that picks up
    // this same pooled client later.
    try {
      await client.query("SET statement_timeout = '0'");
    } catch (err) {
      console.warn("[migration] failed to reset statement_timeout (non-fatal):", err);
    }
    client.release();
  }
}

async function ensureSchemaChangeLogTable(client: pg.PoolClient): Promise<void> {
  // Mirrors releases/02_05_2026/migrations/2026_05_02_schema_change_logs.sql
  // so fresh environments self-heal on first boot.
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_change_logs (
        id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        operation_type   text        NOT NULL,
        table_name       text        NOT NULL,
        column_name      text,
        old_definition   jsonb,
        new_definition   jsonb,
        executed_sql     text        NOT NULL,
        rollback_sql     text,
        triggered_by     text        NOT NULL DEFAULT 'ai_prompt',
        prompt_reference text,
        status           text        NOT NULL DEFAULT 'applied',
        created_at       timestamptz NOT NULL DEFAULT now(),
        rolled_back_at   timestamptz,
        rolled_back_by   text,
        CONSTRAINT schema_change_logs_status_chk
          CHECK (status IN ('applied','rolled_back','failed'))
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS schema_change_logs_created_at_idx
         ON public.schema_change_logs (created_at DESC)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS schema_change_logs_status_idx
         ON public.schema_change_logs (status)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS schema_change_logs_table_name_idx
         ON public.schema_change_logs (table_name)`,
    );
    await client.query(`
      CREATE OR REPLACE FUNCTION public.apply_schema_change(payload jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      AS $function$
      DECLARE
          v_id        uuid := gen_random_uuid();
          v_op        text;
          v_table     text;
          v_column    text;
          v_sql       text;
          v_rollback  text;
          v_trigger   text;
          v_ref       text;
          v_force     boolean;
          v_old_def   jsonb;
          v_new_def   jsonb;
          v_warnings  jsonb := '[]'::jsonb;
      BEGIN
          IF payload IS NULL THEN
              RAISE EXCEPTION 'apply_schema_change: payload is required';
          END IF;
          v_op       := upper(NULLIF(trim(payload->>'operation_type'), ''));
          v_table    := NULLIF(trim(payload->>'table_name'), '');
          v_column   := NULLIF(trim(payload->>'column_name'), '');
          v_sql      := payload->>'executed_sql';
          v_rollback := NULLIF(trim(payload->>'rollback_sql'), '');
          v_trigger  := COALESCE(NULLIF(trim(payload->>'triggered_by'), ''), 'ai_prompt');
          v_ref      := NULLIF(trim(payload->>'prompt_reference'), '');
          v_force    := COALESCE((payload->>'force_destructive')::boolean, false);
          IF v_op    IS NULL THEN RAISE EXCEPTION 'apply_schema_change: operation_type is required'; END IF;
          IF v_sql   IS NULL OR length(trim(v_sql)) = 0 THEN
              RAISE EXCEPTION 'apply_schema_change: executed_sql is required';
          END IF;
          IF v_table IS NULL THEN RAISE EXCEPTION 'apply_schema_change: table_name is required'; END IF;

          IF v_op IN ('DROP TABLE','DROP COLUMN','DROP INDEX','DROP CONSTRAINT','TRUNCATE','RENAME')
             OR v_op LIKE 'DROP %'
             OR v_sql ~* '\\m(drop\\s+(table|column|index|constraint|view|schema|function|trigger))\\M'
             OR v_sql ~* '\\m(truncate)\\s+(table\\s+)?[A-Za-z_]'
             OR v_sql ~* '\\malter\\s+table\\s+[^;]+\\s+rename\\M'
             OR v_sql ~* '\\malter\\s+table\\s+[^;]+\\s+drop\\s+default\\M'
          THEN
              IF NOT v_force THEN
                  RAISE EXCEPTION 'apply_schema_change: destructive operation (%) on % requires force_destructive=true in payload',
                      v_op, v_table;
              END IF;
              v_warnings := v_warnings || jsonb_build_array(
                  jsonb_build_object('level','warning',
                    'message', format('Destructive operation %s applied to %s', v_op, v_table)));
              RAISE WARNING 'apply_schema_change: destructive % on % (change_id=%)', v_op, v_table, v_id;
          END IF;

          IF v_column IS NOT NULL THEN
              SELECT to_jsonb(c) || jsonb_build_object('pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod))
                INTO v_old_def
              FROM information_schema.columns c
              JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
              JOIN pg_catalog.pg_class     cl ON cl.relname=c.table_name AND cl.relnamespace=n.oid
              JOIN pg_catalog.pg_attribute a  ON a.attrelid=cl.oid AND a.attname=c.column_name AND NOT a.attisdropped
              WHERE c.table_schema='public' AND c.table_name=v_table AND c.column_name=v_column;
          ELSE
              SELECT jsonb_agg(
                       to_jsonb(c) || jsonb_build_object('pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod))
                       ORDER BY c.ordinal_position
                     )
                INTO v_old_def
              FROM information_schema.columns c
              JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
              JOIN pg_catalog.pg_class     cl ON cl.relname=c.table_name AND cl.relnamespace=n.oid
              JOIN pg_catalog.pg_attribute a  ON a.attrelid=cl.oid AND a.attname=c.column_name AND NOT a.attisdropped
              WHERE c.table_schema='public' AND c.table_name=v_table;
          END IF;

          IF v_rollback IS NULL THEN
              IF v_op = 'CREATE TABLE' THEN
                  v_rollback := format('DROP TABLE IF EXISTS %I.%I CASCADE;', 'public', v_table);
              ELSIF v_op = 'ADD COLUMN' AND v_column IS NOT NULL THEN
                  v_rollback := format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I;', 'public', v_table, v_column);
              ELSIF v_op = 'DROP COLUMN' AND v_column IS NOT NULL AND v_old_def IS NOT NULL THEN
                  v_rollback := format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I %s%s%s;',
                      'public', v_table, v_column,
                      COALESCE(v_old_def->>'pg_type_def', v_old_def->>'data_type','text'),
                      CASE WHEN (v_old_def->>'is_nullable')='NO' THEN ' NOT NULL' ELSE '' END,
                      CASE WHEN v_old_def->>'column_default' IS NOT NULL
                           THEN ' DEFAULT ' || (v_old_def->>'column_default') ELSE '' END);
              ELSIF v_op = 'ALTER COLUMN' AND v_column IS NOT NULL AND v_old_def IS NOT NULL THEN
                  v_rollback := format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE %s%s%s;',
                      'public', v_table, v_column,
                      COALESCE(v_old_def->>'pg_type_def', v_old_def->>'data_type','text'),
                      CASE WHEN (v_old_def->>'is_nullable')='NO'
                           THEN format(', ALTER COLUMN %I SET NOT NULL', v_column)
                           ELSE format(', ALTER COLUMN %I DROP NOT NULL', v_column) END,
                      CASE WHEN v_old_def->>'column_default' IS NOT NULL
                           THEN format(', ALTER COLUMN %I SET DEFAULT %s', v_column, v_old_def->>'column_default')
                           ELSE format(', ALTER COLUMN %I DROP DEFAULT', v_column) END);
              ELSIF v_op IN ('DROP TABLE','DROP INDEX') THEN
                  v_rollback := NULL;
                  v_warnings := v_warnings || jsonb_build_array(
                      jsonb_build_object('level','warning',
                        'message', format('No automatic rollback for %s. Provide rollback_sql in payload.', v_op)));
              END IF;
          END IF;

          EXECUTE v_sql;

          IF v_column IS NOT NULL THEN
              SELECT to_jsonb(c) || jsonb_build_object('pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod))
                INTO v_new_def
              FROM information_schema.columns c
              JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
              JOIN pg_catalog.pg_class     cl ON cl.relname=c.table_name AND cl.relnamespace=n.oid
              JOIN pg_catalog.pg_attribute a  ON a.attrelid=cl.oid AND a.attname=c.column_name AND NOT a.attisdropped
              WHERE c.table_schema='public' AND c.table_name=v_table AND c.column_name=v_column;
          ELSE
              SELECT jsonb_agg(
                       to_jsonb(c) || jsonb_build_object('pg_type_def', pg_catalog.format_type(a.atttypid, a.atttypmod))
                       ORDER BY c.ordinal_position
                     )
                INTO v_new_def
              FROM information_schema.columns c
              JOIN pg_catalog.pg_namespace n ON n.nspname=c.table_schema
              JOIN pg_catalog.pg_class     cl ON cl.relname=c.table_name AND cl.relnamespace=n.oid
              JOIN pg_catalog.pg_attribute a  ON a.attrelid=cl.oid AND a.attname=c.column_name AND NOT a.attisdropped
              WHERE c.table_schema='public' AND c.table_name=v_table;
          END IF;

          INSERT INTO public.schema_change_logs(
              id, operation_type, table_name, column_name,
              old_definition, new_definition, executed_sql, rollback_sql,
              triggered_by, prompt_reference, status)
          VALUES (v_id, v_op, v_table, v_column,
              v_old_def, v_new_def, v_sql, v_rollback,
              v_trigger, v_ref, 'applied');

          RETURN jsonb_build_object(
              'success', true,
              'change_id', v_id,
              'rollback_available', v_rollback IS NOT NULL AND length(trim(v_rollback)) > 0,
              'warnings', v_warnings);
      END;
      $function$
    `);
    console.log("[migration] schema_change_logs + apply_schema_change ready.");
  } catch (e) {
    console.warn("ensureSchemaChangeLogTable: could not ensure table/function:", e);
  }
}

async function ensureDbSchemaLogsModule(client: pg.PoolClient): Promise<void> {
  // Mirrors releases/02_05_2026/migrations/2026_05_02_add_db_schema_logs_module.sql
  // so fresh environments self-heal: the /db-schema-logs page cannot be granted
  // through the Roles & Permissions UI until this row exists in public.modules.
  try {
    const exists = await client.query(
      `SELECT 1 FROM public.modules WHERE name = 'db-schema-logs' LIMIT 1`,
    );
    if (exists.rows.length === 0) {
      await client.query(
        `INSERT INTO public.modules (name, category, sort_order, created_at)
         VALUES ('db-schema-logs', 'site-config', 24, now())`,
      );
      console.log("[migration] modules: inserted 'db-schema-logs' row.");
    }
  } catch (e) {
    console.warn("ensureDbSchemaLogsModule: could not ensure module row:", e);
  }
}

async function ensureNoteAttachmentsTables(client: pg.PoolClient): Promise<void> {
  const pgnExists = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'pending_grant_notes'`,
  );
  if (pgnExists.rows.length > 0) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_grant_note_attachments (
        id SERIAL PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES pending_grant_notes(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT,
        size_bytes BIGINT,
        uploaded_at TIMESTAMP DEFAULT NOW(),
        uploaded_by VARCHAR(450)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_grant_note_attachments_note_id
        ON pending_grant_note_attachments(note_id)
    `);
  }

  const abprnExists = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'asset_based_payment_request_notes'`,
  );
  if (abprnExists.rows.length > 0) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS asset_based_payment_request_note_attachments (
        id SERIAL PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES asset_based_payment_request_notes(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT,
        size_bytes BIGINT,
        uploaded_at TIMESTAMP DEFAULT NOW(),
        uploaded_by VARCHAR(450)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_asset_based_payment_request_note_attachments_note_id
        ON asset_based_payment_request_note_attachments(note_id)
    `);
  }
}

async function ensureCampaignUpdateExtras(client: pg.PoolClient): Promise<void> {
  const cuExists = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'campaign_updates'`,
  );
  if (cuExists.rows.length === 0) return;

  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_update_email_logs (
      id                 SERIAL PRIMARY KEY,
      campaign_update_id INTEGER NOT NULL REFERENCES campaign_updates(id) ON DELETE CASCADE,
      campaign_id        INTEGER NOT NULL,
      sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_by_user_id    VARCHAR(450),
      recipient_count    INTEGER NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_update_email_logs_update_id
      ON campaign_update_email_logs (campaign_update_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_update_email_logs_campaign_id
      ON campaign_update_email_logs (campaign_id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS campaign_update_attachments (
      id                 SERIAL PRIMARY KEY,
      campaign_update_id INTEGER NOT NULL REFERENCES campaign_updates(id) ON DELETE CASCADE,
      file_path          TEXT NOT NULL,
      file_name          TEXT,
      mime_type          TEXT,
      size_bytes         BIGINT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_campaign_update_attachments_update_id
      ON campaign_update_attachments (campaign_update_id)
  `);

  // Up to three free-form { label, value } pairs entered by an admin
  // in the New / Edit Update modal. NULL = no highlights; otherwise a
  // JSON array of three objects (unused rows are stored as
  // { "label": "", "value": "" } so slot ordering is stable).
  // Migration: releases/2026_04_30/migrations/2026_04_30_campaign_update_impact_highlights.sql
  await client.query(`
    ALTER TABLE campaign_updates
      ADD COLUMN IF NOT EXISTS impact_highlights JSONB
  `);

  // Tag user_notifications rows produced by Investment Update fan-outs
  // with the originating campaign_update_id. Nullable for back-compat
  // with all other notification sources, and for legacy update
  // notifications inserted before this column existed.
  await client.query(`
    ALTER TABLE user_notifications
      ADD COLUMN IF NOT EXISTS campaign_update_id INTEGER
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_notifications_campaign_update_id
      ON user_notifications (target_user_id, campaign_update_id)
      WHERE campaign_update_id IS NOT NULL
  `);

  // Backfill the new attachments table from the legacy single-attachment
  // columns so existing updates keep their files when the UI / email
  // sender switches over. Gated on NOT EXISTS so we never duplicate.
  await client.query(`
    INSERT INTO campaign_update_attachments (
      campaign_update_id, file_path, file_name, mime_type, size_bytes, sort_order, created_at
    )
    SELECT
      cu.id,
      cu.attach_file,
      COALESCE(NULLIF(TRIM(cu.attach_file_name), ''),
               regexp_replace(cu.attach_file, '^.*/', '')),
      NULL::TEXT,
      NULL::BIGINT,
      0,
      COALESCE(cu.created_at, NOW())
    FROM campaign_updates cu
    WHERE cu.attach_file IS NOT NULL
      AND TRIM(cu.attach_file) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM campaign_update_attachments cua
         WHERE cua.campaign_update_id = cu.id
      )
  `);

  const verify = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM campaign_update_email_logs)   AS log_rows,
      (SELECT COUNT(*) FROM campaign_update_attachments)  AS attach_rows
  `);
  const v = verify.rows[0];
  console.log(
    `[migration] campaign_update_email_logs ready (${v.log_rows} rows), ` +
      `campaign_update_attachments ready (${v.attach_rows} rows).`
  );
}

export default pool;
