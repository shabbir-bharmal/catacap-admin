# CataCap Admin Frontend

This application is a React 18 + TypeScript admin panel for managing investments, users, disbursal requests, and site configuration for the CataCap platform.

## Run & Operate

- **Start application:** `pnpm run dev` (runs both Express server on port 8200 and Vite dev server on port 5000)
- **Build command:** `pnpm run build` (Vite builds frontend to `dist/`)
- **Run command (production):** `pnpm run start` (runs Express server)
- **Required Env Vars:**
    - `VITE_API_BASE_URL`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_STORAGE_BUCKET`
    - `VITE_FRONTEND_URL`
    - `SUPABASE_DB_URL`
    - `SUPABASE_URL`
    - `SUPABASE_KEY`
    - `SUPABASE_STORAGE_BUCKET`
    - `SUPABASE_BACKUP_BUCKET` (must NOT equal `SUPABASE_STORAGE_BUCKET`)
    - `JWT_SECRET`
    - `CAPTCHA_SECRET_KEY`
    - `SUPABASE_BACKUP_KEY` (service-role key, NOT `SUPABASE_KEY`)
    - `PG_DUMP_PATH` (optional, path to `pg_dump` binary)

## Stack

- **Framework:** React 18, TypeScript, Node.js (Express)
- **Build Tool:** Vite 7
- **Package Manager:** pnpm
- **Styling:** Tailwind CSS, Radix UI (shadcn/ui-style)
- **State Management:** TanStack Query (React Query)
- **Routing:** wouter
- **Forms:** React Hook Form, Zod
- **Date Formatting:** dayjs
- **HTTP Client:** Axios
- **Rich Text Editor:** Quill 2.0.3, quill-mention 6.1.1
- **Database:** Supabase PostgreSQL
- **Backend Runtime:** tsx

## Where things live

- `src/`: Frontend source code
    - `src/api/`: Axios API services
    - `src/components/ui/`: Reusable UI components
    - `src/contexts/`: AuthContext
    - `src/pages/`: Route-level components
    - `src/helpers/format.ts`: Shared formatting utilities
- `server/src/`: Node.js Express backend
    - `server/src/index.ts`: Server entry point
    - `server/src/db.ts`: PostgreSQL connection and type overrides
    - `server/src/routes/`: API route handlers
    - `server/src/scheduler/`: Scheduled jobs (e.g., `emailQueue.ts`, `dailyCleanup.ts`, `sendReminderEmail.ts`, `deleteTestUsers.ts`, `weeklyKenStats.ts`, `backupDatabase.ts`)
    - `server/src/middleware/`: JWT auth middleware
    - `server/src/utils/`: Backend utilities (JWT, password hashing, 2FA, soft delete, Supabase Storage uploads, `schemaChange.ts`, `campaignUpdateRecipients.ts`, `matchingGrants.ts`, `pendingMatches.ts`)
- `attached_assets/`: Project assets (`@assets` alias)
- `releases/<DD_MM_YYYY>/migrations/`: Database migration SQL files (source of truth for schema changes)
- `src/config/adminSidebar.ts`: Sidebar navigation configuration (incl. module permissions)
- `src/App.tsx`: Frontend route definitions and protected routes
- `server/src/scheduler/migration-scheduler-configurations.sql`: Scheduler initial configuration seed
- `server/src/utils/uploadBase64Image.ts`: Supabase Storage upload and URL resolution logic
- `server/src/db.ts`: `ensureDbSchemaLogsModule()` and `ensureSchemaChangeLogTable()` runtime schema helpers
- `Back-End/`: .NET reference code (DO NOT MODIFY)

## Architecture decisions

-   **PostgreSQL Type Parsing:** `pg` library timestamp OIDs (1114, 1184) and the plain `date` OID (1082) are overridden to return raw strings instead of JS Date objects to prevent UTC timezone shifts (e.g. `event_date` rendering one day earlier in US Eastern).
-   **Scheduler Configuration:** Schedules are configurable via the `scheduler_configurations` database table and support runtime reloading.
-   **Email Queue:** An in-memory producer/consumer pattern is used for asynchronous email sending.
-   **Soft Deletes:** Most critical entities (users, investments, recommendations, grants, other assets, disbursal requests) use soft-deletion with cascade and restore capabilities. A daily cleanup job archives and deletes soft-deleted records past a retention period.
-   **Schema Change Auditing:** A `public.schema_change_logs` table and `public.apply_schema_change(jsonb)` PL/pgSQL function enforce schema changes via a wrapper, providing audit trails, rollback capabilities, and guarding destructive operations. This is additive to file-based migrations.
-   **GA4 Analytics Caching:** GA4 data is fetched and cached in-memory for 60 seconds on the backend to reduce API calls.
-   **Matching Grant Logic:** `applySingleGrant` (and its projection counterparts) handles complex matching logic including capping, per-investment caps, donor exclusion, expiry dates, and escrow management, mirroring .NET behavior. Donor wallet locking with `FOR UPDATE` prevents overdraft during live matching.
-   **Investment Update Email Recipients:** Recipient logic for investment update emails explicitly unions various sources (recommendations, pending grants, asset-based payments) to ensure all relevant investors receive notifications, correcting previous under-delivery.
-   **Cancel Match Tombstone:** The admin "Cancel match" action on `/matching` hard-deletes the `campaign_match_grant_activity` row and soft-deletes the donor recommendation, but ALSO records a tombstone in `canceled_match_pairs (match_grant_id, triggered_by_recommendation_id)`. Both `runRetroactiveSweep` (`server/src/utils/matchingGrants.ts`) and the per-grant pending projection in `fetchPendingTriggers` / `projectPendingMatchesForGrant` (`server/src/utils/pendingMatches.ts`) MUST exclude tombstoned pairs, otherwise the cancellation will be silently resurrected on the next sweep. The cancel endpoint is idempotent — a re-submitted cancel for an already-removed activity returns `{ success: true, alreadyCanceled: true }` instead of 404. Donor wallet is intentionally NOT credited (handled separately by grant deactivation / reservation reconciliation).

## Product

-   User and Admin user management (CRUD, impersonation).
-   Investment management (CRUD, file uploads, notes, tags, status toggles, cloning, Excel exports).
-   Disbursal request processing (status updates, notes, Excel exports).
-   Site configuration management (email templates, DAF providers).
-   Dashboard with key metrics, charts, and audit logs.
-   Scheduled jobs for reminders, cleanup, database backups, and weekly stats.
-   Analytics dashboard (GA4 integration).
-   Group management (reports, members, investments, transaction history).
-   Campaign-related public endpoints (disbursal, raise money forms, investment requests).
-   Pending grants and other assets management with status transitions and notes.
-   Role-based access control (RBAC) for various modules.
-   Database schema change logging and rollback UI.
-   Retroactive matching for grants.
-   Pending match projection across admin UI for recommendations and DAFs.

## User preferences
- Always analyze .NET backend first
- Maintain feature parity
- Do NOT introduce new logic
- Follow existing API structure, business logic, validation, and data flow
- Use @schema.sql for database mapping (snake_case)
- The `/Back-End` folder contains .NET reference code only and must NOT be modified; all code changes must be made only in the Node.js (`server/`) and React (`src/`) code
- Any database schema or data change executed via direct `pool` calls (e.g. `pool.query`, `client.query`, runtime `ensure*` helpers in `server/src/db.ts`, ad-hoc one-off scripts) must FIRST be written as a SQL migration file under `releases/<DD_MM_YYYY>/migrations/` and documented in that release's `docs.txt` (schema, intent, idempotency, rollback). Migrations must be idempotent (`IF NOT EXISTS`, guarded `DO` blocks, etc.) and wrapped in a transaction. Do not apply schema/data changes that exist only in code or only in the live database — the migration file is the source of truth and must land in the same change set.
- First explain approach
- Then implement
- Provide verification steps

## Gotchas

-   **`pg_dump` version mismatch:** The major version of the `pg_dump` binary used by the `BackupDatabase` job *must* match the PostgreSQL server's major version. Install via `installSystemDependencies({ packages: ["postgresql_17"] })` or set `PG_DUMP_PATH`.
-   **`SUPABASE_BACKUP_KEY` requirement:** The `BackupDatabase` job requires a Supabase **service-role** key for `SUPABASE_BACKUP_KEY`, not the public `SUPABASE_KEY`. Runtime guards prevent the job from running if misconfigured.
-   **Dedicated `SUPABASE_BACKUP_BUCKET`:** The backup bucket must be a *separate, private* Supabase Storage bucket from the public asset bucket. Runtime guards verify its privacy and prevent uploads to public buckets or the primary asset bucket.
-   **Investment Instruments vs. Investment Type:** The "Investment Instruments" field (`campaigns.investment_instruments`) is a comma-separated list of lookup IDs, while "Investment Type" (`campaigns.investment_type_category`) refers to Equity/Debt/Hybrid. Do not confuse them; their labels and usage are distinct.
-   **Investment Owner Email Validation:** The Investment Owner field on `/raisemoney/edit/:id` uses client-side validation to ensure the email exists in `users`. The backend currently does not enforce this for `campaigns.contact_info_email_address`.
-   **Rich Text Editor Styles:** Quill styles are imported globally in `src/main.tsx`. The `Mention` module for `quill-mention` must be registered explicitly within the `RichTextEditor` component.
-   **Supavisor pool ceiling:** `SUPABASE_DB_URL` connects through Supavisor (host `aws-…-pooler.supabase.com`). In **session mode** (port `5432`) the pooler caps total client connections at **15** per project; in **transaction mode** (port `6543`) the cap is higher but the codebase has not been audited for transaction-mode caveats (prepared statements, `LISTEN/NOTIFY`, session-level `SET` state, advisory locks). The app-side `pg.Pool` `max` in `server/src/db.ts` MUST stay strictly below whichever Supavisor cap is in use, otherwise requests fail with `{"success":false,"message":"[CRASH:DB_SESSION] max clients reached in session mode – max clients are limited to pool_size: 15"}`. Both QA and production currently use session mode (5432), so `max` is pinned at `10` with `connectionTimeoutMillis: 20_000` to absorb the 12-request Site Configuration burst plus scheduler activity. If a future bump is needed, switch the connection string to port `6543` first rather than raising `max` past `14`.

## Pointers

-   **DB Schema and Migrations:** Refer to `releases/<DD_MM_YYYY>/migrations/` for the source of truth regarding database schema changes.
-   **API Contracts:** Refer to `server/src/routes/` for backend API endpoint definitions and expected payloads/responses.
-   **Date/Time Handling:** `server/src/db.ts` for PostgreSQL timestamp parsing overrides; `dayjs` for frontend date formatting.
-   **Supabase Storage:** `server/src/utils/uploadBase64Image.ts` for upload and URL resolution logic; `server/src/scheduler/backupDatabase.ts` for backup storage specifics.
-   **GA4 Analytics:** `services/ga4Service.ts` for GA4 integration logic.
-   **Frontend Component Library:** `src/components/ui/` for custom Radix UI components.
-   **Styling:** Tailwind CSS documentation.