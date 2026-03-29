# Codex Prompts for Search Optimization Tasks

> Note: this prompt doc predates the current TypeScript/Hono implementation. File paths below now point to the active monorepo layout, and old Python-style symbols should be mapped to the current camelCase helpers in `api/src/services/search.ts`.

Copy each prompt into a separate Codex session/worktree.

---

## Task 1: HNSW Index

```
Create a new database migration file `db/migrations/010_hnsw_index.sql` that adds an HNSW index on the `embedding` column of the `retrieval_units` table for cosine similarity search.

Use these parameters: m=16, ef_construction=200, operator class vector_cosine_ops.

Use CREATE INDEX CONCURRENTLY IF NOT EXISTS. Name the index `idx_retrieval_units_embedding_hnsw`.

Do NOT wrap it in BEGIN/COMMIT since CONCURRENTLY cannot run inside a transaction.

After creating the file, run it against the database using the DATABASE_URL from .env:
```bash
psql "$DATABASE_URL" -f db/migrations/010_hnsw_index.sql
```

Then verify the index exists:
```bash
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'retrieval_units' AND indexname LIKE '%hnsw%';"
```
```

---

## Task 2: Merge speech + visual into Single Query

```
In `api/src/services/search.ts`, the `search` method currently runs multiple separate pgvector queries in a loop — one per unit_type (speech, visual, optionally summary). This doubles the DB round trips.

Merge them into a single query. Here's what to change:

1. In the `search` method (around line 72-87), replace the for-loop over `allowed_unit_types` with a single call to `_fetch_unit_rows`, passing all allowed types at once.

2. Update `_fetch_unit_rows` to accept an optional `allowed_unit_types: list[str] | None` parameter. When provided, use `ru.unit_type = ANY($N::text[])` in the SQL WHERE clause instead of `ru.unit_type = $N`. Pass the Python list directly as the parameter — asyncpg handles list-to-array conversion automatically.

3. Keep backward compatibility: if the old `unit_type: str` parameter is passed, use it as before. If `allowed_unit_types` list is passed, use the ANY clause.

The key change in the SQL condition builder:
- Old: `conditions.append(f"ru.unit_type = ${len(params)}")` with `params.append(unit_type)`
- New: `conditions.append(f"ru.unit_type = ANY(${len(params)}::text[])")` with `params.append(allowed_unit_types)`

Run backend tests after: `cd backend && python -m pytest tests/ -x -q`
```

---

## Task 3: Deduplicate Same-Segment Results

```
In `api/src/services/search.ts`, the `_dedupe_rows` method currently only deduplicates by retrieval_unit `id`. This means the same video segment (same video_id + same timestamp_start + same timestamp_end) can appear twice in results — once as a `speech` unit and once as a `visual` unit with identical scores.

Replace the `_dedupe_rows` method with a two-step deduplication:

Step 1: Dedupe by `id` (same as before)

Step 2: Group by segment key = `{video_id}:{timestamp_start:.2f}-{timestamp_end:.2f}`. When two rows share the same segment key:
- Keep the row with the higher `score`
- Merge supplementary fields from the other row: if the winner is missing `visual_desc`, take it from the loser; if missing `transcript`, take it from the loser
- For rows without timestamps (like summary units), use the `id` as segment key (no merging)

Here's the replacement implementation:

```python
def _dedupe_rows(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = str(row.get("id") or "")
        if row_id and row_id not in by_id:
            by_id[row_id] = row

    segment_key_map: dict[str, dict[str, Any]] = {}
    for row in by_id.values():
        video_id = str(row.get("video_id") or "")
        ts_start = row.get("timestamp_start")
        ts_end = row.get("timestamp_end")
        if video_id and ts_start is not None and ts_end is not None:
            seg_key = f"{video_id}:{float(ts_start):.2f}-{float(ts_end):.2f}"
        else:
            seg_key = str(row.get("id"))

        existing = segment_key_map.get(seg_key)
        if existing is None:
            segment_key_map[seg_key] = dict(row)
        else:
            existing_score = float(existing.get("score", 0))
            new_score = float(row.get("score", 0))
            if new_score > existing_score:
                merged = dict(row)
                if not merged.get("visual_desc") and existing.get("visual_desc"):
                    merged["visual_desc"] = existing["visual_desc"]
                if not merged.get("transcript") and existing.get("transcript"):
                    merged["transcript"] = existing["transcript"]
                segment_key_map[seg_key] = merged
            else:
                if not existing.get("visual_desc") and row.get("visual_desc"):
                    existing["visual_desc"] = row["visual_desc"]
                if not existing.get("transcript") and row.get("transcript"):
                    existing["transcript"] = row["transcript"]

    return list(segment_key_map.values())
```

Also check the `_build_snippet` method in the same file. If it branches on `unit_type` to decide what text to show, change it to check for field presence instead:
- Has `transcript` → use transcript for snippet
- Has `visual_desc` but no `transcript` → use visual_desc
- This way merged results that have both fields still show the right snippet

Run backend tests: `cd backend && python -m pytest tests/ -x -q`

Then test manually:
```bash
curl -X POST "http://localhost:8787/v1/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "rocket launch", "max_results": 5}'
```
Confirm no duplicate segments (same title + same timestamp) appear in results.
```

---

## Task 4: Remove unit_type from API Response (run AFTER Task 3 is merged)

```
Remove the `unit_type` field from the public search API response. It's an internal implementation detail that provides no value to API consumers.

Changes needed:

1. `api/src/types.ts` — In the `SearchResult` type, remove the `unit_type` field entirely if it is still exposed. It used to look roughly like:
   ```python
   unit_type: Literal["speech", "visual", "summary"] | None = None
   ```
   Delete this field.

2. `api/src/services/search.ts` — In the public search result construction logic, remove any `unit_type` exposure from returned results.

3. Do NOT remove `unit_type` from the `tracking_links` dict in the same method — tracking links are internal data used for analytics and should keep this field.

4. Check the search router `api/src/routes/search.ts` for any references to `unit_type` in the response handling. Remove if found.

5. Update any tests that assert on `unit_type` in search responses.

Run tests: `cd backend && python -m pytest tests/ -x -q`

Verify with a search call that `unit_type` no longer appears in the JSON response but all other fields (id, score, url, title, snippet, thumbnail_url, keyframe_url, duration, source, speaker, timestamp_start, timestamp_end) still work.
```
