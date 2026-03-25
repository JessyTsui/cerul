# Auto-Optimize: Search Quality Loop

Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch/blob/master/program.md). An autonomous agent that iteratively tunes search parameters and logic, evaluates against a fixed benchmark, and keeps improvements.

## Core Idea

Karpathy's loop: modify code → commit → train → evaluate → keep/discard → never stop.

Our loop: modify search config → commit → run eval queries → compute NDCG → keep/discard → never stop.

## What's Fixed (Do Not Modify)

- **Evaluation dataset**: `eval/search_benchmark.json` — hand-curated queries with expected results
- **Evaluation script**: `scripts/eval_search.py` — runs all queries, computes NDCG@5 and MRR
- **Indexed data**: the videos and retrieval_units already in the database
- **API contract**: the search endpoint request/response schema

## What Can Be Modified

- `config/base.yaml` — search tuning parameters:
  - `mmr_lambda` (diversity vs relevance tradeoff, currently ~0.5)
  - rerank `top_n` (how many candidates to rerank)
  - candidate_limit multiplier
- `backend/app/search/unified.py` — retrieval logic:
  - candidate_limit formula
  - `_cap_per_video` limit
  - score blending between embedding similarity and rerank score
  - query preprocessing (expansion, rewriting)
  - snippet building strategy
- `backend/app/search/rerank.py` — rerank prompt and model selection
- `backend/app/search/answer.py` — answer generation prompt

## Metric

**Primary**: NDCG@5 (normalized discounted cumulative gain at position 5)
**Secondary**: MRR (mean reciprocal rank), Hit@3 (% of queries where a relevant result is in top 3)

## Experiment Loop

```
LOOP FOREVER:
  1. Read current config/code state
  2. Propose one change (parameter tweak, logic change, prompt edit)
  3. git commit -m "experiment: {description}"
  4. Run: python scripts/eval_search.py > eval.log 2>&1
  5. Read: grep "^ndcg@5:" eval.log
  6. If crashed: tail -50 eval.log, attempt fix, max 3 retries
  7. Log to results.tsv: commit | ndcg@5 | mrr | hit@3 | status | description
  8. If ndcg@5 improved → keep commit
  9. If equal or worse → git reset --hard HEAD~1
  10. NEVER STOP
```

## Results Logging

File: `eval/results.tsv` (untracked by git)

```
commit	ndcg5	mrr	hit3	latency_ms	status	description
a1b2c3d	0.7234	0.6812	0.7333	2450	keep	baseline
b2c3d4e	0.7456	0.7023	0.7667	2380	keep	increase candidate_limit to 48
c3d4e5f	0.7201	0.6790	0.7000	2510	discard	switch to cosine threshold 0.5
```

## Simplicity Criterion

Same as Karpathy's: a tiny NDCG improvement that adds ugly complexity is not worth it. Removing code and getting equal results is a win. When in doubt, simpler is better.

## Constraints

- Each eval run should complete in < 60 seconds (it's just API calls, not training)
- Do not modify the evaluation script or benchmark dataset
- Do not re-index videos (changing retrieval_units data is out of scope)
- Do not change the API response schema
- VRAM/memory is not a concern here (it's all network I/O)

## Evaluation Dataset

See `eval/search_benchmark.json`. Format:

```json
{
  "version": "1.0",
  "queries": [
    {
      "id": "q01",
      "query": "the exact search query",
      "intent": "what the user actually wants",
      "relevant_videos": ["video_id_1", "video_id_2"],
      "relevant_keywords": ["keyword that should appear in results"],
      "difficulty": "easy|medium|hard"
    }
  ]
}
```

---

## Example Evaluation Dataset

These queries reflect real use cases for Cerul's content (AI/tech/VC YouTube videos):

```json
{
  "version": "1.0",
  "queries": [
    {
      "id": "q01",
      "query": "How should AI startups approach enterprise sales?",
      "intent": "Find advice on selling AI products to enterprise customers",
      "relevant_keywords": ["enterprise", "sales", "AI", "GTM", "go-to-market"],
      "difficulty": "easy"
    },
    {
      "id": "q02",
      "query": "What are the strongest moats for AI companies?",
      "intent": "Find discussion about defensibility and competitive advantages in AI",
      "relevant_keywords": ["moat", "defensibility", "competitive advantage", "data", "network effects"],
      "difficulty": "easy"
    },
    {
      "id": "q03",
      "query": "Show me a slide comparing open source LLM architectures",
      "intent": "Find a visual frame showing an architecture comparison chart or table",
      "relevant_keywords": ["architecture", "open source", "DeepSeek", "Qwen", "GPT"],
      "difficulty": "medium"
    },
    {
      "id": "q04",
      "query": "Anthropic founder talking about building Claude Code",
      "intent": "Find the specific segment where Anthropic's co-founder discusses Claude Code development",
      "relevant_keywords": ["Anthropic", "Claude Code", "Boris", "coding"],
      "difficulty": "easy"
    },
    {
      "id": "q05",
      "query": "What metrics should I track for a Series A fundraise?",
      "intent": "Find venture capital advice about key metrics for fundraising",
      "relevant_keywords": ["Series A", "metrics", "ARR", "growth", "fundraise"],
      "difficulty": "medium"
    },
    {
      "id": "q06",
      "query": "reusable rocket first stage landing",
      "intent": "Find visual footage or discussion of rocket stage recovery/landing",
      "relevant_keywords": ["rocket", "reusable", "landing", "first stage", "launch"],
      "difficulty": "medium"
    },
    {
      "id": "q07",
      "query": "Why will coding become universal?",
      "intent": "Find arguments about AI making programming accessible to everyone",
      "relevant_keywords": ["coding", "universal", "AI", "programming", "everyone"],
      "difficulty": "easy"
    },
    {
      "id": "q08",
      "query": "Aaron Levie on why startups beat incumbents in AI",
      "intent": "Find the specific interview segment with Box CEO about startup advantages",
      "relevant_keywords": ["Aaron Levie", "Box", "startup", "incumbent", "advantage"],
      "difficulty": "easy"
    },
    {
      "id": "q09",
      "query": "chart showing AI agent market size or adoption curve",
      "intent": "Find a visual frame containing a chart about AI agent market",
      "relevant_keywords": ["agent", "market", "chart", "adoption", "growth"],
      "difficulty": "hard"
    },
    {
      "id": "q10",
      "query": "How did the $675M legal AI startup get built with no legal experience?",
      "intent": "Find the story of a legal tech founder without domain background",
      "relevant_keywords": ["legal", "AI", "startup", "no experience", "founder"],
      "difficulty": "easy"
    },
    {
      "id": "q11",
      "query": "transformer architecture explained simply",
      "intent": "Find an educational explanation of how transformers work",
      "relevant_keywords": ["transformer", "attention", "architecture", "explained"],
      "difficulty": "easy"
    },
    {
      "id": "q12",
      "query": "what is the FDE playbook for technical sales",
      "intent": "Find discussion about Field Development Engineer approach to selling technical products",
      "relevant_keywords": ["FDE", "field", "technical", "sales", "engineering"],
      "difficulty": "medium"
    },
    {
      "id": "q13",
      "query": "product demo of an AI coding tool",
      "intent": "Find a screen recording or demo of an AI-powered code editor",
      "relevant_keywords": ["demo", "coding", "Cursor", "AI", "product"],
      "difficulty": "medium"
    },
    {
      "id": "q14",
      "query": "Satya Nadella leadership advice",
      "intent": "Find the specific clip of Microsoft CEO sharing leadership insights",
      "relevant_keywords": ["Satya", "Nadella", "leadership", "Microsoft"],
      "difficulty": "easy"
    },
    {
      "id": "q15",
      "query": "为什么说80%的App会消失",
      "intent": "Find discussion about AI agents replacing traditional apps (Chinese query)",
      "relevant_keywords": ["app", "disappear", "agent", "OpenClaw"],
      "difficulty": "hard"
    },
    {
      "id": "q16",
      "query": "carbon capture startup removing CO2 emissions",
      "intent": "Find the video about a climate tech startup working on CO2 removal",
      "relevant_keywords": ["CO2", "carbon", "emissions", "climate", "startup"],
      "difficulty": "easy"
    },
    {
      "id": "q17",
      "query": "how Figma redesigned their website",
      "intent": "Find the design process discussion from Figma's team",
      "relevant_keywords": ["Figma", "redesign", "website", "design"],
      "difficulty": "easy"
    },
    {
      "id": "q18",
      "query": "slide showing ML training pipeline or data flow diagram",
      "intent": "Find a visual frame containing a technical ML diagram",
      "relevant_keywords": ["pipeline", "diagram", "training", "data flow", "ML"],
      "difficulty": "hard"
    },
    {
      "id": "q19",
      "query": "what went wrong with the AI bubble predictions",
      "intent": "Find analysis of AI hype vs reality, bubble concerns",
      "relevant_keywords": ["bubble", "hype", "predictions", "AI", "reality"],
      "difficulty": "medium"
    },
    {
      "id": "q20",
      "query": "Dylan Field on scaling a design tool company",
      "intent": "Find Figma founder's insights on company building and scaling",
      "relevant_keywords": ["Dylan Field", "Figma", "scaling", "design", "company"],
      "difficulty": "easy"
    },
    {
      "id": "q21",
      "query": "space data center startup launching servers into orbit",
      "intent": "Find the video about putting AI compute infrastructure in space",
      "relevant_keywords": ["space", "data center", "orbit", "launch", "inference"],
      "difficulty": "medium"
    },
    {
      "id": "q22",
      "query": "YC partner explaining how to get first users",
      "intent": "Find Y Combinator advice on early customer acquisition",
      "relevant_keywords": ["first users", "customers", "launch", "YC", "acquisition"],
      "difficulty": "easy"
    },
    {
      "id": "q23",
      "query": "stablecoin infrastructure for financial services",
      "intent": "Find discussion about crypto stablecoins in fintech context",
      "relevant_keywords": ["stablecoin", "financial", "crypto", "infrastructure"],
      "difficulty": "medium"
    },
    {
      "id": "q24",
      "query": "chemical manufacturing startup reinventing the industry",
      "intent": "Find the deep dive on a startup disrupting chemical production",
      "relevant_keywords": ["chemical", "manufacturing", "trillion", "industry"],
      "difficulty": "medium"
    },
    {
      "id": "q25",
      "query": "when should a startup pivot vs persevere",
      "intent": "Find founder advice on deciding whether to pivot",
      "relevant_keywords": ["pivot", "persevere", "decision", "startup", "advice"],
      "difficulty": "medium"
    }
  ]
}
```

Query design principles:
- **Easy**: direct title/speaker match, should always hit top 3
- **Medium**: semantic match needed, may require understanding context
- **Hard**: visual content queries or cross-language, tests multimodal retrieval
- Mix of English and Chinese queries (q15) to test multilingual capability
- Mix of "find a person saying X", "find a slide showing Y", "find a topic about Z"
