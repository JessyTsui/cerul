# Task: Implement Dense Visual Embedding in Indexing Pipeline

## Background

Experiments on `auto-optimize-indexing` branch (PR #87) proved that:

1. **Gemini Flash annotation is unnecessary for retrieval quality** — removing it entirely had zero impact on Recall@5 or NDCG@5
2. **Dense visual embedding (1-5 frames per segment, multimodal embedded via Gemini Embedding 2) improves NDCG by +2.6%** at near-zero cost
3. This replaces $0.03/video of Gemini Flash costs with $0.003/video of Gemini Embedding costs (90% reduction)

See `docs/tuning-log.md` for full experiment data.

## What to implement

### 1. New pipeline step: `DenseVisualEmbedStep`

Location: `workers/knowledge/steps/dense_visual_embed.py` (new file)

After `SegmentKnowledgeTranscriptStep` and `EmbedKnowledgeSegmentsStep`, add a step that:

```python
for each segment:
    # Extract N frames at uniform timestamps within [timestamp_start, timestamp_end]
    timestamps = uniform_timestamps(start, end, count=DENSE_VISUAL_FRAMES_PER_SEGMENT)

    for ts in timestamps:
        frame = ffmpeg_extract_frame(video_path, ts, scale="640:360")

        # Multimodal embedding: short text context + frame image
        embed_text = f"{video_title}\n{transcript_excerpt[:200]}"
        vector = embedding_backend.embed_multimodal(embed_text, image_paths=[frame])

        # Store as a visual retrieval unit
        store_visual_unit(video_id, segment_index, frame_index, vector, ...)
```

Key parameters (add to `config/base.yaml` under `knowledge:`):
```yaml
knowledge:
  dense_visual_frames_per_segment: 3  # start with 3, experiment showed 1-5 all equivalent
```

### 2. Integration into `UnifiedIndexingPipeline`

In `workers/unified/pipeline.py` `_build_units_from_knowledge_segments()`:

After building speech units and existing visual units, add dense visual units:

```python
for segment in stored_segments:
    timestamps = compute_uniform_timestamps(segment.start, segment.end, count=N)
    for ts in timestamps:
        frame_path = extract_frame(video_path, ts)
        vector = embed_multimodal(title + transcript[:200], image_paths=[frame_path])
        units.append({
            "unit_type": "visual",
            "unit_index": dense_offset + segment_index * 100 + frame_idx,
            "embedding": vector,
            "content_text": title + "\n" + transcript[:200],
            "visual_type": "frame_embed",
            "metadata": {"dense_visual": True},
            ...
        })
```

### 3. Reduce Gemini Flash annotation budget

In `workers/knowledge/runtime.py`:

```python
# Option A: Remove annotation entirely
DEFAULT_MAX_ANNOTATED_FRAMES_PER_VIDEO = 0

# Option B: Keep minimal annotation for UI metadata only
DEFAULT_MAX_ANNOTATED_FRAMES_PER_VIDEO = 5  # just enough for visual_type classification
```

Recommend **Option A** for now — the `visual_type` field can be populated later via a cheaper heuristic or removed from the UI.

### 4. Keep these bug fixes from PR #87

- `workers/unified/pipeline.py`: pass `frame_analyzer` and `scene_detector` to inner `KnowledgeIndexingPipeline`
- `workers/common/sources/youtube.py`: change proxy fallback from `YTDLP_PROXY` to `YOUTUBE_API_PROXY`

### 5. Do NOT change these parameters

Based on experiment results, these should stay at their current values:

| Parameter | Value | Reason |
|-----------|-------|--------|
| `scene_threshold` | 0.35 | Lowering to 0.25 caused regression |
| `FRAME_SCENE_THRESHOLD` | 0.25 | Lowering to 0.15 caused regression |
| `MAX_INFORMATIVE_FRAMES` | 2 | Doesn't matter when annotation is removed |
| `skin_ratio` / `edge_ratio` | 0.45 / 0.04 | Doesn't matter when annotation is removed |

## DB schema notes

Dense visual units use the existing `retrieval_units` table:
- `unit_type = 'visual'`
- `unit_index >= 1000` (to avoid conflicts with existing visual units from annotation)
- `visual_type = 'frame_embed'` (to distinguish from annotation-based visual units)
- `metadata = {"dense_visual": true}`

No schema migration needed.

## Testing

Run the eval:
```bash
python scripts/eval_indexing.py
```

Expected baseline NDCG@5 ≥ 0.9375 with dense visual embedding enabled.

## Files to modify

| File | Change |
|------|--------|
| `workers/knowledge/steps/dense_visual_embed.py` | **New** — dense visual embedding step |
| `workers/unified/pipeline.py` | Add dense visual units in `_build_units_from_knowledge_segments` |
| `workers/knowledge/runtime.py` | Set `DEFAULT_MAX_ANNOTATED_FRAMES_PER_VIDEO = 0` |
| `workers/common/sources/youtube.py` | Fix proxy fallback (from PR #87) |
| `config/base.yaml` | Add `dense_visual_frames_per_segment: 3` |
| `docs/tuning-log.md` | Already updated with experiment results |
