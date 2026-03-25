# Auto-Optimize: Indexing Quality Loop

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch/blob/master/program.md). An autonomous agent that iteratively tunes the video indexing pipeline parameters, re-indexes a small test set, evaluates retrieval quality, and keeps improvements.

## Core Idea

Karpathy's loop optimizes val_bpb by modifying train.py.
Our loop optimizes **retrieval recall** by modifying indexing pipeline parameters and re-processing a fixed set of test videos.

## What's Fixed (Do Not Modify)

- **Test video set**: 5 videos of different types (see below), already downloaded locally
- **Evaluation queries**: 10 queries per video with expected matches
- **Evaluation script**: `scripts/eval_indexing.py`
- **Pipeline structure**: the step sequence (download → transcribe → scene detect → frame analyze → segment → embed → store) does not change
- **Models used**: Groq Whisper, Gemini Flash, Gemini Embedding 2 — do not swap models

## What Can Be Modified

All in `workers/knowledge/runtime.py`:

| Parameter | Current | Range | Effect |
|-----------|---------|-------|--------|
| `scene_threshold` | 0.35 | 0.15-0.50 | Lower = more scenes (finer cuts) |
| `max_scene_seconds` | ~59s (derived) | 30-120 | Max duration before forced split |
| `pause_threshold` | ~3.6s (derived) | 1.0-6.0 | Min speech gap to trigger new scene |
| `MAX_INFORMATIVE_FRAMES` | 2 | 1-6 | Candidate frames extracted per scene |
| `MAX_ANNOTATED_FRAMES_PER_SCENE` | 1 | 1-5 | Frames sent to Gemini per scene |
| `MAX_ANNOTATED_FRAMES_PER_VIDEO` | 20 | 10-200 | Total Gemini annotation budget |
| `FRAME_SCENE_THRESHOLD` | 0.35 | 0.1-0.6 | ffmpeg scene filter sensitivity |
| skin_ratio threshold in `_is_informative_frame` | 0.45 | 0.3-0.6 | Talking head detection sensitivity |
| edge_ratio threshold in `_is_informative_frame` | 0.04 | 0.02-0.08 | Edge density for informative判定 |
| `TEXT_REGION_MIN_COUNT` | 8 | 3-15 | OCR text region detection sensitivity |
| `TEXT_REGION_MIN_AREA_RATIO` | 0.02 | 0.01-0.05 | Min text area to trigger annotation |
| Gemini frame annotation prompt | current | any | What Gemini looks for in frames |

Also modifiable:
- `_resolve_scene_route` logic — when to annotate vs embed_only vs text_only
- `HeuristicSceneDetector.detect_scenes` — scene splitting algorithm (add visual change detection)
- `_is_informative_frame` — talking head vs content frame判定 logic

## Metric

**Primary**: Recall@5 — for each eval query, is the correct video segment in the top 5 search results?
**Secondary**:
- Visual recall — % of visual queries (slide/chart/demo) that return the correct frame
- Segment precision — are the timestamp boundaries meaningful (not cutting mid-sentence)?
- Cost per video — Gemini API calls and tokens used

## Test Video Set

5 videos that cover different content types:

| # | Type | Duration | What to test |
|---|------|----------|-------------|
| 1 | **PPT-heavy keynote** | ~30min | Lots of slide transitions. Tests: scene detection catches slide changes, OCR extracts slide text, visual units have meaningful descriptions |
| 2 | **Two-person interview** | ~40min | Mostly talking heads, occasional B-roll cutaways. Tests: talking head filter works, rare visual moments (product demos, charts shown on screen) are caught |
| 3 | **Product demo / screencast** | ~15min | Screen recording with voiceover. Tests: frame analysis recognizes UI elements, code, terminal output |
| 4 | **Short-form vertical** | ~1min | Fast cuts, lots of visual changes. Tests: short video bias works, dense annotation for brief content |
| 5 | **Mixed format** | ~20min | Talking → slides → demo → whiteboard → talking. Tests: transitions between content types, visual_type classification accuracy |

## Experiment Loop

```
LOOP FOREVER:
  1. Read current parameter values
  2. Propose one parameter change (or logic change)
  3. git commit -m "index-experiment: {description}"
  4. Re-index the 5 test videos: python scripts/reindex_test_videos.py
  5. Run eval: python scripts/eval_indexing.py > eval.log 2>&1
  6. Read: grep "^recall@5:\|^visual_recall:\|^cost:" eval.log
  7. Log to eval/indexing_results.tsv
  8. If recall@5 improved → keep
  9. If worse → git reset --hard HEAD~1
  10. NEVER STOP
```

## Results Logging

File: `eval/indexing_results.tsv` (untracked)

```
commit	recall5	visual_recall	segments	cost_usd	status	description
a1b2c3d	0.6800	0.4000	342	0.05	keep	baseline
b2c3d4e	0.7200	0.5500	385	0.07	keep	increase MAX_ANNOTATED_FRAMES_PER_SCENE to 3
c3d4e5f	0.7000	0.6500	401	0.12	discard	annotate every frame (cost too high for marginal gain)
d4e5f6g	0.7400	0.6000	358	0.06	keep	lower skin_ratio threshold to 0.35
```

## Constraints

- Each re-index cycle takes ~10-15 minutes (5 videos × 2-3 min each)
- Gemini API cost per cycle should stay under $0.20
- Do not change the embedding model or dimension
- Do not change the transcription model
- Do not modify pipeline step order
- Simplicity criterion applies: marginal recall gain + ugly code = discard

## Cost Budget

Rough estimate per experiment cycle (5 test videos, ~100 min total):
- Groq Whisper: free (within daily limit)
- Gemini Flash annotations: $0.02-0.10 depending on frame count
- Gemini Embedding: ~free
- Total: $0.02-0.10 per cycle, budget ~$5/day = ~50 experiments

---

## Example Evaluation Dataset

Per-video queries that test different retrieval capabilities:

### Video 1: PPT-heavy keynote (e.g. "The 7 Most Powerful Moats For AI Startups")

```json
[
  {
    "id": "v1_q1",
    "query": "slide listing the 7 types of AI moats",
    "intent": "Find the specific slide that enumerates all moat types",
    "type": "visual",
    "difficulty": "medium"
  },
  {
    "id": "v1_q2",
    "query": "data moat vs network effect moat comparison",
    "intent": "Find the segment discussing differences between moat types",
    "type": "speech",
    "difficulty": "easy"
  },
  {
    "id": "v1_q3",
    "query": "chart showing market share or competitive landscape",
    "intent": "Find any chart/graph shown during the presentation",
    "type": "visual",
    "difficulty": "hard"
  },
  {
    "id": "v1_q4",
    "query": "why is proprietary data the strongest moat",
    "intent": "Find the argument about data as competitive advantage",
    "type": "speech",
    "difficulty": "easy"
  }
]
```

### Video 2: Two-person interview (e.g. "Aaron Levie: Why Startups Win In The AI Era")

```json
[
  {
    "id": "v2_q1",
    "query": "Aaron Levie explaining why incumbents struggle with AI",
    "intent": "Find Aaron's core argument about large company disadvantages",
    "type": "speech",
    "difficulty": "easy"
  },
  {
    "id": "v2_q2",
    "query": "Box's AI product strategy",
    "intent": "Find discussion about what Box is building with AI",
    "type": "speech",
    "difficulty": "medium"
  },
  {
    "id": "v2_q3",
    "query": "moment when they show a product demo or screenshot",
    "intent": "Find any visual content shown during the interview (if any)",
    "type": "visual",
    "difficulty": "hard"
  },
  {
    "id": "v2_q4",
    "query": "advice for founders competing against big tech in AI",
    "intent": "Find actionable advice segment for startup founders",
    "type": "speech",
    "difficulty": "medium"
  }
]
```

### Video 3: Product demo (e.g. "Cursor for Product Managers")

```json
[
  {
    "id": "v3_q1",
    "query": "screen recording of AI code editor in action",
    "intent": "Find the actual product demo screen capture",
    "type": "visual",
    "difficulty": "medium"
  },
  {
    "id": "v3_q2",
    "query": "how product managers can use Cursor without coding",
    "intent": "Find the explanation of non-engineer use cases",
    "type": "speech",
    "difficulty": "easy"
  }
]
```

### Video 4: Short-form (e.g. "The First 10-person, $100B Company")

```json
[
  {
    "id": "v4_q1",
    "query": "prediction about tiny teams building huge companies with AI",
    "intent": "Find the core thesis about AI enabling small teams",
    "type": "speech",
    "difficulty": "easy"
  },
  {
    "id": "v4_q2",
    "query": "visual showing company logos or examples",
    "intent": "Find any graphic/visual element in this short video",
    "type": "visual",
    "difficulty": "medium"
  }
]
```

### Video 5: Mixed format (e.g. "Inside The Startup Building Reusable Rockets")

```json
[
  {
    "id": "v5_q1",
    "query": "rocket engine test firing footage",
    "intent": "Find the B-roll footage of rocket engine tests",
    "type": "visual",
    "difficulty": "medium"
  },
  {
    "id": "v5_q2",
    "query": "technical diagram of the rocket's first stage design",
    "intent": "Find any technical illustration or CAD rendering shown",
    "type": "visual",
    "difficulty": "hard"
  },
  {
    "id": "v5_q3",
    "query": "founder explaining why reusable rockets reduce cost",
    "intent": "Find the cost argument for rocket reusability",
    "type": "speech",
    "difficulty": "easy"
  },
  {
    "id": "v5_q4",
    "query": "factory floor or manufacturing facility footage",
    "intent": "Find B-roll of the hardware manufacturing process",
    "type": "visual",
    "difficulty": "medium"
  }
]
```

### Cross-video queries (test diversity and ranking)

```json
[
  {
    "id": "cross_q1",
    "query": "founder with no industry experience building a successful startup",
    "intent": "Should match legal AI startup (no legal exp) and possibly others",
    "type": "speech",
    "difficulty": "medium"
  },
  {
    "id": "cross_q2",
    "query": "any slide or chart about AI market size",
    "intent": "Should find charts from any video that discusses AI market sizing",
    "type": "visual",
    "difficulty": "hard"
  },
  {
    "id": "cross_q3",
    "query": "YC partner giving tactical startup advice",
    "intent": "Should match multiple YC videos and rank the most tactical ones higher",
    "type": "speech",
    "difficulty": "easy"
  }
]
```

Query design principles:
- Each video has 2-4 queries covering both speech and visual retrieval
- `type: visual` queries specifically test frame analysis quality — these are the ones most affected by indexing parameter changes
- `difficulty: hard` queries are the frontier — baseline likely misses these, optimization should improve them
- Cross-video queries test ranking quality across the whole index
