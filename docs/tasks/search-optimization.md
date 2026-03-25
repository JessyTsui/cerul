# Search Optimization: Deduplication, Index, and Query Merge

## Background

Current search has several issues:
1. Same video segment appears twice in results (once as `speech`, once as `visual`) because they share the same `timestamp_start`/`timestamp_end` but have different `unit_type` and different `id`
2. The search runs two separate pgvector queries (one for `speech`, one for `visual`), doubling DB round trips
3. No HNSW index on the embedding column — currently doing brute-force exact KNN scan
4. `unit_type` is exposed in the API response but provides no value to API consumers

These tasks can be done in parallel across separate worktrees and merged afterward.

---

## Task 1: Add pgvector HNSW Index on Neon

**Goal**: Add an HNSW index to speed up vector similarity search, especially as the dataset grows beyond 10K retrieval units.

**Files to modify**:
- `db/migrations/010_hnsw_index.sql` (new file)

**What to do**:

Create a new migration file `db/migrations/010_hnsw_index.sql`:

```sql
BEGIN;

-- HNSW index for cosine similarity search on retrieval_units embeddings.
-- With 1K-10K vectors this provides ~5-25x speedup over brute-force scan.
-- At 100K+ vectors the speedup is 100x+.
-- m=16 and ef_construction=200 are good defaults for recall vs speed tradeoff.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrieval_units_embedding_hnsw
ON retrieval_units
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

COMMIT;
```

**How to run on Neon**:

```bash
psql "$DATABASE_URL" -f db/migrations/010_hnsw_index.sql
```

Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block in some environments. If it fails, remove the `BEGIN;`/`COMMIT;` wrapper and run the CREATE INDEX statement alone.

**Verification**:
```sql
-- Confirm index exists
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'retrieval_units' AND indexname LIKE '%hnsw%';

-- Confirm it's being used (run a sample query and check EXPLAIN)
EXPLAIN ANALYZE
SELECT id, embedding <=> '[0.01,0.02,...]'::vector AS score
FROM retrieval_units
ORDER BY embedding <=> '[0.01,0.02,...]'::vector
LIMIT 10;
-- Should show "Index Scan using idx_retrieval_units_embedding_hnsw"
```

**Risk**: None. This is additive — the index doesn't change any data or query semantics, only speeds them up. Existing queries automatically use HNSW when the planner determines it's beneficial.

---

## Task 2: Merge speech + visual into a Single Query

**Goal**: Instead of running two separate pgvector queries (one per `unit_type`), run a single query that returns both speech and visual units together. This halves the DB round trips and simplifies the search pipeline.

**Files to modify**:
- `backend/app/search/unified.py`

**Current code** (lines 72-87 in `unified.py`):
```python
allowed_unit_types = ["speech", "visual"]
if request.include_summary:
    allowed_unit_types.insert(0, "summary")

candidate_limit = min(max(request.max_results * 8, 24), 120)
candidate_rows: list[dict[str, Any]] = []
for unit_type in allowed_unit_types:
    rows = await self._fetch_unit_rows(
        filters=request.filters,
        query_vector=resolved_query_vector,
        unit_type=unit_type,
        user_id=user_id,
        limit=candidate_limit,
    )
    candidate_rows.extend(rows)
```

**Change to**:
```python
allowed_unit_types = ["speech", "visual"]
if request.include_summary:
    allowed_unit_types.insert(0, "summary")

candidate_limit = min(max(request.max_results * 8, 24), 120)
candidate_rows = await self._fetch_unit_rows(
    filters=request.filters,
    query_vector=resolved_query_vector,
    unit_type=None,  # fetch all types at once
    user_id=user_id,
    limit=candidate_limit,
    allowed_unit_types=allowed_unit_types,
)
```

Then update `_fetch_unit_rows` to accept `allowed_unit_types` as a list and use `ru.unit_type = ANY($N::text[])` in the SQL WHERE clause instead of `ru.unit_type = $N`. When `unit_type` is `None` and `allowed_unit_types` is provided, use the array filter.

Find the `_fetch_unit_rows` method in the same file. It builds a SQL query with conditions. Look for the line that adds the `unit_type` condition:
```python
conditions.append(f"ru.unit_type = ${len(params)}")
```

Change the logic so that:
- If a single `unit_type` string is passed, use `= $N` (backward compat)
- If `allowed_unit_types` list is passed, use `ru.unit_type = ANY($N::text[])` and pass the list as parameter

**Verification**:
- Run the existing search tests
- Make a search API call and confirm results contain both `speech` and `visual` unit types
- Confirm the query count to the DB dropped from 2 (or 3 with summary) to 1

---

## Task 3: Deduplicate Same-Segment Results Across Unit Types

**Goal**: When the same video segment (same `video_id` + overlapping `timestamp_start`/`timestamp_end`) appears as both a `speech` result and a `visual` result, merge them into a single result taking the higher score. The API should return one result per unique segment, not one per unit type.

**Files to modify**:
- `backend/app/search/unified.py` — the `_dedupe_rows` method

**Current code** (`_dedupe_rows` at line ~280):
```python
def _dedupe_rows(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for row in rows:
        row_id = str(row.get("id") or "")
        if not row_id or row_id in seen_ids:
            continue
        seen_ids.add(row_id)
        deduped.append(row)
    return deduped
```

This only deduplicates by `id` (retrieval_unit primary key). Two units with different IDs but same video+timestamp pass through.

**Replace with**:
```python
def _dedupe_rows(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate by retrieval unit ID, then merge units that cover the
    same video segment (same video_id and overlapping timestamps).
    When two unit types cover the same segment, keep the one with the
    higher score and merge supplementary fields."""
    # Step 1: dedupe by ID
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = str(row.get("id") or "")
        if row_id and row_id not in by_id:
            by_id[row_id] = row

    # Step 2: group by video_id + timestamp range and merge
    segment_key_map: dict[str, dict[str, Any]] = {}
    for row in by_id.values():
        video_id = str(row.get("video_id") or "")
        ts_start = row.get("timestamp_start")
        ts_end = row.get("timestamp_end")

        # Build a segment key: same video + same time range
        if video_id and ts_start is not None and ts_end is not None:
            seg_key = f"{video_id}:{float(ts_start):.2f}-{float(ts_end):.2f}"
        else:
            # No timestamp info — use the unit ID as key (no merging)
            seg_key = str(row.get("id"))

        existing = segment_key_map.get(seg_key)
        if existing is None:
            segment_key_map[seg_key] = dict(row)
        else:
            # Keep whichever has the higher score
            existing_score = float(existing.get("score", 0))
            new_score = float(row.get("score", 0))
            if new_score > existing_score:
                # Merge: take the higher-scored row but preserve visual_desc
                # from the visual unit if the winner is speech (and vice versa)
                merged = dict(row)
                if not merged.get("visual_desc") and existing.get("visual_desc"):
                    merged["visual_desc"] = existing["visual_desc"]
                if not merged.get("transcript") and existing.get("transcript"):
                    merged["transcript"] = existing["transcript"]
                segment_key_map[seg_key] = merged
            else:
                # Keep existing but merge missing fields from new
                if not existing.get("visual_desc") and row.get("visual_desc"):
                    existing["visual_desc"] = row["visual_desc"]
                if not existing.get("transcript") and row.get("transcript"):
                    existing["transcript"] = row["transcript"]

    return list(segment_key_map.values())
```

**Key behavior**:
- Same video, same timestamp range → merged into one result
- The result with the higher vector similarity score wins
- `visual_desc` and `transcript` are preserved from whichever unit has them (so the merged result has both speech transcript AND visual description)
- The `unit_type` of the merged result reflects whichever scored higher — but this doesn't matter because Task 4 removes `unit_type` from the API response

**Verification**:
- Search for something like "SpaceX rocket launch" and confirm you get one result per segment, not two
- Confirm the snippet contains relevant content (not an empty visual description)
- Confirm score is the max of the two original scores
- Run existing tests, update any that assert on result count (may return fewer results now)

---

## Task 4: Remove `unit_type` from Public API Response

**Goal**: Stop exposing `unit_type` in the search API response. It's an internal implementation detail. After deduplication (Task 3), a result may represent merged speech+visual data, making `unit_type` meaningless.

**Files to modify**:
- `backend/app/search/models.py` — `SearchResult` model
- `backend/app/search/unified.py` — where `SearchResult` is constructed
- `backend/app/routers/search.py` — if `unit_type` is referenced in the route

### Step 1: Update `SearchResult` model

In `backend/app/search/models.py`, find the `SearchResult` class and remove the `unit_type` field:

```python
# REMOVE this field:
unit_type: Literal["speech", "visual", "summary"] | None = None
```

### Step 2: Update result construction

In `backend/app/search/unified.py`, find where `SearchResult` is constructed (around line 152-168). Remove the `unit_type=...` line:

```python
# REMOVE this line:
unit_type=str(row.get("unit_type") or "speech"),
```

### Step 3: Update tracking_links

In the same file, the tracking_links dict also stores `unit_type` (line ~144). Keep it there — tracking_links are internal and useful for analytics. Only remove from the public `SearchResult`.

### Step 4: Update snippet building

Check `_build_snippet` method in `unified.py`. If it uses `unit_type` to decide what to show in the snippet, update it to check for the presence of `visual_desc` or `transcript` instead:

```python
# Instead of:
if row.get("unit_type") == "visual":
    return row.get("visual_desc") or ""

# Use:
if row.get("visual_desc") and not row.get("transcript"):
    return row.get("visual_desc") or ""
```

After Task 3's merge, a result may have BOTH `transcript` and `visual_desc`. The snippet should prefer transcript (more useful for search context) and fall back to visual_desc.

**Verification**:
- Make a search API call and confirm `unit_type` no longer appears in the JSON response
- Confirm the response still contains all other fields (score, url, title, snippet, etc.)
- Confirm tracking_links in the DB still have `unit_type` for internal analytics
- Run existing tests — update any that reference `unit_type` in response assertions

---

## Task Dependencies and Merge Order

```
Task 1 (HNSW Index)     — independent, can merge first
Task 2 (Single Query)   — independent, can merge second
Task 3 (Dedup Merge)    — independent, can merge third
Task 4 (Remove unit_type) — depends on Task 3 (dedup must exist first)
```

Tasks 1, 2, 3 can run in parallel worktrees. Task 4 should run after Task 3 is merged.

After all tasks are merged, run the full test suite:
```bash
cd backend && python -m pytest tests/ -x -q
```

And do a manual search test:
```bash
curl -X POST "http://localhost:8000/v1/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SpaceX rocket stage separation", "max_results": 5, "include_answer": true}'
```

Confirm:
- No duplicate segments in results
- `unit_type` not in response
- Response time improved (fewer DB queries + HNSW index)
- Answer quality unchanged
