# Cerul Parallel Sprint Round 4 — Codex Task Prompts

This document contains 3 independent task prompts designed to run in parallel worktrees.
T16 (Docs Pages) and T17 (Agent Skill) are already fully implemented and merged — no work needed.

> **Port allocation**: Ports are in the 9300-9400 range to avoid conflicts with previous rounds and each other.
>
> | Worktree | Frontend | Backend |
> |----------|----------|---------|
> | Task 1 (T13 Search Demo) | 9301 | 9302 |
> | Task 2 (T14 Pipelines) | 9303 | 9304 |
> | Task 3 (T15 Stripe E2E) | 9305 | 9306 |
>
> When starting servers, **always specify the port explicitly**.
> Do NOT use default ports (3000 / 8000).

---

## Task 1: Search Demo Page (T13)

**Branch**: `codex/feat-search-demo`

**Scope**: `frontend/app/search/page.tsx` (new), `frontend/components/search/` (new directory), `frontend/lib/demo-api.ts` (read-only reference), `frontend/app/api/demo/search/route.ts` (read-only reference)

**Purpose**: Create a public Search Demo page where visitors can experience Cerul's video search without logging in.

**Port**: Frontend on `9301`, Backend on `9302`.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement a public Search Demo page at /search.

Read these files first for full context:
- ARCHITECTURE.md (section 11 for frontend strategy, look for "demo" and "search" references)
- AGENTS.md (coding conventions — respond in Chinese to repo owner, code/docs in English)
- frontend/app/page.tsx (home page — reference for layout pattern, SiteHeader usage, styling conventions)
- frontend/lib/demo-api.ts (CRITICAL — this is the data layer you will use: simulateDemoSearch(), DemoSearchResponse, DemoSearchResult, DemoMode types)
- frontend/app/api/demo/search/route.ts (Next.js API route that calls simulateDemoSearch — your page should POST to /api/demo/search)
- frontend/components/site-header.tsx (header component to reuse)
- frontend/lib/site.ts (navigation config — check searchTracks and other constants)
- frontend/app/globals.css (design tokens: --foreground, --surface, --border, surface-elevated class, etc.)
- frontend/components/dashboard/overview-screen.tsx (reference for card layout patterns)
- frontend/components/dashboard/dashboard-layout.tsx (reference for page structure pattern)

## Current State

- /api/demo/search route exists and works — accepts POST { mode, query }, returns DemoSearchResponse
- demo-api.ts has full simulation logic with 3 modes: "knowledge", "broll", "agent"
- No /search page exists yet — the directory frontend/app/search/ does not exist
- The home page (page.tsx) has an AgentDemoConsole component but no dedicated search experience

## Design Requirements

The search page should feel like a polished product demo — it's the main way visitors experience Cerul.

### Layout
- Full-width page with SiteHeader at top (pass currentPath="/search")
- Hero section with a prominent search bar
- Mode selector (tabs or segmented control) for: Knowledge, B-roll, Agent
- Results area below the search bar
- No login required — this is a public page

### Search Bar
- Large, centered input with placeholder text like "Search videos..."
- Submit on Enter or click a search button
- Show a loading state while waiting for results

### Results Display
- For "knowledge" and "agent" modes: show the `answer` field prominently at the top (if present), then list individual results below
- For "broll" mode: show results in a grid/card layout (video thumbnails)
- Each result card should show: title, score (as relevance percentage), source, detail text
- Include the result's href as a clickable link
- Show diagnostics info in a collapsible section

### Response Metadata
- Display latency (latencyMs), credits used/remaining, request ID
- Show these in a subtle bar above or below results

### Styling
- Follow the existing design system: use CSS variables from globals.css (--foreground, --surface, --border, --accent, etc.)
- Use the surface-elevated class for cards
- Use font-mono for technical values (scores, IDs, latency)
- Responsive: stack to single column on mobile
- Match the dark theme aesthetic of the rest of the site

## Deliverables

### 1. Search page — `frontend/app/search/page.tsx`
- Server component wrapper with metadata (title: "Search Demo", description, canonical: /search)
- Renders a client component for the interactive search UI

### 2. Search components — `frontend/components/search/`
Create these components:
- `search-demo.tsx` — main client component ("use client") with search state, mode selection, API call logic
- `search-results.tsx` — renders the list/grid of DemoSearchResult items
- `search-result-card.tsx` — individual result card
- `search-answer.tsx` — renders the AI-generated answer block (for knowledge/agent modes)
- `search-metadata.tsx` — renders response metadata (latency, credits, request ID, diagnostics)

### 3. Update navigation — `frontend/lib/site.ts`
- Ensure /search is included in the primary navigation if not already present

### 4. SEO
- Export proper metadata with title, description, canonical URL
- The page should be indexable (no noindex)

## Technical Notes
- POST to /api/demo/search with body { mode, query }
- Handle fetch errors gracefully — show an error message, not a crash
- Use React useState for search state, useTransition or useState for loading
- Do NOT import from backend code — only use the Next.js API route
- The demo API is deterministic (same query + mode = same results) — this is intentional

## Port Configuration
If you need to verify the page locally:
- Frontend: FRONTEND_PORT=9301 NEXT_PUBLIC_API_BASE_URL=http://localhost:9302 pnpm --dir frontend dev --hostname 127.0.0.1 --port 9301
- Backend: BACKEND_PORT=9302 (only needed if testing real /v1/search, not required for demo)

## Tests
- Add or update frontend tests in frontend/__tests__/ if a test file for search components makes sense
- At minimum, ensure `pnpm --dir frontend build` succeeds with no type errors
- Ensure `pnpm --dir frontend test` passes

Do your work, then review everything once more. If there are no issues, commit, push, and open a PR to main.
```

---

## Task 2: Pipelines Dashboard (T14)

**Branch**: `codex/feat-pipelines-dashboard`

**Scope**: `backend/app/routers/dashboard.py`, `frontend/components/dashboard/pipelines-screen.tsx`, `frontend/lib/api.ts`, `backend/tests/test_dashboard.py`

**Purpose**: Replace the placeholder Pipelines page with a real dashboard showing processing_jobs status and pipeline step details.

**Port**: Frontend on `9303`, Backend on `9304`.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the Pipelines Dashboard — a real backend endpoint for job telemetry and a frontend that displays processing job status.

Read these files first for full context:
- ARCHITECTURE.md (section 10 for pipeline architecture, section 10.6 for job state machine)
- AGENTS.md (coding conventions)
- backend/app/routers/dashboard.py (existing dashboard endpoints — you will add new ones here)
- backend/app/routers/search.py (reference for router patterns, auth dependency usage)
- frontend/components/dashboard/pipelines-screen.tsx (current placeholder — you will replace this)
- frontend/components/dashboard/dashboard-layout.tsx (layout wrapper you must use)
- frontend/components/dashboard/dashboard-state.tsx (DashboardNotice, DashboardSkeleton, DashboardState components)
- frontend/components/dashboard/usage-screen.tsx (reference for how other dashboard screens fetch and render data)
- frontend/components/dashboard/keys-screen.tsx (reference for list/table patterns)
- frontend/lib/api.ts (API client — you will add new methods here)
- frontend/components/dashboard/use-monthly-usage.ts (reference for custom data-fetching hooks)
- workers/worker.py (understand the job state machine: pending → running → completed/retrying/failed)
- db/migrations/003_worker_retry.sql (schema for processing_jobs retry columns)

## Database Schema Context

The `processing_jobs` table has these columns:
- id (uuid), track (text), source_id (uuid nullable), job_type (text)
- status (text: pending, running, retrying, completed, failed)
- input_payload (jsonb), error_message (text nullable)
- attempts (int default 0), max_attempts (int default 3)
- locked_by (text nullable), locked_at (timestamptz nullable)
- next_retry_at (timestamptz nullable)
- created_at, started_at, completed_at, updated_at (timestamptz)

The `processing_job_steps` table has:
- id (uuid), job_id (uuid FK), step_name (text)
- status (text: completed, failed, skipped)
- artifacts (jsonb), error_message (text nullable)
- started_at, completed_at, updated_at (timestamptz)
- UNIQUE(job_id, step_name)

## Deliverables

### 1. Backend — New endpoints in `backend/app/routers/dashboard.py`

Add these endpoints (all require session auth via `require_session`):

#### GET /dashboard/jobs
- Query params: `status` (optional filter), `track` (optional filter), `limit` (default 50, max 200), `offset` (default 0)
- Returns a list of jobs with: id, track, job_type, status, attempts, max_attempts, error_message, created_at, started_at, completed_at, updated_at
- Order by created_at DESC
- Include a `total_count` field for pagination
- Add Pydantic response models: `JobSummary`, `JobListResponse`

#### GET /dashboard/jobs/{job_id}
- Returns full job details including all steps from processing_job_steps
- Add Pydantic models: `JobStepDetail`, `JobDetailResponse`
- Return 404 if job not found

#### GET /dashboard/jobs/stats
- Returns aggregate counts: total, pending, running, retrying, completed, failed
- Also return counts by track (broll vs knowledge)
- Add Pydantic model: `JobStatsResponse`

### 2. Frontend API client — `frontend/lib/api.ts`

Add a `jobs` namespace to the API client:
- `jobs.list(params?)` — GET /dashboard/jobs with optional status/track/limit/offset
- `jobs.get(jobId)` — GET /dashboard/jobs/{jobId}
- `jobs.getStats()` — GET /dashboard/jobs/stats
- Define TypeScript types matching the backend response models
- Follow the existing snake_case → camelCase normalization pattern

### 3. Frontend hook — `frontend/components/dashboard/use-jobs.ts` (new)

Create a data-fetching hook similar to `use-monthly-usage.ts`:
- `useJobStats()` — fetches job stats, returns { data, error, isLoading, refresh }
- `useJobList(params?)` — fetches job list with optional filters

### 4. Frontend — Replace `frontend/components/dashboard/pipelines-screen.tsx`

Replace the placeholder with a real dashboard:

#### Stats Overview (top section)
- Cards showing: Total Jobs, Pending, Running, Completed, Failed
- Each card with count and a colored indicator (green for completed, yellow for running, red for failed)
- Breakdown by track (broll / knowledge)

#### Jobs Table (main section)
- Sortable/filterable table of recent jobs
- Columns: Status (with colored badge), Track, Job Type, Attempts, Created, Duration
- Status filter dropdown (All, Pending, Running, Completed, Failed)
- Track filter (All, B-roll, Knowledge)
- Click a row to expand and show step details inline
- Paginate with limit/offset

#### Job Detail (expanded row or modal)
- Show all processing_job_steps for the selected job
- Each step: name, status (with icon), artifacts summary, error message if failed
- Timeline visualization of step progression

#### Empty State
- If no jobs exist, show a friendly message with link to docs

### 5. Tests

Backend:
- Add tests in `backend/tests/test_dashboard.py` for the new endpoints
- Test job list with filters, job detail 404, stats aggregation
- Mock the database connection following existing test patterns

Frontend:
- Ensure `pnpm --dir frontend build` succeeds
- Ensure `pnpm --dir frontend test` passes

## Styling
- Follow the existing dashboard design system exactly
- Use surface-elevated for cards, font-mono for technical values
- Use the DashboardLayout wrapper with currentPath="/dashboard/pipelines"
- Match the patterns in usage-screen.tsx and keys-screen.tsx

## Port Configuration
- Frontend: FRONTEND_PORT=9303 NEXT_PUBLIC_API_BASE_URL=http://localhost:9304 pnpm --dir frontend dev --hostname 127.0.0.1 --port 9303
- Backend: BACKEND_PORT=9304 uvicorn app.main:app --host 127.0.0.1 --port 9304

Do your work, then review everything once more. If there are no issues, commit, push, and open a PR to main.
```

---

## Task 3: Stripe E2E Verification (T15)

**Branch**: `codex/feat-stripe-e2e`

**Scope**: `backend/app/billing/stripe_service.py`, `backend/app/routers/webhooks.py`, `backend/app/routers/dashboard.py`, `frontend/components/dashboard/settings-screen.tsx`, `backend/tests/test_billing.py` (new), `frontend/lib/api.ts`

**Purpose**: Verify and fix the complete Stripe billing flow end-to-end. All code exists but has never been tested against a real (test-mode) Stripe environment. Find and fix edge cases.

**Port**: Frontend on `9305`, Backend on `9306`.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to audit, test, and fix the Stripe billing integration end-to-end.

Read these files first for full context:
- ARCHITECTURE.md (section 6 for billing tiers, section 7 for credit model)
- AGENTS.md (coding conventions)
- backend/app/billing/stripe_service.py (full Stripe service — checkout, portal, webhooks)
- backend/app/billing/credits.py (credit deduction and balance logic)
- backend/app/billing/usage.py (usage tracking)
- backend/app/routers/webhooks.py (Stripe webhook handler with idempotency via stripe_events table)
- backend/app/routers/dashboard.py (billing/checkout and billing/portal endpoints)
- frontend/components/dashboard/settings-screen.tsx (Settings page with Upgrade/Manage buttons)
- frontend/lib/api.ts (billing.createCheckout() and billing.createPortal() client methods)
- backend/app/auth/session.py (session auth — understand how user context flows)
- backend/app/db/connection.py (database connection pattern)

## Current State

All billing code is implemented:
- StripeService: create_checkout_session, create_portal_session, construct_webhook_event, activate_checkout_subscription, sync_subscription_status
- Webhook handler: idempotent via stripe_events dedup table, handles checkout.session.completed, customer.subscription.deleted, customer.subscription.updated
- Frontend: Settings page shows current plan, Upgrade button (free tier), Manage Subscription button (paid tier)
- API client: billing.createCheckout() and billing.createPortal()

However, this code has NEVER been tested against Stripe's test mode. Your job is to audit the code, write comprehensive tests, and fix any issues found.

## Deliverables

### 1. Code Audit — Review and fix issues in existing billing code

Audit for these common Stripe integration problems:

#### backend/app/billing/stripe_service.py
- Verify stripe.checkout.Session.create() parameters match current Stripe API (2024+)
- Check success_url and cancel_url construction — do they use the correct frontend base URL?
- Verify customer creation flow — is stripe_customer_id stored and reused correctly?
- Check that mode="subscription" is set for checkout
- Verify price_id comes from config/env (STRIPE_PRO_PRICE_ID)
- Ensure proper error handling — StripeServiceError should wrap stripe.error.StripeError

#### backend/app/routers/webhooks.py
- Verify webhook signature verification uses raw body (not parsed JSON)
- Check idempotency: duplicate event IDs should be silently skipped, not error
- Verify checkout.session.completed handler correctly extracts subscription_id and customer_id
- Check customer.subscription.deleted properly downgrades user to free tier
- Verify customer.subscription.updated handles plan changes
- Ensure the stripe_events dedup table INSERT doesn't race under concurrent webhooks

#### frontend/components/dashboard/settings-screen.tsx
- Verify the checkout redirect flow: createCheckout() returns a URL, then window.location.href = url
- Check error states: what happens if checkout creation fails? Is the error shown to user?
- Verify the Manage Subscription button only appears for paid tier users
- Check loading states during billing actions

#### frontend/lib/api.ts
- Verify billing.createCheckout() and billing.createPortal() handle the response shape correctly
- Check that the URL field is extracted properly (the backend returns checkout_url/portal_url, frontend normalizes to url)

### 2. Backend Tests — `backend/tests/test_billing.py` (new)

Write comprehensive tests:

- Test create_checkout_session with mocked Stripe API
  - Happy path: returns checkout URL
  - Error: user already on paid tier (409)
  - Error: Stripe API failure (503)
- Test create_portal_session with mocked Stripe API
  - Happy path: returns portal URL
  - Error: no stripe_customer_id (404)
  - Error: Stripe API failure (503)
- Test webhook handler
  - checkout.session.completed: user tier updated to pro, stripe_customer_id saved
  - customer.subscription.deleted: user tier downgraded to free
  - customer.subscription.updated: subscription status synced
  - Duplicate event ID: silently skipped (idempotency)
  - Invalid webhook signature: 400 error
- Test credit deduction
  - Sufficient credits: deducts and returns remaining
  - Insufficient credits: raises appropriate error

### 3. Fix any issues found

Apply fixes to the billing code based on your audit. Common issues to watch for:
- Stripe API parameter naming changes (the Stripe Python SDK has evolved)
- Missing error handling for edge cases
- Frontend not handling all possible backend error responses
- Race conditions in webhook processing

### 4. Verify settings-screen.tsx error handling

Ensure the frontend Settings page handles these scenarios:
- Loading state while fetching usage data
- Error state if usage fetch fails
- Loading state during checkout/portal redirect
- Error state if billing action fails
- Correct tier display for free/pro/enterprise

## Technical Notes
- Use `stripe` Python package for backend (already in requirements.txt)
- Mock Stripe API calls in tests — do NOT make real Stripe API calls
- The webhook endpoint must accept raw body for signature verification
- Stripe test mode uses keys starting with sk_test_ and pk_test_
- Webhook secrets start with whsec_

## Port Configuration
- Frontend: FRONTEND_PORT=9305 NEXT_PUBLIC_API_BASE_URL=http://localhost:9306 pnpm --dir frontend dev --hostname 127.0.0.1 --port 9305
- Backend: BACKEND_PORT=9306 uvicorn app.main:app --host 127.0.0.1 --port 9306

## Tests
- Run `cd backend && python -m pytest tests/test_billing.py -v` for billing tests
- Run `cd backend && python -m pytest` for full backend test suite
- Run `pnpm --dir frontend build` for frontend type check
- Run `pnpm --dir frontend test` for frontend tests

Do your work, then review everything once more. If there are no issues, commit, push, and open a PR to main.
```

---

## Notes

### Already Completed Tasks (No Worktree Needed)

- **T16 (Docs Pages)**: Fully implemented — `frontend/app/docs/page.tsx` (394 lines), `frontend/app/docs/[slug]/page.tsx` (204 lines), `frontend/lib/docs.ts` (442 lines). Complete with SEO metadata, ISR caching, sidebar navigation, and tabbed code examples.

- **T17 (Codex/Claude Agent Skill)**: Fully implemented — `skills/cerul-api/SKILL.md` (123 lines). Includes auth rules, endpoint docs, and working examples in Bash, Python, and TypeScript.

### Merge Order

No strong dependencies between T13, T14, and T15 — they touch different files and can be merged in any order. Suggested: T13 → T14 → T15 (frontend-only first, then mixed, then audit).

### File Conflict Risk

| File | T13 | T14 | T15 |
|------|-----|-----|-----|
| frontend/lib/api.ts | — | write | read |
| backend/app/routers/dashboard.py | — | write | read |
| frontend/components/dashboard/pipelines-screen.tsx | — | write | — |
| frontend/app/search/ | write | — | — |
| backend/app/billing/ | — | — | write |
| frontend/components/dashboard/settings-screen.tsx | — | — | write |

Conflict risk is low — only `frontend/lib/api.ts` has a potential overlap (T14 adds jobs namespace, T15 may adjust billing types), but the changes are in different sections.
