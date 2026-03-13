# Cerul Admin Console Execution Plan

Status legend:

- `[ ]` Pending
- `[~]` In progress
- `[x]` Completed

## Goal

Ship a production-grade admin console that gives Cerul operators and administrators
site-wide visibility into:

- user growth and plan distribution
- request volume, latency, search quality, and query trends
- indexed content inventory, daily additions, and target attainment
- ingestion backlog, source health, job failures, and pipeline throughput

The implementation must:

- live alongside the existing user dashboard without mixing user and admin surfaces
- use real backend data instead of demo fixtures
- record `latency_ms` for every public search request
- support target tracking and period-over-period comparisons
- preserve the current Cerul design language and the operator/product framing used by
  [`skills/cerul-api/SKILL.md`](/Users/jessytsui/cerul/repo/skills/cerul-api/SKILL.md)

## Product Scope

### Admin routes

- `/admin`
- `/admin/users`
- `/admin/requests`
- `/admin/content`
- `/admin/ingestion`
- `/admin/settings`

### Primary admin capabilities

- Site-wide KPI overview with range selector (`today`, `7d`, `30d`)
- User growth, active users, tier mix, and API key posture
- Request volume, credits, latency, zero-result rate, answer usage rate, and top queries
- Content inventory totals, recent additions, per-track growth, source health, and target attainment
- Ingestion backlog, completion rate, failure rate, recent failures, and source-level throughput
- Admin-managed targets for key metrics so the console can show actual vs expected values

## Technical Design

### Authorization model

- Add a persistent console role to `user_profiles`
- Supported roles:
  - `user`
  - `operator`
  - `admin`
- Existing pipeline operator checks should accept:
  - `console_role IN ('operator', 'admin')`
  - or legacy `DASHBOARD_OPERATOR_EMAILS` fallback for compatibility
- Admin routes should require:
  - authenticated session
  - `console_role = 'admin'`
  - or explicit legacy email allowlist fallback until all admins are migrated

### Backend modules

- Add [`backend/app/routers/admin.py`](/Users/jessytsui/cerul/repo/backend/app/routers/admin.py)
- Add [`backend/app/admin/`](/Users/jessytsui/cerul/repo/backend/app/admin) package for:
  - aggregation queries
  - response models
  - target helpers
  - access control helpers
- Keep `dashboard.py` for user self-serve console and operator pipeline telemetry
- Keep admin endpoints separate from dashboard endpoints

### Database additions

- Migration: add `console_role` to `user_profiles`
- Migration: add `admin_metric_targets`
- Migration: add indexes for admin range queries where useful

### Frontend modules

- Add [`frontend/app/admin/layout.tsx`](/Users/jessytsui/cerul/repo/frontend/app/admin/layout.tsx)
- Add [`frontend/app/admin/page.tsx`](/Users/jessytsui/cerul/repo/frontend/app/admin/page.tsx)
- Add per-section pages under `frontend/app/admin/*`
- Add [`frontend/components/admin/`](/Users/jessytsui/cerul/repo/frontend/components/admin) for layout and screens
- Extend [`frontend/lib/api.ts`](/Users/jessytsui/cerul/repo/frontend/lib/api.ts) with `admin.*`
- Add admin navigation helpers to [`frontend/lib/site.ts`](/Users/jessytsui/cerul/repo/frontend/lib/site.ts)

### Metrics available from current data

- `user_profiles`: total users, new users, tier distribution, role distribution
- `api_keys`: active keys, recently used keys
- `usage_events`: requests, credits, active users, search-type mix
- `query_logs`: top queries, zero-result rate, answer usage rate, query count
- `broll_assets`: total indexed assets, new assets
- `knowledge_videos`: total indexed videos, new videos
- `knowledge_segments`: total indexed segments, new segments
- `content_sources`: source counts, active source counts
- `processing_jobs`: backlog, throughput, failure rate, recent failures
- `processing_job_steps`: failing steps and pipeline bottlenecks

### Metrics that require this implementation

- `query_logs.latency_ms` must be written for every `/v1/search` request
- `admin_metric_targets` must provide target values for:
  - `new_users`
  - `requests_total`
  - `active_users`
  - `credits_used`
  - `broll_assets_added`
  - `knowledge_videos_added`
  - `knowledge_segments_added`
  - `jobs_completed`
  - `jobs_failed`

## API Contract

### GET `/admin/summary?range=7d`

Returns:

- top-level KPIs
- delta vs previous equal-length window
- target attainment where targets exist
- small chart series for overview cards

### GET `/admin/users/summary?range=30d`

Returns:

- total users
- new users
- active users
- tier breakdown
- console role breakdown
- active API keys
- latest users list

### GET `/admin/requests/summary?range=7d`

Returns:

- requests
- credits
- unique active users
- average credits/request
- zero-result rate
- answer usage rate
- latency p50/p95/p99
- search-type split
- daily series
- top queries
- zero-result queries

### GET `/admin/content/summary?range=7d`

Returns:

- current inventory totals
- additions in selected range
- additions in previous range
- period-over-period deltas
- target attainment
- per-track and per-source additions
- stale / inactive source warning data

### GET `/admin/ingestion/summary?range=7d`

Returns:

- job totals by status
- completion / failure rates
- average processing duration
- pending backlog
- source health table
- recent failed jobs
- recent failed steps

### GET `/admin/targets?range=30d`

Returns:

- configured metric targets
- current attainment
- editable values for admin settings

### PUT `/admin/targets`

Accepts:

- metric target upserts for a selected period
- optional scope:
  - `global`
  - `track`
  - `source`

## UI Design

### Design direction

- Reuse the existing dashboard visual system instead of inventing a separate admin product
- Keep the interface operator-readable and product-focused
- Use concise cards, compact charts, and dense tables for scanning
- Preserve the Cerul voice used in the public dashboard and in the agent skill:
  - operator-first
  - API/product instrumentation
  - retrieval and ingestion health

### Shared admin layout

- Left rail navigation dedicated to admin routes
- Header actions:
  - range switcher
  - refresh
  - quick jump to `/dashboard/pipelines`
- Overview page:
  - KPI grid
  - request trend chart
  - content growth chart
  - ingestion status strip
  - notable exceptions panel

### Users page

- KPI cards
- tier distribution cards
- admin/operator/user role distribution
- recent signups table
- most active accounts table

### Requests page

- request, credits, active users, latency, zero-result cards
- stacked chart for `knowledge` vs `broll`
- latency chart
- top queries table
- zero-result queries table

### Content page

- inventory totals
- additions vs targets
- per-track growth
- per-source additions table
- source freshness / stale source flags

### Ingestion page

- backlog and throughput cards
- jobs-by-status chart
- source health table
- failed jobs table
- failed steps table

### Settings page

- editable metric targets
- admin console role explanation
- environment / migration caveats

## Execution Checklist

### 1. Planning and documentation

- [x] Write this execution plan into the repository
- [x] Keep this checklist updated as work progresses

Acceptance criteria:

- A committed markdown plan exists in `docs/`
- Every implementation task below can be checked off against a concrete file or test

### 2. Database and data model

- [x] Add migration for `user_profiles.console_role`
- [x] Add migration for `admin_metric_targets`
- [x] Add indexes needed for admin aggregation queries
- [x] Update test fixtures and schema assumptions

Acceptance criteria:

- New schema applies cleanly on a fresh database
- Existing billing / auth / dashboard tests still pass

### 3. Search latency instrumentation

- [x] Measure end-to-end `/v1/search` latency in milliseconds
- [x] Persist `latency_ms` in `query_logs`
- [x] Cover success and failure-safe logging behavior in tests

Acceptance criteria:

- Each successful search request writes a non-null `latency_ms`
- Existing search API behavior remains unchanged for clients

### 4. Admin backend foundations

- [x] Add admin domain package under `backend/app/admin/`
- [x] Add admin access control helper with role + legacy-email fallback
- [x] Add response models for admin summary endpoints
- [x] Register admin router in [`backend/app/main.py`](/Users/jessytsui/cerul/repo/backend/app/main.py)

Acceptance criteria:

- Non-admin users receive `403`
- Admin users can access all new endpoints
- Existing dashboard operator endpoints continue to work

### 5. Admin aggregation endpoints

- [x] Implement `GET /admin/summary`
- [x] Implement `GET /admin/users/summary`
- [x] Implement `GET /admin/requests/summary`
- [x] Implement `GET /admin/content/summary`
- [x] Implement `GET /admin/ingestion/summary`
- [x] Implement `GET /admin/targets`
- [x] Implement `PUT /admin/targets`

Acceptance criteria:

- Responses are strongly typed and stable
- Range comparison uses the immediately preceding equal-length window
- Target attainment is included where targets exist

### 6. Frontend API and routing

- [x] Extend `frontend/lib/api.ts` with `admin.*`
- [x] Add admin route helpers in `frontend/lib/site.ts`
- [x] Add admin app layout and auth guard pages
- [x] Keep admin route tree separate from user dashboard route tree

Acceptance criteria:

- Frontend can fetch all admin endpoints through typed helpers
- Navigation highlights correctly for nested admin routes

### 7. Admin UI implementation

- [x] Build shared admin layout and state components
- [x] Build overview screen
- [x] Build users screen
- [x] Build requests screen
- [x] Build content screen
- [x] Build ingestion screen
- [x] Build settings / targets screen

Acceptance criteria:

- All pages load from real backend data
- Empty, loading, and error states are handled
- UI matches existing Cerul console language and styling

### 8. Tests and verification

- [x] Add backend tests for role access and all new admin endpoints
- [x] Add frontend tests for admin API parsing and critical UI rendering
- [x] Run backend tests
- [x] Run frontend tests
- [x] Run frontend lint

Acceptance criteria:

- New behavior is covered by tests
- Existing suites continue to pass

## Progress Log

- 2026-03-14: Wrote the execution plan and implemented the admin console schema, APIs, and UI routes.
- 2026-03-14: Added end-to-end search latency logging, admin role access control, target management, and admin data aggregation services.
- 2026-03-14: Verified with `backend/.venv/bin/python -m pytest backend/tests -q`, `pnpm --dir frontend test -- --run`, `pnpm --dir frontend lint`, and `pnpm --dir frontend build`.
