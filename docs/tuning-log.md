# Search & Indexing Tuning Log

This document records all parameter tuning decisions, the data behind them, and the rationale. All future search optimization, indexing pipeline changes, and model upgrades should be documented here.

---

## 2026-03-26: Search Parameter Sweep (auto-optimize-search)

### Context

- 141 indexed videos, 91 benchmark queries across 15 dimensions
- Benchmark: `eval/search_benchmark.json` v3.0
- Sweep script: `scripts/sweep_search_params.py`
- Charts: `eval/sweep_*.png`

### Baseline (before optimization)

| Metric | Score |
|--------|-------|
| NDCG@5 | 0.726 |
| MRR | 0.714 |
| Hit@3 | 78.3% |

Config: embedding-only mode, `candidate_mult=8`, `rerank_top_n=20`, `mmr_lambda=0.75`, gpt-4o-mini pointwise reranker.

### Changes made

#### 1. Replaced gpt-4o-mini with Jina Reranker v3

**Why:** gpt-4o-mini pointwise reranker required 20 separate LLM calls per query (~$0.002/query, ~3s latency). Jina reranker-v3 is a cross-encoder that scores all candidates in a single API call (~$0.00012/query, <200ms API time). It is also multilingual-native, which matters because 30%+ of benchmark queries are non-English.

**Result:** NDCG@5 +9.7%, MRR +18.6%, Hit@3 +10.7% over embedding-only baseline.

**Files changed:** `api/src/services/rerank.ts` (added `JinaRerankerBackend`), `config/base.yaml` (`rerank_model: jina-reranker-v3`).

#### 2. rerank_top_n: 20 → 30

**Why:** Sweep tested [5, 10, 15, 20, 25, 30, 40]. NDCG@5 peaked at n=30 (0.800). At n=10 there was a dip (0.755) because the reranker had too few candidates. At n=40 it dropped slightly (0.787) due to noise from low-quality candidates confusing the reranker.

**Data:**
```
n=5:  0.763  n=10: 0.755  n=15: 0.790
n=20: 0.794  n=25: 0.794  n=30: 0.800  n=40: 0.787
```

**File changed:** `config/base.yaml` (`rerank_top_n: 30`).

#### 3. candidate_mult: kept at 8

**Why:** Sweep tested [4, 6, 8, 10, 12, 16, 20]. NDCG@5 plateaued at 8x (0.771). Beyond 8x, the additional candidates from vector search were too far from the query to be useful. No change needed.

#### 4. mmr_lambda: kept at 0.75 (but note: 1.0 is optimal for recall)

**Why:** Sweep tested [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]. NDCG@5 was highest at λ=1.0 (no MMR, pure relevance). MMR diversification pushed correct results out of top-K, hurting recall metrics.

**Decision:** Keep 0.75 in production because:
- Real API users benefit from diverse results (not just top-1 accuracy)
- The eval benchmark measures "is the correct video in top K?" which penalizes diversity
- If we later add a `diversity=false` API parameter, we can skip MMR for precision-focused use cases

**Data:**
```
λ=0.5: 0.770  λ=0.6: 0.788  λ=0.7: 0.784  λ=0.75: 0.777
λ=0.8: 0.767  λ=0.85: 0.776  λ=0.9: 0.772  λ=0.95: 0.776  λ=1.0: 0.790
```

#### 5. cap_per_video: kept at 0 (no cap in eval, 2 in production)

**Why:** Sweep tested [0, 1, 2, 3, 4]. Results were noisy with no clear winner. Cap=2 and cap=4 tied for best Hit@3 (0.912). Since the eval deduplicates by video anyway, cap has minimal impact on metrics.

**Decision:** Keep cap=2 in production (`_cap_per_video` in unified.py) for user experience (prevents one video dominating results), but this is not a quality-critical parameter.

### Final results (after optimization)

| Metric | Baseline | Embedding (optimized) | Rerank (optimized) | Improvement |
|--------|----------|-----------------------|--------------------|-------------|
| NDCG@5 | 0.726 | 0.771 | **0.800** | **+10.3%** |
| MRR | 0.714 | 0.837 | **0.860** | **+20.5%** |
| Hit@3 | 78.3% | 91.2% | **91.2%** | **+16.5%** |

### Remaining bottlenecks

The MISS queries are almost entirely caused by **indexing quality**, not search ranking:
- Short videos (<60s) with empty/garbage ASR transcripts
- Visual content not adequately described by frame annotation
- Cross-language queries for content that only exists in English transcripts

These are addressed by `docs/tasks/indexing-quality-improvements.md` and will be tracked in the next tuning entry.

---

## 2026-03-26: Jina Reranker Integration

### Cost comparison

| Reranker | Cost/query | Latency | Calls/query |
|----------|-----------|---------|-------------|
| gpt-4o-mini (before) | ~$0.002 | ~3-5s | 20 parallel LLM calls |
| **jina-reranker-v3 (after)** | **~$0.00012** | **~200ms API** | **1 call** |

**16x cheaper, single API call.** Free tier: 10M tokens/month.

### Architecture

```
Query → Gemini embed → Vector search (top 40) → Jina rerank (top 30) → MMR → Results
```

The `JinaRerankerBackend` implements `BatchRerankerBackend` protocol. `LLMReranker` auto-detects batch support via `hasattr(backend, "score_batch")`. Fallback to `OpenAICompatibleRerankerBackend` if model name doesn't contain "jina".

---

## 2026-03-26: Indexing Pipeline Improvements (PR #85)

### Frame annotation prompt

**Before:** "1-2 sentences describing the frame" → produced visual-appearance descriptions like "A slide with the word Shop on a white background"

**After:** "What concept/product/idea is demonstrated" + `search_queries` field → produces search-intent descriptions like "ChatGPT shopping feature demo" + "chatgpt shopping, AI e-commerce, buy products with AI"

**Impact:** Visual search queries improved significantly for the 5 re-indexed test videos. Full reindex pending.

### Short video transcript fallback

For videos <120s where ASR transcript is <50 chars, `content_text` now includes the video description from YouTube. This fixes the "1 seg with garbage transcript" problem.

### Gemini Flash via Dubrify

Frame annotation uses `GEMINI_FLASH_API_KEY` / `GEMINI_FLASH_BASE_URL` to route through Dubrify API proxy. ~70% cheaper than Google direct, no daily quota limit. Embedding still uses Google official API (`GEMINI_API_KEY`).

---

## 2026-03-26: Indexing Optimization — Dense Visual Embedding (auto-optimize-indexing)

### Context

Previous tuning entry noted that remaining search MISSes were caused by **indexing quality**, not search ranking. We ran three rounds of experiments on 8 test videos / 25 eval queries to find the best indexing strategy.

- Benchmark: `eval/indexing_benchmark.json` (8 videos, 25 queries across speech/visual/multilingual)
- Eval scripts: `scripts/eval_indexing.py`, `scripts/experiment_dense_visual_embed.py`, `scripts/run_full_experiment.py`
- Charts: `eval/figures/`

### Round 1: Parameter tuning (Gemini Flash annotation)

Tested whether increasing Gemini Flash annotation budget improves retrieval.

| Config | Description | Recall@5 | NDCG@5 | Gemini Flash cost |
|--------|-------------|----------|--------|-------------------|
| Baseline | Default params | 0.9583 | 0.9138 | ~$0.03/video |
| A | +frames +always_annotate | 0.9583 | 0.9221 | ~$0.09/video |
| B | A + relaxed filters | 0.9583 | 0.9221 | ~$0.09/video |
| C | B + finer scenes (threshold=0.25) | 0.9167 | 0.8958 | ~$0.09/video |

**Findings:** More annotation (A/B) didn't help. Finer scenes (C) hurt. Gemini Flash annotation has near-zero impact on recall — the retrieval signal comes from transcript embeddings, not annotation text.

### Round 2: Dense visual embedding (the breakthrough)

Tested a new strategy: instead of paying Gemini Flash to describe frames in text, embed raw frames directly using Gemini Embedding 2's multimodal capability. Each frame becomes its own retrieval unit (transcript context + frame image → multimodal vector).

**Initial experiment (1, 5, 10 frames):**

| Config | Dense frames/seg | Extra units | Recall@5 | NDCG@5 | Extra cost |
|--------|:---:|:---:|:---:|:---:|:---:|
| Baseline | 0 | 0 | 0.9583 | 0.9138 | — |
| D: 1 frame | 1 | 147 | 0.9583 | **0.9375** | ~$0.0002 |
| D: 5 frames | 5 | 832 | 0.9583 | **0.9375** | ~$0.001 |
| E: 10 frames | 10 | 1664 | 0.9583 | **0.9375** | ~$0.002 |

**Fine-grained sweep (0–5 frames, completed 2026-03-27):**

| Dense frames/seg | DB vectors | Recall@5 | NDCG@5 | MRR | Cost/video |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 0 (baseline) | 0 | 0.9583 | 0.9138 | 0.8993 | $0.030 |
| **1** | **167** | **0.9583** | **0.9375** | **0.9306** | **$0.0002** |
| 2 | 333 | 0.9583 | 0.9375 | 0.9306 | $0.0004 |
| 3 | 500 | 0.9583 | 0.9375 | 0.9306 | $0.0006 |
| 4 | 663 | 0.9583 | 0.9375 | 0.9306 | $0.0008 |
| 5 | 832 | 0.9583 | 0.9375 | 0.9306 | $0.001 |

**Key finding: 1 frame/segment is sufficient.** NDCG jumps from 0.9138 → 0.9375 at 1 frame and plateaus completely through 1–5 frames. All metrics (Recall@5, NDCG@5, MRR) are identical across 1–5 frames. The improvement comes from two queries:
- **fr01** (French, "pourquoi les grandes entreprises sont mauvaises en IA"): NDCG 0.500 → 1.000 (MISS→HIT)
- **v05** (visual, "chatgpt shopping interface demo"): NDCG 0.431 → 0.500 (rank improved)

**Decision: Use 1 frame/segment in production** (set `dense_visual_frames_per_segment: 1` in `config/base.yaml`). This minimizes DB storage and embedding cost while achieving full NDCG improvement. Currently set to 3 as a safety margin, but 1 is optimal on this benchmark.

Charts: `eval/figures/frames_sweep_ndcg.png`, `eval/figures/per_query_ndcg_heatmap.png`

### Round 3: Can we remove Gemini Flash annotation entirely?

Tested whether Gemini Flash annotation is needed when dense visual embedding is present. Re-ran on 2026-03-27 with clean methodology (DB manipulation, no reindex variance).

| Config | Flash annotation | Dense embed | Recall@5 | Visual Recall | NDCG@5 | MRR |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| Baseline (annotation only) | Yes (~20 calls) | No | 0.9583 | 0.8333 | 0.9138 | 0.8993 |
| **No annotation + 3 dense** | **No (0 calls)** | **3 frames** | **0.9583** | **0.8333** | **0.9375** | **0.9306** |
| Annotation + 3 dense | Yes (~20 calls) | 3 frames | 0.9583 | 0.8333 | 0.9375 | 0.9306 |

**Conclusion: Gemini Flash annotation can be completely removed.** All four metrics are identical between "no annotation + dense" and "annotation + dense". The multimodal embedding model handles text↔image matching natively, making text-based frame descriptions redundant for retrieval.

Chart: `eval/figures/annotation_removal_comparison.png`

### Changes to adopt

#### 1. Add dense visual embedding step to pipeline

For each speech segment, extract 3-5 frames at uniform timestamps and create individual visual retrieval units with multimodal embeddings (transcript excerpt + frame image). No Gemini Flash annotation needed.

**Implementation:** Add a new pipeline step after segmentation that:
- Extracts N frames per segment using ffmpeg (uniform timestamps)
- Calls `embed_multimodal(title + transcript_excerpt, image_paths=[frame])` for each
- Stores as `unit_type='visual'` retrieval units

#### 2. Remove or minimize Gemini Flash annotation

Set `MAX_ANNOTATED_FRAMES_PER_VIDEO = 0` to skip the expensive annotation step entirely. The `_resolve_scene_route` logic becomes irrelevant.

Alternatively, keep minimal annotation (budget=5-10 per video) for generating `visual_type` metadata used in the UI, but don't rely on it for retrieval quality.

#### 3. Bug fixes (keep from PR #87)

- `workers/unified/pipeline.py`: pass frame_analyzer/scene_detector to inner KnowledgeIndexingPipeline
- `workers/common/sources/youtube.py`: don't use YTDLP_PROXY for YouTube Data API

### Cost impact (final)

| Metric | Before | After |
|--------|--------|-------|
| Gemini Flash calls/video | ~10-20 | **0** |
| Gemini Embedding calls/video | ~50-100 | ~200-300 (includes dense frames) |
| Flash cost/video | $0.02-0.03 | **$0** |
| Embedding cost/video | ~$0.001 | ~$0.003 |
| **Total cost/video** | **~$0.03** | **~$0.003** |
| DB vectors/video | ~100-200 | ~300-500 |

**90% cost reduction with +2.6% NDCG improvement.**

### Remaining work

- [x] ~~Finalize dense frames/segment count~~ → **1 frame/segment is optimal** (sweep completed 2026-03-27)
- [x] ~~Integrate dense visual embedding into production pipeline~~ → `DenseVisualEmbedStep` added (PR #87)
- [x] ~~Decide on Gemini Flash annotation~~ → **Remove entirely** (confirmed zero retrieval impact)
- [ ] Full reindex of 141 videos with new pipeline
- [ ] v02 "screen coding with AI" still MISS — Gemini Embedding can't match text→code-editor-screenshot well enough
- [ ] Consider reducing `dense_visual_frames_per_segment` from 3 to 1 in `config/base.yaml` (saves ~60% embedding cost with no quality loss on current benchmark)

---

## Template for future entries

```markdown
## YYYY-MM-DD: [Title]

### Context
- What problem are we solving?
- What data/benchmark are we using?

### Changes made
- What was changed and why
- Data/metrics supporting the decision

### Results
- Before vs after metrics
- Any regressions noted

### Remaining bottlenecks
- What's still limiting quality?
```
