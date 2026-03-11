# Cerul Parallel Sprint Round 3 — Codex Task Prompts

This document contains 4 independent task prompts designed to run in parallel worktrees.
Each task has clear scope, no cross-task file conflicts, and explicit acceptance criteria.

> **Port allocation**: Ports are placed in the 9200-9300 range to avoid conflicts.
>
> | Worktree | Frontend | Backend |
> |----------|----------|---------|
> | Task 1 (T08 Answer Gen) | — | 9201 |
> | Task 2 (T09 Scheduler) | — | 9202 |
> | Task 3 (T10 Worker) | — | 9203 |
> | Task 4 (T11 B-roll Scale) | — | 9204 |
>
> When starting servers, **always specify the port explicitly** (e.g. `--port 9201`).
> Do NOT use default ports (3000 / 8000).

---

## Task 1: Knowledge Search Answer Generation (T08)

**Branch**: `codex/feat-knowledge-answer`

**Scope**: `backend/app/search/knowledge.py`, `backend/app/search/answer.py` (new), `backend/app/search/rerank.py` (new), `backend/tests/test_search_services.py`

**Purpose**: Replace the stub `_placeholder_rerank()` and `_placeholder_answer()` in `KnowledgeSearchService` with real LLM-based reranking and answer generation.

**Port**: Backend on `9201` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement LLM-based reranking and answer generation for the Knowledge search pipeline.

Read these files first for full context:
- ARCHITECTURE.md (section 9.2 and 9.3 for Knowledge search design)
- AGENTS.md (coding conventions)
- backend/app/search/knowledge.py (current implementation with placeholder stubs)
- backend/app/search/base.py (shared search utilities: MMR, vector helpers)
- backend/app/search/models.py (KnowledgeResult, SearchResponse models)
- backend/app/search/broll.py (reference: how BrollSearchService is structured)
- config/base.yaml (knowledge.rerank_top_n, knowledge.rerank_prompt_template)

## Current State

`backend/app/search/knowledge.py` has a working search flow:
1. resolve_query_vector() — generates real 768-dim Gemini embedding ✅
2. _fetch_rows() — pgvector cosine similarity retrieval ✅
3. _placeholder_rerank() — STUB: just sorts by score (needs replacement)
4. mmr_diversify() — MMR diversification ✅
5. _placeholder_answer() — STUB: returns generic template (needs replacement)

The search flow works end-to-end with placeholders. Your job is to replace
steps 3 and 5 with real LLM implementations.

## Deliverables

### 1. LLM Rerank module — `backend/app/search/rerank.py`

Create a reranker that uses an LLM to reorder candidate segments by relevance:

- `LLMReranker` class with async `rerank(query, candidates, top_n)` method
- Takes top-N candidates from vector retrieval (default top_n from config: knowledge.rerank_top_n)
- For each candidate, constructs a prompt with the query + segment transcript + visual description
- Calls the LLM to score relevance (0-10) for each candidate
- Returns candidates reordered by LLM relevance score
- Use httpx to call the LLM API (OpenAI-compatible endpoint via OPENAI_API_KEY env var, model gpt-4o-mini for cost efficiency)
- Include a `RerankerBackend` Protocol so implementations can be swapped
- Handle API errors gracefully: if reranking fails, fall back to original vector score ordering

### 2. Answer generation module — `backend/app/search/answer.py`

Create an answer generator that synthesizes answers from retrieved segments:

- `AnswerGenerator` class with async `generate(query, segments)` method
- Takes the final top-K segments (after rerank + MMR)
- Constructs a prompt with:
  - The user's query
  - Each segment's transcript text and visual description
  - Each segment's video title, speaker, and timestamp range
- Calls the LLM (gpt-4o via OPENAI_API_KEY) to generate a synthesized answer
- The answer must cite sources using timestamp references (e.g., "[Video Title, 2:30-3:45]")
- Include an `AnswerBackend` Protocol for swappability
- Handle API errors: if generation fails, return None (search results still returned without answer)
- Only called when `include_answer=True` in the search request

### 3. Update KnowledgeSearchService — `backend/app/search/knowledge.py`

- Replace `_placeholder_rerank()` with `LLMReranker.rerank()`
- Replace `_placeholder_answer()` with `AnswerGenerator.generate()`
- Inject reranker and answer_generator via constructor (with defaults)
- Ensure `include_answer=False` requests skip the answer generation step entirely (no LLM call)
- Log reranking and answer generation timings

### 4. Tests — `backend/tests/test_search_services.py`

Add tests to the existing test file:
- Test LLMReranker reorders candidates by LLM score (mock the HTTP call)
- Test LLMReranker falls back to original order on API error
- Test AnswerGenerator produces answer with citations (mock the HTTP call)
- Test AnswerGenerator returns None on API error
- Test KnowledgeSearchService skips answer generation when include_answer=False
- Test KnowledgeSearchService includes answer when include_answer=True

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above
- Do NOT touch frontend/, workers/, db/migrations/, config/
- Use httpx for LLM API calls (already a backend dependency), NOT the openai SDK
- Add OPENAI_API_KEY to .env.example if not present
- If you start the backend to verify, use port 9201: `--port 9201`
- Do not commit .env or any real credentials
```

### Acceptance Criteria

- [ ] `backend/app/search/rerank.py` implements LLM-based reranking with Protocol interface
- [ ] `backend/app/search/answer.py` implements LLM-based answer generation with citations
- [ ] `_placeholder_rerank()` and `_placeholder_answer()` are fully replaced
- [ ] `include_answer=False` requests make zero LLM calls for answer generation
- [ ] Rerank and answer generation gracefully handle API failures
- [ ] Tests pass with `pytest backend/tests/test_search_services.py -v`
- [ ] No files outside scope are modified

---

## Task 2: Scheduler Automation (T09)

**Branch**: `codex/feat-scheduler`

**Scope**: `workers/scheduler.py` (new), `workers/tests/test_scheduler.py` (new)

**Purpose**: Implement a scheduler that automatically discovers new content from `content_sources` and creates `processing_jobs` for the worker to pick up.

**Port**: Backend on `9202` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the content discovery scheduler that automatically creates processing jobs.

Read these files first for full context:
- ARCHITECTURE.md (section 10.5 for content discovery layer, 10.6 for job state machine)
- AGENTS.md (coding conventions)
- db/migrations/001_initial_schema.sql (content_sources and processing_jobs table schemas)
- workers/knowledge/pipeline.py (KnowledgeIndexingPipeline — what jobs eventually run)
- workers/broll/pipeline.py (BrollIndexingPipeline — what jobs eventually run)
- workers/common/sources/youtube.py (YouTubeClient for discovering YouTube videos)
- workers/common/sources/pexels.py (PexelsClient for discovering B-roll)
- workers/common/sources/pixabay.py (PixabayClient for discovering B-roll)
- scripts/seed_broll.py (reference: current manual seeding approach)
- scripts/seed_knowledge.py (reference: current manual seeding approach)

## Current State

- `content_sources` table exists with columns: id, track (broll/knowledge), source_type,
  slug, config (JSONB), sync_cursor (TEXT), is_active, created_at
- `processing_jobs` table exists with columns: id, track, source_id (FK to content_sources),
  job_type, status, input_payload (JSONB), started_at, completed_at, error_message
- Status values: 'pending', 'running', 'completed', 'failed'
- YouTube, Pexels, and Pixabay API clients already exist in workers/common/sources/
- No scheduler logic exists yet — content is seeded manually via scripts/

## Deliverables

### 1. Scheduler implementation — `workers/scheduler.py`

Implement a `ContentScheduler` class:

- `async def run_once(db)`: Single scan cycle:
  1. Query all active content_sources (is_active=true)
  2. For each source, discover new content since sync_cursor:
     - For YouTube sources (track=knowledge): use YouTubeClient.search_channel_videos()
       with channel_id from source config, filter videos published after sync_cursor
     - For Pexels sources (track=broll): use PexelsClient.search_videos()
       with query from source config
     - For Pixabay sources (track=broll): use PixabayClient.search_videos()
       with query from source config
  3. For each discovered item, check if a processing_job already exists
     (by track + source_id + input_payload->>'source_item_id')
  4. If no existing job, INSERT a new processing_job with status='pending'
     and input_payload containing the item metadata
  5. Update content_sources.sync_cursor to the latest item's timestamp/ID
  6. Return a summary: {source_slug: {discovered: N, new_jobs: N, skipped: N}}

- `async def run_loop(db, interval_seconds=300)`: Continuous loop:
  1. Call run_once()
  2. Log summary
  3. Sleep for interval_seconds
  4. Repeat
  5. Handle graceful shutdown on SIGTERM/SIGINT

- Deduplication: Never create duplicate jobs for the same content item.
  Use a query like:
  ```sql
  SELECT 1 FROM processing_jobs
  WHERE source_id = $1 AND input_payload->>'source_item_id' = $2
  ```

- CLI entrypoint at bottom of file:
  ```python
  if __name__ == "__main__":
      asyncio.run(main())
  ```
  with --once flag for single run, default is loop mode.

### 2. Tests — `workers/tests/test_scheduler.py`

- Test run_once creates jobs for new content items
- Test run_once skips already-existing jobs (deduplication)
- Test run_once updates sync_cursor after successful scan
- Test run_once handles source client errors gracefully (skip source, continue others)
- Test run_once only processes active sources (is_active=true)
- Mock all external API clients and database calls

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above
- Do NOT touch frontend/, backend/, db/migrations/, config/
- Use asyncpg for database operations (consistent with the rest of the project)
- Use existing API clients from workers/common/sources/ — do not rewrite them
- If you start any service to verify, use port 9202: `--port 9202`
- Do not commit .env or any real credentials
```

### Acceptance Criteria

- [ ] `workers/scheduler.py` implements `ContentScheduler` with `run_once()` and `run_loop()`
- [ ] Scheduler discovers content from YouTube, Pexels, and Pixabay sources
- [ ] New processing_jobs are created with status='pending' and correct input_payload
- [ ] Deduplication prevents duplicate jobs for the same content item
- [ ] sync_cursor is updated after each successful scan
- [ ] Graceful shutdown on SIGTERM/SIGINT in loop mode
- [ ] Tests pass with `pytest workers/tests/test_scheduler.py -v`
- [ ] No files outside scope are modified

---

## Task 3: Worker Retry Mechanism (T10)

**Branch**: `codex/feat-worker-retry`

**Scope**: `workers/worker.py` (new), `workers/tests/test_worker.py` (new), `db/migrations/003_worker_retry.sql` (new)

**Purpose**: Implement the worker process that claims pending jobs from `processing_jobs`, executes the appropriate pipeline, and handles failures with exponential backoff retry.

**Port**: Backend on `9203` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to implement the worker process with job claiming, pipeline execution, and retry logic.

Read these files first for full context:
- ARCHITECTURE.md (section 10.6 for job state machine)
- AGENTS.md (coding conventions)
- PIPELINE_PATTERN.md (pipeline execution pattern)
- db/migrations/001_initial_schema.sql (processing_jobs and processing_job_steps tables)
- workers/knowledge/pipeline.py (KnowledgeIndexingPipeline)
- workers/broll/pipeline.py (BrollIndexingPipeline)
- workers/common/pipeline/executor.py (PipelineExecutor)
- workers/common/pipeline/context.py (PipelineContext)

## Current State

- `processing_jobs` table exists with status CHECK ('pending', 'running', 'completed', 'failed')
- `processing_job_steps` table exists for per-step tracking
- Both KnowledgeIndexingPipeline and BrollIndexingPipeline are fully implemented
- PipelineExecutor can run any pipeline given a list of steps
- No worker process exists yet — jobs sit in 'pending' state with nothing to pick them up

## Important — Migration needed

The current `processing_jobs` schema lacks columns needed for retry logic. Create a migration
to add them. The existing status CHECK constraint needs to be updated to include 'retrying'.

## Deliverables

### 1. Migration — `db/migrations/003_worker_retry.sql`

Add retry-related columns to processing_jobs:
```sql
ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS attempts       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts   INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS locked_by      TEXT,
  ADD COLUMN IF NOT EXISTS locked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ;

-- Update status check to include 'retrying'
ALTER TABLE processing_jobs
  DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
ALTER TABLE processing_jobs
  ADD CONSTRAINT processing_jobs_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'retrying'));
```

### 2. Worker implementation — `workers/worker.py`

Implement a `JobWorker` class:

- `__init__(self, worker_id, db_url, poll_interval=5)`:
  - worker_id: unique identifier for this worker instance (e.g., hostname + PID)
  - db_url: asyncpg connection string
  - poll_interval: seconds between poll attempts when no jobs found

- `async def claim_job(conn) -> dict | None`:
  Use PostgreSQL advisory locking for safe job claiming:
  ```sql
  UPDATE processing_jobs
  SET status = 'running',
      locked_by = $1,
      locked_at = NOW(),
      attempts = attempts + 1,
      started_at = COALESCE(started_at, NOW())
  WHERE id = (
      SELECT id FROM processing_jobs
      WHERE status IN ('pending', 'retrying')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY
        CASE WHEN status = 'retrying' THEN 0 ELSE 1 END,
        created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
  )
  RETURNING *;
  ```

- `async def execute_job(conn, job) -> None`:
  1. Determine pipeline by job.track: 'broll' → BrollIndexingPipeline, 'knowledge' → KnowledgeIndexingPipeline
  2. Build PipelineContext from job.input_payload
  3. Run pipeline via PipelineExecutor
  4. On success: update job status to 'completed', set completed_at
  5. On failure: call handle_failure()

- `async def handle_failure(conn, job, error) -> None`:
  1. If job.attempts < job.max_attempts:
     - Set status = 'retrying'
     - Calculate next_retry_at with exponential backoff: NOW() + (2^attempts * 30 seconds)
     - Cap max backoff at 1 hour
     - Set error_message to str(error)
  2. If job.attempts >= job.max_attempts:
     - Set status = 'failed'
     - Set error_message to str(error)
  3. Record failed step in processing_job_steps if pipeline context has failure info

- `async def record_step_progress(conn, job_id, context) -> None`:
  After pipeline execution (success or failure), write step results to processing_job_steps:
  - For each completed step: status='completed', artifacts from context
  - For skipped steps: status='skipped'
  - For failed step: status='failed', artifacts includes error message

- `async def run_loop() -> None`:
  1. Connect to database
  2. Loop: claim_job() → execute_job() → record_step_progress()
  3. If no job found, sleep for poll_interval
  4. Handle graceful shutdown on SIGTERM/SIGINT
  5. On shutdown, release any locked job (set status back to 'pending', clear locked_by/locked_at)

- CLI entrypoint:
  ```python
  if __name__ == "__main__":
      asyncio.run(main())
  ```
  with --worker-id and --poll-interval flags.

### 3. Tests — `workers/tests/test_worker.py`

- Test claim_job picks up pending job and sets status to 'running'
- Test claim_job skips locked jobs (FOR UPDATE SKIP LOCKED behavior)
- Test claim_job picks up retrying jobs when next_retry_at has passed
- Test claim_job ignores retrying jobs when next_retry_at is in the future
- Test execute_job marks job as 'completed' on pipeline success
- Test handle_failure sets 'retrying' with exponential backoff when attempts < max_attempts
- Test handle_failure sets 'failed' when attempts >= max_attempts
- Test backoff calculation: 30s, 60s, 120s (capped at 1 hour)
- Test record_step_progress writes correct step statuses
- Mock database and pipeline execution for all tests.

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above
- Do NOT touch frontend/, backend/app/, config/
- Use asyncpg for database operations
- Use existing pipeline infrastructure (PipelineExecutor, PipelineContext)
- Do NOT modify existing pipeline steps or executor
- If you start any service to verify, use port 9203: `--port 9203`
- Do not commit .env or any real credentials
```

### Acceptance Criteria

- [ ] `db/migrations/003_worker_retry.sql` adds retry columns and updates status constraint
- [ ] `workers/worker.py` implements `JobWorker` with claim/execute/retry logic
- [ ] Job claiming uses `FOR UPDATE SKIP LOCKED` for concurrent safety
- [ ] Failed jobs retry with exponential backoff (30s base, 1h cap)
- [ ] Jobs exceeding max_attempts are marked 'failed' permanently
- [ ] Step progress is recorded in processing_job_steps
- [ ] Graceful shutdown releases locked jobs
- [ ] Tests pass with `pytest workers/tests/test_worker.py -v`
- [ ] No files outside scope are modified

---

## Task 4: B-roll Scale to 100K (T11)

**Branch**: `codex/feat-broll-scale`

**Scope**: `scripts/seed_broll.py`, `scripts/broll_queries.txt` (new), `workers/broll/pipeline.py`, `workers/broll/repository.py` (new)

**Purpose**: Enhance the B-roll seeding infrastructure to support batch ingestion of 100K+ assets with real database persistence, pagination, and resume capability.

**Port**: Backend on `9204` if you need to verify startup.

### Prompt

```
You are working on the Cerul project — a video understanding search API.
Your task is to scale the B-roll ingestion pipeline to support batch processing of 100K+ assets.

Read these files first for full context:
- ARCHITECTURE.md (section 10.3 for B-roll pipeline)
- AGENTS.md (coding conventions)
- scripts/seed_broll.py (current seed script — uses InMemoryBrollAssetRepository)
- workers/broll/pipeline.py (BrollIndexingPipeline with all 6 steps)
- workers/broll/steps/ (all step implementations)
- workers/common/sources/pexels.py (PexelsClient)
- workers/common/sources/pixabay.py (PixabayClient)
- workers/knowledge/repository.py (reference: KnowledgeRepository pattern with async DB)
- db/migrations/001_initial_schema.sql (broll_assets table schema)

## Current State

- BrollIndexingPipeline has all 6 steps implemented and tested
- seed_broll.py runs the pipeline for a single query using InMemoryBrollAssetRepository
- InMemoryBrollAssetRepository is a stub — nothing is persisted to the database
- PexelsClient and PixabayClient support search_videos() with pagination
- broll_assets table uses VECTOR(768) for Gemini embeddings
- The pipeline works end-to-end but only processes one query at a time with no persistence

## Deliverables

### 1. Async DB repository — `workers/broll/repository.py`

Create `BrollAssetRepository` following the same pattern as `workers/knowledge/repository.py`:

- `__init__(self, db_url: str)`: asyncpg connection
- `async def connect()`: Create connection pool
- `async def close()`: Close pool
- `async def asset_exists(source: str, source_asset_id: str) -> bool`:
  Check if asset already in broll_assets table
- `async def bulk_check_existing(assets: list[dict]) -> set[str]`:
  Batch check which source_asset_ids already exist (for dedup efficiency)
- `async def store_asset(asset: dict, embedding: list[float]) -> None`:
  Upsert into broll_assets with ON CONFLICT (source, source_asset_id) DO UPDATE
- `async def store_assets_batch(assets: list[dict], embeddings: list[list[float]]) -> int`:
  Batch upsert for efficiency, return count of inserted/updated rows
- `async def count_assets() -> int`:
  SELECT COUNT(*) from broll_assets
- `async def mark_job_completed(job_id: str, artifacts: dict) -> None`:
  Update processing_jobs status

Use `asyncpg` connection pool. Follow the Protocol pattern so the in-memory
version and DB version are interchangeable.

### 2. Update BrollIndexingPipeline — `workers/broll/pipeline.py`

- Accept repository parameter (default to DB repository when db_url is available)
- Update PersistBrollAssetStep to use the async repository for batch upserts
- Add deduplication: before processing, bulk_check_existing to skip already-indexed assets

### 3. Query list — `scripts/broll_queries.txt`

Create a curated list of 200+ diverse search queries across categories:
- Nature & landscapes (e.g., "aerial mountain sunrise", "ocean waves crashing rocks")
- Urban & city (e.g., "tokyo neon streets night", "new york skyline timelapse")
- People & lifestyle (e.g., "coffee shop working laptop", "friends laughing dinner")
- Technology (e.g., "data center server room", "robot arm manufacturing")
- Business (e.g., "corporate meeting room", "startup team brainstorming")
- Food & cooking (e.g., "sushi chef preparation", "fresh vegetables market")
- Travel (e.g., "tropical beach sunset", "european cobblestone streets")
- Sports & fitness (e.g., "runner morning jogger", "yoga studio meditation")
- Abstract & creative (e.g., "paint splash slow motion", "bokeh lights colorful")
- Weather & seasons (e.g., "thunderstorm lightning", "autumn leaves falling")

Each line is one query. Aim for 200-300 queries to reach 100K assets
(~400-500 assets per query from Pexels + Pixabay combined).

### 4. Enhanced seed script — `scripts/seed_broll.py`

Rewrite to support batch operations:

- `--query <text>`: Single query mode (existing behavior, but with real DB)
- `--file <path>`: Batch mode — read queries from file (default: scripts/broll_queries.txt)
- `--source <pexels|pixabay|all>`: Which sources to use (default: all)
- `--per-page <N>`: Results per API call (default: 50)
- `--max-pages <N>`: Max pagination depth per query (default: 10)
- `--resume`: Skip queries that have already been fully processed
  (track in a local state file: scripts/.seed_broll_state.json)
- `--dry-run`: Show what would be processed without making API calls
- `--db-url <url>`: Database URL (default: from DATABASE_URL env var)

Resume logic:
- Maintain scripts/.seed_broll_state.json with: {query: {status, assets_found, assets_indexed, last_page}}
- On --resume, skip queries with status='completed'
- On error, save progress so next run can continue

Output:
- Per-query progress: "Query 42/200 'aerial mountain sunrise': 87 discovered, 65 new, 65 indexed"
- Final summary: "Total: 15,234 assets indexed across 200 queries"
- Estimated time remaining based on average query processing time

### 5. Tests — update existing tests

Add to `workers/tests/test_broll_steps.py`:
- Test BrollAssetRepository.bulk_check_existing returns correct set (mock asyncpg)
- Test BrollAssetRepository.store_assets_batch handles upsert correctly (mock asyncpg)
- Test seed script resume logic: completed queries are skipped
- Test seed script dry-run mode produces no side effects

## Constraints

- Python, snake_case, 4-space indent
- Only modify/create files within the scope listed above
- Do NOT touch frontend/, backend/app/, db/migrations/
- Do NOT modify existing pipeline step interfaces — extend, don't break
- Use asyncpg for database operations
- Handle Pexels/Pixabay API rate limits gracefully (sleep on 429, log and continue)
- The scripts/.seed_broll_state.json file should be in .gitignore
- If you start any service to verify, use port 9204: `--port 9204`
```

### Acceptance Criteria

- [ ] `workers/broll/repository.py` implements async DB repository with batch operations
- [ ] BrollIndexingPipeline uses real DB repository instead of in-memory stub
- [ ] `scripts/broll_queries.txt` contains 200+ diverse search queries
- [ ] `scripts/seed_broll.py` supports --file, --resume, --dry-run flags
- [ ] Resume logic correctly skips completed queries
- [ ] Batch deduplication prevents re-indexing existing assets
- [ ] Tests pass with `pytest workers/tests/test_broll_steps.py -v`
- [ ] No files outside scope are modified

---

## Merge Order

These tasks are designed to be merged in this sequence:

1. **Task 2 (T09 Scheduler)** — independent, adds new file only
2. **Task 3 (T10 Worker)** — independent, adds new file + migration
3. **Task 1 (T08 Answer Gen)** — modifies existing knowledge.py
4. **Task 4 (T11 B-roll Scale)** — modifies existing pipeline.py + seed script

After merging, run full test suite:
```bash
pytest backend/tests/ -v
pytest workers/tests/ -v
pnpm --dir frontend test
```

---

## Notes for All Tasks

- Read AGENTS.md before writing any code — it defines naming, style, and boundary rules.
- Branch naming convention: `codex/<type>-<scope>` (e.g., `codex/feat-scheduler`).
- Commit messages: short, imperative, English (e.g., "Add worker retry with exponential backoff").
- Do NOT create .env files with real secrets.
- Do NOT modify ARCHITECTURE.md, AGENTS.md, README.md, or PIPELINE_PATTERN.md.
- Each PR should include a summary of changes, affected directories, and test status.

### Context from Round 1 & 2

These tasks build on infrastructure completed in Rounds 1 and 2:
- **Gemini Embedding 2** is the unified embedding model (768-dim) — already integrated
- **Better Auth** handles user session — already integrated
- **Config system** loads from yaml + env — already integrated
- **Knowledge Pipeline** (9 steps) — fully implemented in workers/knowledge/
- **YouTube/Pexels/Pixabay clients** — already implemented in workers/common/sources/
- **Query embedding** uses real Gemini vectors — already in backend/app/search/
- **Rate limiter** (token bucket) — already in backend/app/middleware/
- **All stubs removed** — no mock DB, no placeholder auth
