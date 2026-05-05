# CataCap Admin Frontend
A React/TypeScript admin panel for managing investments, users, disbursal requests, and site configuration for the CataCap platform.

## Run & Operate
- **Run both frontend and backend:** `pnpm run dev`
- **Build frontend:** `pnpm run build`
- **Start production server:** `pnpm run start`
- **Required Environment Variables:**
    - `VITE_API_BASE_URL`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_STORAGE_BUCKET`
    - `VITE_FRONTEND_URL`
    - `SUPABASE_DB_URL`
    - `SUPABASE_URL`
    - `SUPABASE_KEY`
    - `SUPABASE_STORAGE_BUCKET`
    - `SUPABASE_BACKUP_BUCKET` (must be different from `SUPABASE_STORAGE_BUCKET`)
    - `JWT_SECRET`
    - `CAPTCHA_SECRET_KEY`
    - `SUPABASE_BACKUP_KEY` (service role key, NOT publishable/anon `SUPABASE_KEY`)
    - `PG_DUMP_PATH` (optional, for `pg_dump` binary path)

## Stack
- **Framework:** React 18, TypeScript
- **Runtime:** Node.js (Express with `tsx`)
- **Build Tool:** Vite 7
- **Package Manager:** pnpm
- **Styling:** Tailwind CSS, Radix UI (shadcn/ui-style)
- **State Management:** TanStack Query (React Query)
- **Routing:** wouter
- **Forms:** React Hook Form, Zod
- **ORM:** _Populate as you build_
- **Validation:** Zod (frontend), custom (backend)

## Where things live
- `src/`: Frontend React application
    - `src/api/`: Axios API services
    - `src/components/ui/`: Reusable UI components
    - `src/contexts/AuthContext.tsx`: JWT and permission management
    - `src/helpers/format.ts`: Shared formatting utilities
- `server/`: Node.js Express backend
    - `server/src/index.ts`: Server entry point
    - `server/src/db.ts`: PostgreSQL connection and DB utilities
    - `server/src/routes/`: API route handlers
    - `server/src/scheduler/`: Scheduled jobs (node-cron)
    - `server/src/middleware/auth.ts`: JWT authentication middleware
    - `server/src/utils/`: Backend utilities (JWT, password hashing, 2FA, Supabase Storage)
- `attached_assets/`: Project static assets
- `releases/<DD_MM_YYYY>/migrations/`: Database migration SQL files (source of truth for schema changes)
- **DB Schema:** Refer to SQL migration files in `releases/` and the `public.schema_change_logs` table for runtime changes.
- **API Contracts:** Defined implicitly by route handlers in `server/src/routes/`.
- **Theme Files:** `tailwind.config.cjs` for Tailwind, `src/components/ui/` for Radix/shadcn styles.

## Architecture decisions
- **Vite Proxy for API:** Vite dev server proxies `/api` to Express backend for seamless development.
- **Auth Strategy:** Utilizes ASP.NET Identity V3 compatible password hashing, JWT tokens for session management, and optional 2FA.
- **Soft Deletion:** Most entities support soft deletion with cascade to related records, handled by backend utilities.
- **Database Timezone Handling:** PostgreSQL `timestamp` OIDs are configured to return raw strings instead of JS Date objects to prevent unintended UTC timezone shifts.
- **Scheduler Configurable from DB:** Scheduled jobs are configured via the `scheduler_configurations` table, allowing dynamic updates and runtime reloading.
- **Schema Change Audit and Rollback:** A custom PL/pgSQL function `public.apply_schema_change` wraps DDL operations, logging changes to `public.schema_change_logs` and deriving rollback SQL, exposed via a dedicated API for admin UI.

## Product
- User and Admin management (CRUD operations, impersonation).
- Investment tracking and management (CRUD, status transitions, recommendations).
- Disbursal request processing.
- Site configuration management (FAQs, news, teams, testimonials, DAF providers).
- Analytics dashboard (GA4 integration).
- Email template management with variable extraction.
- Scheduled tasks for reminders, data cleanup, and reporting.
- Group management including reports, leaders/champions, and transaction history.
- Public-facing campaign and investment request forms with file uploads and anonymous user registration.
- Detailed audit logging for various administrative actions.
- Role-Based Access Control (RBAC) for granular permission management.

## User preferences
- _Populate as you build_

## Gotchas
- **`pg_dump` version mismatch:** The `pg_dump` binary used by the `BackupDatabase` job must match the major version of the PostgreSQL server. Install `postgresql_17` via `installSystemDependencies` if needed.
- **Supabase Backup Key & Bucket:** `SUPABASE_BACKUP_KEY` must be a Supabase service role key (NOT the publishable key). `SUPABASE_BACKUP_BUCKET` must be a separate, PRIVATE bucket from `SUPABASE_STORAGE_BUCKET`. Runtime guards prevent incorrect configurations.
- **Database Migrations:** All schema or data changes must first be written as idempotent SQL migration files in `releases/<DD_MM_YYYY>/migrations/` and documented.
- **Investment Instruments vs. Investment Type:** "Investment Instruments" (from `campaigns.investment_instruments`) is a lookup field, distinct from `campaigns.investment_type_category` ("Investment Type"). Ensure correct usage in UI and exports.
- **Investment Owner Field:** The "Investment Owner" field on `/raisemoney/edit/:id` validates against existing users on the frontend but the backend save currently does not enforce that the email matches a real user.

## Pointers
- **Supabase Documentation:** [https://supabase.com/docs](https://supabase.com/docs)
- **React Hook Form:** [https://react-hook-form.com/](https://react-hook-form.com/)
- **TanStack Query:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **Tailwind CSS:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Radix UI:** [https://www.radix-ui.com/docs](https://www.radix-ui.com/docs)
- **Vite Documentation:** [https://vitejs.dev/guide/](https://vitejs.dev/guide/)
- **`@schema.sql`:** Refer to the database schema definition for table and column naming conventions (snake_case).