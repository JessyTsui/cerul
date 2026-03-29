# Indexing Quality Improvements

Based on eval benchmark v3.0 (91 queries, 141 videos), the main search quality issues come from the indexing pipeline, not the search layer. This doc describes 4 changes to improve retrieval quality, especially for short videos and visual content.

## Current Baseline

```
NDCG@5: 0.721 | MRR: 0.710 | Hit@3: 74.5%
Visual queries Hit@3: 56%
Short video (<120s) queries Hit@3: ~60%
```

---

## Change 1: Improve frame annotation prompt

**File:** `workers/knowledge/runtime.py` line 49

**Problem:** Current prompt tells Gemini to describe visual appearance ("A slide with the word Shop on white background"). Users search by concept ("chatgpt shopping demo"). The embedding distance between these is too large.

**Current:**
```python
FRAME_ANNOTATION_PROMPT = """
You are analyzing a screenshot from a technical talk, interview, demo, or keynote.
Return JSON only with this exact schema:
{
  "description": "1-2 sentences describing the frame",
  "text_content": "All visible text from slides, charts, UI, numbers, bullets, or code",
  "visual_type": "slide|chart|diagram|code|product_demo|whiteboard|other",
  "key_entities": ["model", "product", "company", "metric"]
}
""".strip()
```

**Replace with:**
```python
FRAME_ANNOTATION_PROMPT = """
Analyze this screenshot from a tech video. Focus on WHAT is being shown, not how it looks.
Return JSON only:
{
  "description": "What concept/product/idea is demonstrated. 1-2 sentences.",
  "search_queries": "5 short phrases a user would type to find this frame",
  "text_content": "All visible text (slides, UI, code, charts)",
  "visual_type": "slide|chart|diagram|code|product_demo|screencast|photo|other",
  "key_entities": ["names of products, companies, people, or terms shown"]
}
For slides: describe the topic, not "a slide with text".
For demos: describe what product does what.
For charts: describe what data shows.
""".strip()
```

**Key difference:** Added `search_queries` field and changed `description` guidance from "describing the frame" to "what concept/product/idea is demonstrated". Added `screencast` to visual_type. Added 3 lines of concrete guidance.

**Also update** the annotation response parsing in `_aggregate_frame_annotations()` (around line 2660) to extract the new `search_queries` field and store it in the aggregated result.

---

## Change 2: Inject search_queries into visual unit content_text

**File:** `workers/unified/pipeline.py` around line 719

**Problem:** Visual unit content_text is `title + visual_desc + visible_text`. This gets embedded but doesn't contain the phrases users would search for.

**Current:**
```python
content_text = "\n".join(
    part
    for part in [
        str(stored_video["title"]),
        visual_desc,
        f"Visible text: {visible_text}" if visible_text else None,
    ]
    if part
)
```

**Replace with:**
```python
search_queries = str(
    (segment.get("metadata") or {}).get("search_queries") or ""
).strip()
content_text = "\n".join(
    part
    for part in [
        str(stored_video["title"]),
        visual_desc,
        f"Visible text: {visible_text}" if visible_text else None,
        f"Search terms: {search_queries}" if search_queries else None,
    ]
    if part
)
```

**Dependency:** Requires Change 1 to produce `search_queries`. The field should be passed through the segment metadata from the frame annotation step.

---

## Change 3: Short video speech units — fallback to description when transcript is empty

**File:** `workers/unified/pipeline.py` around line 697-716

**Problem:** Many short videos (<120s) have garbage ASR output (e.g. `"Thank you. Bye."`, `"Transcribed by ESO"`). The speech unit content_text becomes `title + garbage`, producing useless embeddings.

**Current logic (simplified):**
```python
if transcript_text and speech_embedding is not None:
    content_text = title + "\n" + transcript_text
```

**Add fallback:** When `transcript_text` is very short (< 50 chars), supplement with video description:
```python
video_description = str(stored_video.get("description") or "").strip()
if len(transcript_text) < 50 and video_description:
    effective_text = title + "\n" + video_description + "\n" + transcript_text
else:
    effective_text = title + "\n" + transcript_text
```

Use `effective_text` as the `content_text` value and also as input to the embedding. The embedding for the speech unit should be recomputed from `effective_text` (not from the original transcript-only embedding from the knowledge pipeline).

**Important:** This means for short-transcript speech units, we need to embed `effective_text` instead of using `segment.get("embedding")`. Add a condition:
```python
if len(transcript_text) < 50 and video_description:
    embedding = await self._embed_content_text(effective_text)
else:
    embedding = list(speech_embedding)
```

Where `_embed_content_text` is the existing helper that calls `self._embedding_backend.embed_text`.

---

## Change 4: Summary unit — use full description for short videos

**File:** `workers/unified/pipeline.py` — the `_build_summary_text` method

**Problem:** Summary text is typically `title + first few lines of description`. For short videos, the description is often the ONLY meaningful text (since transcript is garbage). The full description should be used.

**Find** the `_build_summary_text` method and add logic: if `stored_video["duration_seconds"] < 120`, use the full description text without truncation.

---

## Testing

After making these changes:

1. Pick 5 test videos that currently fail in the benchmark:
   - `qF4QRh2u7FE` — "An updated shopping experience in ChatGPT" (39s, visual search fails)
   - `PupmfSttxlc` — "Claude now has memory" (59s, Chinese search fails)
   - `XpXImenrSPI` — "Claude Code in Slack" (42s, recall search fails)
   - `QTfoYDzqXn0` — "Connect Claude to Microsoft 365" (39s, how-to fails)
   - `UAmKyyZ-b9E` — "Introducing Cowork" (69s, "cowork" search fails)

2. Delete their existing retrieval_units and re-index them through the pipeline.

3. Run `python scripts/eval_search.py` and compare against the baseline.

---

## Files to modify

| File | Changes |
|------|---------|
| `workers/knowledge/runtime.py` | Change 1: update `FRAME_ANNOTATION_PROMPT`, update `_aggregate_frame_annotations()` to extract `search_queries` |
| `workers/unified/pipeline.py` | Change 2: inject `search_queries` into visual content_text |
| `workers/unified/pipeline.py` | Change 3: transcript fallback for short videos |
| `workers/unified/pipeline.py` | Change 4: full description in summary for short videos |

## Constraints

- Do NOT change the embedding model or dimension (Gemini Embedding 2, 3072-dim)
- Do NOT change the search layer (`api/src/services/search.ts`)
- Do NOT change the eval script or benchmark dataset
- Do NOT change the pipeline step order or add new steps
- Keep the changes minimal — each change should be independently testable
