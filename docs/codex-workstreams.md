# Cerul Parallel Sprint — Codex Task Prompts

This document contains 5 independent task prompts designed to run in parallel worktrees.
Each task has clear scope, no cross-task file conflicts, and explicit acceptance criteria.

> **Port allocation**: Ports are deliberately placed in the 9100-9200 range to avoid
> conflicts with both other Cerul worktrees AND other local projects (which commonly
> occupy 3000-3999 and 8000-8999).
>
> | Worktree | Frontend | Backend |
> |----------|----------|---------|
> | Task 1 (DB + Auth) | — | 9101 |
> | Task 2 (Search API) | — | 9102 |
> | Task 3 (B-roll Pipeline) | — | 9103 |
> | Task 4 (Dashboard API) | — | 9104 |
> | Task 5 (Frontend Dashboard) | 9150 | — |
>
> When starting servers, **always specify the port explicitly** (e.g. `--port 9101`).
> Do NOT use default ports (3000 / 8000) or common low ports (3001 / 8001) —
> they are very likely occupied by other local projects.

---

## Task 1: Database Schema + Auth Foundation

**Branch**: `codex/feature-db-auth`

**Scope**: `db/`, `backend/app/db/`, `backend/app/auth/`, `backend/requirements.txt`

**Purpose**: Establish the database layer and API key authentication — the foundation that all other backend modules depend on.

**Port**: Backend on `9101` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the database connection layer and API key authentication module.

Read these files first for full context:
- ARCHITECTURE.md (sections 7 and 8 for auth and data model)
- AGENTS.md (coding conventions)
- backend/app/main.py (current FastAPI entrypoint)
- .env.example (required env vars)

## Deliverables

### 1. Database migrations — `db/migrations/`

Create the initial migration SQL file `db/migrations/001_initial_schema.sql` containing
the full schema from ARCHITECTURE.md section 8.2. This includes:
- pgcrypto and vector extensions
- user_profiles, api_keys, usage_events, usage_monthly, stripe_events
- query_logs, content_sources, processing_jobs, processing_job_steps
- broll_assets, knowledge_videos, knowledge_segments
- All indexes as specified

### 2. Database connection module — `backend/app/db/`

Create `backend/app/db/__init__.py` and `backend/app/db/connection.py`:
- Use asyncpg for async PostgreSQL connection
- Connection pool management with get_pool() / close_pool()
- Read DATABASE_URL from environment
- Expose a get_db() async dependency for FastAPI

Add asyncpg to `backend/requirements.txt`.

### 3. API key auth module — `backend/app/auth/`

Create `backend/app/auth/__init__.py` and `backend/app/auth/api_key.py`:
- Parse Bearer token from Authorization header
- Compute SHA256 hash of the API key
- Look up key_hash in api_keys table
- Verify is_active = true
- Load user_profiles (tier, monthly_credit_limit)
- Check rate limit and remaining credits (credits_limit - usage_monthly.credits_used)
- Return an AuthContext dataclass with user_id, api_key_id, tier, credits_remaining, rate_limit_per_sec
- On failure return proper 401/403/429 HTTP errors
- Expose as a FastAPI dependency: `require_api_key`

API key format: `cerul_sk_` + 32 random chars. Only the SHA256 hash is stored.

### 4. API key management helpers — `backend/app/auth/key_manager.py`

- create_api_key(user_id, name) -> returns (key_id, raw_key) — the raw key is shown once
- revoke_api_key(key_id, user_id) -> soft-delete by setting is_active=false
- list_api_keys(user_id) -> returns key metadata (id, name, prefix, created_at, last_used_at) without hashes

### 5. Tests — `backend/tests/`

Create `backend/tests/test_auth.py`:
- Test API key parsing (valid format, missing header, malformed token)
- Test SHA256 hash computation matches expected value
- Test AuthContext construction from mock DB row

### 6. Wire into FastAPI

Update `backend/app/main.py`:
- Add startup/shutdown events for DB pool lifecycle
- Do NOT add new routers yet (other tasks will do that)

## Constraints

- Python, snake_case, 4-space indent
- Only modify files within the scope listed above
- Do NOT touch frontend/, workers/, config/, docs/
- If you start the backend to verify, use port 9101: `--port 9101`
- Do not commit .env or any real credentials
```

### Acceptance Criteria

- [ ] `db/migrations/001_initial_schema.sql` matches ARCHITECTURE.md section 8.2
- [ ] `backend/app/db/connection.py` creates async pool from DATABASE_URL
- [ ] `backend/app/auth/api_key.py` exposes `require_api_key` FastAPI dependency
- [ ] `backend/app/auth/key_manager.py` has create/revoke/list functions
- [ ] `backend/tests/test_auth.py` passes with `pytest backend/tests/test_auth.py`
- [ ] `backend/app/main.py` has startup/shutdown lifecycle for DB pool
- [ ] No files outside scope are modified

---

## Task 2: Search API Endpoints

**Branch**: `codex/feature-search-api`

**Scope**: `backend/app/routers/search.py`, `backend/app/routers/usage.py`, `backend/app/search/`, `backend/app/billing/`

**Purpose**: Implement the two public API endpoints (`POST /v1/search` and `GET /v1/usage`) and the search orchestration + billing logic.

**Port**: Backend on `9102` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the public search and usage API endpoints with their service layers.

Read these files first for full context:
- ARCHITECTURE.md (sections 6, 7, 9 for API spec, auth flow, search design)
- docs/api-reference.md (exact request/response contracts)
- AGENTS.md (coding conventions)
- backend/app/main.py (current FastAPI entrypoint)

## Important

This task assumes that `backend/app/db/` and `backend/app/auth/` exist as dependencies.
Since another worktree is building those in parallel, you should:
- Create minimal stub files for the dependencies you need (db connection, auth dependency)
- Put stubs in `backend/app/db/__init__.py` and `backend/app/auth/__init__.py`
- Mark stubs clearly with `# STUB: replaced by codex/feature-db-auth` comments
- Your code should work with the real implementations once merged

## Deliverables

### 1. Request/Response models — `backend/app/search/models.py`

Pydantic models matching the API spec in docs/api-reference.md:
- SearchRequest: query, search_type (broll|knowledge), max_results, include_answer, filters
- BrollFilters: min_duration, max_duration, source
- KnowledgeFilters: speaker, published_after
- SearchResult: id, score, title, description, video_url, thumbnail_url, duration, source, license
- KnowledgeResult(SearchResult): timestamp_start, timestamp_end, answer
- SearchResponse: results, credits_used, credits_remaining, request_id
- UsageResponse: tier, period_start, period_end, credits_limit, credits_used, credits_remaining, rate_limit_per_sec, api_keys_active
- ErrorResponse: error.code, error.message

### 2. Search router — `backend/app/routers/search.py`

POST /v1/search:
- Depends on require_api_key for auth
- Validate request body
- Generate request_id (format: req_ + 24 char random)
- Route to BrollSearchService or KnowledgeSearchService based on search_type
- On success: write usage_event + usage_monthly + query_log in one transaction
- Return SearchResponse
- On search failure: do NOT deduct credits

### 3. Usage router — `backend/app/routers/usage.py`

GET /v1/usage:
- Depends on require_api_key for auth
- Query usage_monthly for current period
- Count active api_keys
- Return UsageResponse

### 4. Search service layer — `backend/app/search/`

Create `backend/app/search/__init__.py`, `backend/app/search/broll.py`, `backend/app/search/knowledge.py`:

BrollSearchService:
- Accept SearchRequest + db connection
- Build pgvector cosine similarity query against broll_assets
- Apply filters (source, duration range)
- Return top-N candidates
- Apply MMR diversification (lambda=0.75 from config)
- For now: implement the SQL query structure, use a placeholder for CLIP embedding generation
  (accept a list[float] as the query vector, don't call CLIP directly)

KnowledgeSearchService:
- Similar structure against knowledge_segments
- Apply filters (speaker, published_after via join to knowledge_videos)
- Placeholder for text-embedding-3-small vector
- Placeholder for LLM rerank step
- Placeholder for answer generation when include_answer=true

### 5. Billing helpers — `backend/app/billing/credits.py`

- deduct_credits(db, user_id, api_key_id, request_id, search_type, include_answer) -> credits_used
- Credits cost: broll=1, knowledge=2, knowledge+answer=3
- Write usage_events row and update usage_monthly atomically
- Idempotent on request_id (don't double-charge)

### 6. Tests — `backend/tests/`

Create `backend/tests/test_search_models.py`:
- Test SearchRequest validation (missing query, invalid search_type, max_results bounds)
- Test credits calculation for each search_type

Create `backend/tests/test_credits.py`:
- Test deduct_credits returns correct amount per search_type
- Test idempotency on duplicate request_id

### 7. Wire into FastAPI

Update `backend/app/main.py` to include the search and usage routers.

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above (+ main.py router registration)
- Do NOT implement actual CLIP/OpenAI API calls — use placeholder vectors
- Do NOT touch frontend/, workers/, db/migrations/, config/
- If you start the backend to verify, use port 9102: `--port 9102`
```

### Acceptance Criteria

- [ ] `POST /v1/search` accepts requests matching docs/api-reference.md
- [ ] `GET /v1/usage` returns usage stats for authenticated user
- [ ] Pydantic models validate all fields per API spec
- [ ] BrollSearchService builds correct pgvector SQL with filters
- [ ] KnowledgeSearchService builds correct pgvector SQL with filters
- [ ] Credits deduction is atomic and idempotent
- [ ] Tests pass with `pytest backend/tests/test_search_models.py backend/tests/test_credits.py`
- [ ] No files outside scope are modified

---

## Task 3: B-roll Indexing Pipeline

**Branch**: `codex/feature-broll-pipeline`

**Scope**: `workers/`, `backend/app/embedding/`

**Purpose**: Implement the B-roll content discovery and indexing pipeline — the first end-to-end data ingestion flow.

**Port**: Backend on `9103` if you need to start any service for testing.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the B-roll indexing pipeline and embedding abstraction layer.

Read these files first for full context:
- ARCHITECTURE.md (sections 10 and 11 for pipeline pattern and embedding design)
- PIPELINE_PATTERN.md (detailed pipeline pattern documentation)
- AGENTS.md (coding conventions)
- .env.example (PEXELS_API_KEY, PIXABAY_API_KEY, OPENAI_API_KEY)
- config/base.yaml (search config values)

## Deliverables

### 1. Pipeline infrastructure — `workers/common/pipeline/`

Create `workers/common/__init__.py`, `workers/common/pipeline/__init__.py`,
`workers/common/pipeline/context.py`, `workers/common/pipeline/step.py`,
`workers/common/pipeline/executor.py`:

Implement exactly the pattern from ARCHITECTURE.md section 10.2:
- PipelineContext dataclass (conf, data dict, skip flags)
- PipelineStep ABC (name, run, _preprocess, _process, _postprocess)
- PipelineExecutor: takes list of steps, runs them sequentially, handles skip flags,
  logs step start/end/skip, catches exceptions and records which step failed

### 2. Embedding abstraction — `backend/app/embedding/`

Create `backend/app/embedding/__init__.py`, `backend/app/embedding/base.py`,
`backend/app/embedding/clip.py`:

EmbeddingBackend protocol (from ARCHITECTURE.md 11.1):
- name, dimension(), embed_text(), embed_image()

ClipEmbeddingBackend:
- Uses OpenAI CLIP ViT-B/32 via the `open_clip` library
- dimension() returns 512
- embed_text(text) -> list[float]
- embed_image(image_path) -> list[float]
- Lazy model loading (load on first call, not on import)
- Add open-clip-torch and Pillow to a new `workers/requirements.txt`

### 3. B-roll pipeline steps — `workers/broll/`

Create `workers/broll/__init__.py`, `workers/broll/pipeline.py`,
`workers/broll/steps/` directory with one file per step:

Implement the 6-step pipeline from ARCHITECTURE.md 10.3:

a) `DiscoverAssetStep`: Query Pexels/Pixabay API for assets matching a query/category.
   Write discovered asset metadata to context.data["raw_assets"].

b) `FetchAssetMetadataStep`: For each raw asset, normalize metadata into a common schema
   (id, source, source_url, thumbnail_url, video_url, duration, title, tags, license, creator).
   Skip assets already in DB (check by source + source_asset_id). Write to context.data["assets"].

c) `DownloadPreviewFrameStep`: Download thumbnail or preview image for each asset.
   Save to a temp directory. Write paths to context.data["frame_paths"].

d) `GenerateClipEmbeddingStep`: Use ClipEmbeddingBackend to generate 512-dim embeddings
   from the preview frames. Write to context.data["embeddings"].

e) `PersistBrollAssetStep`: Upsert each asset + embedding into broll_assets table.
   Use ON CONFLICT (source, source_asset_id) DO UPDATE for idempotency.

f) `MarkJobCompletedStep`: Update processing_jobs status to 'completed'.
   Record step artifacts if applicable.

Create `workers/broll/pipeline.py` that assembles steps into a BrollIndexingPipeline.

### 4. Content API clients — `workers/common/sources/`

Create `workers/common/sources/__init__.py`,
`workers/common/sources/pexels.py`, `workers/common/sources/pixabay.py`:

PexelsClient:
- search_videos(query, per_page=50) -> list of raw asset dicts
- Uses PEXELS_API_KEY from env

PixabayClient:
- search_videos(query, per_page=50) -> list of raw asset dicts
- Uses PIXABAY_API_KEY from env

Both should use httpx for async HTTP.

### 5. Seed script — `scripts/seed_broll.py`

A simple CLI script that:
- Takes a search query as argument
- Runs the BrollIndexingPipeline for that query
- Prints summary (N assets discovered, N new, N indexed)
- Usage: `python scripts/seed_broll.py "cinematic drone shot"`

### 6. Tests — `workers/tests/`

Create `workers/tests/test_pipeline.py`:
- Test PipelineExecutor runs steps in order
- Test skip_current_step skips one step
- Test skip_all_following_steps stops execution
- Test step failure is caught and recorded

Create `workers/tests/test_broll_steps.py`:
- Test FetchAssetMetadataStep normalizes Pexels response correctly
- Test FetchAssetMetadataStep normalizes Pixabay response correctly
- Test GenerateClipEmbeddingStep produces 512-dim vector (can mock the model)

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above
- Do NOT touch frontend/, backend/app/routers/, backend/app/search/, db/migrations/
- For DB operations, create minimal stubs if needed, marked with # STUB comments
- If you start any service to verify, use port 9103: `--port 9103`
- Handle API keys from environment, never hardcode
```

### Acceptance Criteria

- [ ] `workers/common/pipeline/` implements the full Step Pipeline pattern
- [ ] `backend/app/embedding/clip.py` wraps CLIP with the EmbeddingBackend protocol
- [ ] All 6 B-roll pipeline steps are implemented in `workers/broll/steps/`
- [ ] Pexels and Pixabay API clients handle real API responses
- [ ] `scripts/seed_broll.py` can be run end-to-end (with valid API keys)
- [ ] Tests pass with `pytest workers/tests/`
- [ ] No files outside scope are modified

---

## Task 4: Dashboard Private API

**Branch**: `codex/feature-dashboard-api`

**Scope**: `backend/app/routers/dashboard.py`, `backend/app/routers/webhooks.py`, `backend/app/billing/`

**Purpose**: Implement the dashboard-facing private API endpoints for API key management, usage stats, and Stripe billing.

**Port**: Backend on `9104` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the private dashboard API endpoints and Stripe billing integration.

Read these files first for full context:
- ARCHITECTURE.md (sections 6.4, 7 for dashboard endpoints and billing)
- AGENTS.md (coding conventions)
- backend/app/main.py (current FastAPI entrypoint)
- .env.example (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID)

## Important

This task assumes `backend/app/db/` and `backend/app/auth/` exist from another worktree.
Create minimal stubs if needed, marked with `# STUB: replaced by codex/feature-db-auth`.

Dashboard endpoints use session-based auth (Better Auth), not API key auth.
For this task, create a placeholder `require_session` dependency that extracts user_id
from a cookie or header. Mark it as `# STUB: integrate with Better Auth`.

## Deliverables

### 1. Dashboard API key endpoints — `backend/app/routers/dashboard.py`

POST /dashboard/api-keys:
- Create a new API key for the authenticated user
- Check key count limit per tier (free=1, pro=5)
- Return key_id + raw_key (shown once)

GET /dashboard/api-keys:
- List all API keys for the user (id, name, prefix, created_at, last_used_at, is_active)
- Never return key_hash

DELETE /dashboard/api-keys/{id}:
- Soft-delete (set is_active=false)
- Verify the key belongs to the authenticated user

GET /dashboard/usage/monthly:
- Return monthly usage breakdown for the current billing period
- Include: credits_used, credits_remaining, request_count, daily breakdown (last 30 days)

### 2. Stripe billing endpoints — `backend/app/routers/dashboard.py` (continued)

POST /dashboard/billing/checkout:
- Create a Stripe Checkout Session for upgrading to Pro tier
- Use STRIPE_PRO_PRICE_ID from env
- Return checkout URL

POST /dashboard/billing/portal:
- Create a Stripe Customer Portal session for managing subscription
- Return portal URL

### 3. Stripe webhook handler — `backend/app/routers/webhooks.py`

POST /webhooks/stripe:
- Verify webhook signature using STRIPE_WEBHOOK_SECRET
- Log raw event to stripe_events table (idempotent on stripe_event_id)
- Handle events:
  - checkout.session.completed -> set user tier to 'pro', update monthly_credit_limit
  - customer.subscription.deleted -> set user tier to 'free', reset monthly_credit_limit
  - customer.subscription.updated -> sync tier and limits
- All event processing must be idempotent

### 4. Billing service — `backend/app/billing/stripe_service.py`

- create_checkout_session(user_id, email) -> session_url
- create_portal_session(stripe_customer_id) -> portal_url
- sync_subscription_status(stripe_customer_id, subscription) -> updates user_profiles
- Wrap all Stripe SDK calls in this module, don't leak stripe objects into routers

Add stripe to `backend/requirements.txt`.

### 5. Tests — `backend/tests/`

Create `backend/tests/test_dashboard.py`:
- Test API key creation respects tier limits
- Test API key deletion requires ownership
- Test usage endpoint returns correct period dates

Create `backend/tests/test_stripe_webhook.py`:
- Test webhook signature verification (valid and invalid)
- Test checkout.session.completed updates user tier
- Test idempotency (same stripe_event_id processed twice is safe)

### 6. Wire into FastAPI

Update `backend/app/main.py` to include dashboard and webhook routers.

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above (+ main.py router registration)
- Do NOT touch frontend/, workers/, db/migrations/
- If you start the backend to verify, use port 9104: `--port 9104`
- Never log or expose raw API keys after creation
- Stripe webhook must verify signature before processing
```

### Acceptance Criteria

- [ ] All 6 dashboard endpoints implemented per ARCHITECTURE.md 6.4
- [ ] Stripe Checkout and Portal session creation works
- [ ] Webhook handler verifies signature and is idempotent
- [ ] API key creation enforces per-tier limits
- [ ] API key deletion verifies ownership
- [ ] Tests pass with `pytest backend/tests/test_dashboard.py backend/tests/test_stripe_webhook.py`
- [ ] No files outside scope are modified

---

## Task 5: Frontend Dashboard (Real Data)

**Branch**: `codex/feature-dashboard-ui`

**Scope**: `frontend/app/dashboard/`, `frontend/components/dashboard/`, `frontend/lib/`

**Purpose**: Replace the mock dashboard UI with real components that call the backend Dashboard API.

**Port**: Frontend on `9150` (`pnpm --dir frontend dev -- --port 9150`).

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to upgrade the frontend dashboard from static mock pages to real,
interactive components that call backend API endpoints.

Read these files first for full context:
- ARCHITECTURE.md (section 6.4 for dashboard API endpoints)
- AGENTS.md (coding conventions)
- frontend/app/dashboard/ (all existing pages)
- frontend/components/ (existing component library)
- frontend/lib/ (existing utilities)

## Important

The backend Dashboard API is being built in parallel (endpoints listed below).
Build the frontend to call these endpoints. Use a configurable API base URL
from NEXT_PUBLIC_API_BASE_URL environment variable (default: http://localhost:9104,
matching the Dashboard API worktree port).

Dashboard API endpoints your frontend should consume:
- POST   /dashboard/api-keys          -> create API key
- GET    /dashboard/api-keys          -> list API keys
- DELETE /dashboard/api-keys/{id}     -> revoke API key
- GET    /dashboard/usage/monthly     -> usage statistics
- POST   /dashboard/billing/checkout  -> get Stripe checkout URL
- POST   /dashboard/billing/portal    -> get Stripe portal URL

## Deliverables

### 1. API client — `frontend/lib/api.ts`

Create a typed API client:
- fetchWithAuth(path, options) — adds credentials/cookies, handles errors
- apiKeys.create(name), apiKeys.list(), apiKeys.revoke(id)
- usage.getMonthly()
- billing.createCheckout(), billing.createPortal()
- Proper TypeScript types for all request/response shapes
- Error handling: parse error.code and error.message from API responses

### 2. Dashboard overview — `frontend/app/dashboard/page.tsx`

Replace mock content with:
- Credit usage summary card (used / remaining / limit)
- Simple usage chart (last 7 days, use a lightweight approach — CSS bars or similar,
  no heavy charting library unless one is already installed)
- Quick actions: "Create API Key", "View Docs", "Upgrade Plan"
- Loading and error states

### 3. API Keys page — `frontend/app/dashboard/keys/page.tsx`

Replace mock content with:
- Table of API keys (name, prefix, created date, last used, status)
- "Create Key" button -> modal/dialog with name input -> shows raw key ONCE with copy button
- "Revoke" button per key with confirmation
- Empty state when no keys exist
- Loading and error states

### 4. Usage page — `frontend/app/dashboard/usage/page.tsx`

Replace mock content with:
- Current period summary (tier, credits used/remaining, request count)
- Daily usage bar chart for the current billing period
- Loading and error states

### 5. Settings page — `frontend/app/dashboard/settings/page.tsx`

Replace mock content with:
- Current plan display (Free / Pro / Enterprise)
- "Upgrade to Pro" button -> calls billing.createCheckout() -> redirects to Stripe
- "Manage Subscription" button (visible for Pro/Enterprise) -> calls billing.createPortal()
- Loading state

### 6. Shared components — `frontend/components/dashboard/`

Create reusable components:
- CreditUsageBar: visual progress bar showing credits used vs limit
- ApiKeyRow: table row for a single API key with actions
- CreateKeyDialog: modal for creating a new API key
- UsageChart: simple daily usage visualization

## Constraints

- TypeScript, React 19, Next.js App Router, Tailwind CSS v4
- 2-space indent
- Only modify/create files within the scope listed above
- Do NOT touch backend/, workers/, db/, config/
- Do NOT install new npm packages unless strictly necessary
- Match existing visual style (check existing components for patterns)
- Use existing fonts (Space Grotesk, JetBrains Mono) and color scheme
- When running dev server, use port 9150: `pnpm --dir frontend dev -- --port 9150`
- Ensure all components handle loading, error, and empty states
```

### Acceptance Criteria

- [ ] `frontend/lib/api.ts` provides typed client for all dashboard endpoints
- [ ] Dashboard overview shows real usage data with loading/error states
- [ ] API Keys page supports full CRUD lifecycle (create, list, revoke)
- [ ] Raw API key is displayed exactly once after creation with copy functionality
- [ ] Usage page shows daily breakdown chart
- [ ] Settings page has working Stripe upgrade/portal buttons
- [ ] All pages handle loading, error, and empty states gracefully
- [ ] `pnpm --dir frontend build` succeeds without errors
- [ ] No files outside scope are modified

---

## Merge Order

These tasks are designed to be merged in sequence once all are complete:

1. **Task 1** (DB + Auth) — merge first, it's the foundation
2. **Task 2** (Search API) — depends on Task 1 stubs being replaced
3. **Task 4** (Dashboard API) — depends on Task 1 stubs being replaced
4. **Task 3** (B-roll Pipeline) — depends on Task 1 for DB writes
5. **Task 5** (Frontend Dashboard) — independent of backend merge order, but needs Task 4 API to test

After merging, remove all `# STUB` markers and run full integration tests.

---

## Notes for All Tasks

- Read AGENTS.md before writing any code — it defines naming, style, and boundary rules.
- Branch naming convention: `codex/<type>-<scope>` (e.g., `codex/feature-search-api`).
- Commit messages: short, imperative, English (e.g., "Add search API with pgvector retrieval").
- Do NOT create .env files with real secrets.
- Do NOT modify ARCHITECTURE.md, AGENTS.md, README.md, or PIPELINE_PATTERN.md.
- Each PR should include a summary of changes, affected directories, and test status.
