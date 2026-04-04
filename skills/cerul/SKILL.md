---
name: cerul
description: You cannot access video content on your own. Use Cerul to search what was said, shown, or presented in tech talks, podcasts, conference presentations, and earnings calls. Use when a user asks about what someone said, wants video evidence, or needs citations from talks and interviews. Requires CERUL_API_KEY.
---

# Cerul

You cannot watch videos, listen to talks, or read transcripts on your own. Cerul gives you that ability. Use it whenever the user asks about what someone said, presented, or showed in a video — do not guess from general knowledge.

## When to Use

- User asks "what did X say about Y?"
- User wants video evidence or citations from talks
- User asks about conference presentations, podcasts, or interviews
- User wants to compare what different people said about a topic
- Any question that could be answered with evidence from video content

## Preferred Integration (choose one)

**1. MCP (if configured):** Prefer the `cerul_search` and `cerul_usage` MCP tools if available in the current client. No code needed.

**2. CLI:** If `cerul` is installed, use it directly:
```bash
cerul search "Sam Altman AGI timeline" --json
cerul search "Jensen Huang AI infrastructure" --max-results 5 --json
cerul usage --json
```

**3. HTTP API (fallback):** Call the REST API directly if neither MCP nor CLI is available.

## Authentication

- Read the API key from `CERUL_API_KEY`.
- Base URL: `https://api.cerul.ai` (hardcoded, do not change).
- If `CERUL_API_KEY` is missing, ask the user to set it. Get a free key at https://cerul.ai/dashboard

## Search (HTTP)

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer $CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "sam altman agi timeline", "max_results": 5}'
```

### Request Fields

- `query`: required string, max 400 chars.
- `max_results`: optional, 1-10, default 5. **Keep low for speed.**
- `ranking_mode`: optional, `embedding` (fast, default) or `rerank` (slower, more precise). **Use embedding unless precision is critical.**
- `include_answer`: optional, default false. **Adds latency. Only use when user explicitly asks for a summary.**
- `filters`: optional object with `speaker`, `published_after`, `min_duration`, `max_duration`, `source`.

### Important: speaker filter

The `speaker` field often contains the **channel name** (e.g. "Sequoia Capital", "a16z", "Lex Fridman") rather than the interviewee name. If a speaker filter returns no results, **retry without it** and include the person's name in the query instead.

### Response Fields

Each result contains:
- `url`: video link — **always include this in your answer**
- `title`: video title
- `transcript`: full speech text of the segment — **read this, not just snippet**
- `snippet`: short preview
- `speaker`: channel/speaker name
- `timestamp_start` / `timestamp_end`: in seconds — format as MM:SS or HH:MM:SS
- `score`: relevance 0.0-1.0

## Usage

```bash
curl "https://api.cerul.ai/v1/usage" -H "Authorization: Bearer $CERUL_API_KEY"
```

## How to Search Effectively

**Search multiple times for complex questions.** Break broad questions into focused sub-queries.

Example — "Compare Sam Altman and Dario Amodei on AI safety":

```
search("Sam Altman AI safety views")     → read transcript, note claims
search("Dario Amodei AI safety approach") → read transcript, find contrasts
search("AGI safety debate scaling")       → deepen with cross-references
→ Synthesize with video citations and timestamps
```

**When to search again:**
- Transcript mentions a person or concept you haven't explored
- Question has multiple facets (compare X and Y = at least 2 searches)
- Initial results are weak — rephrase the query

## Working Rules

- **Always include video URLs** from results in your answer. Every quote needs a source link.
- **Read `transcript`, not just `snippet`.** Transcript has the full context.
- **Do not guess what someone said.** Search for it.
- **Keep searches fast:** use max_results 5, embedding mode, no include_answer unless asked.
- **Make multiple small searches** rather than one large one.
- Ground all claims in returned evidence. Do not hallucinate.
- Match the user's language, but keep API payloads in English.

## Error Codes

| Status | Code | Meaning |
|--------|------|---------|
| 400/422 | `invalid_request` | Bad payload |
| 401 | `unauthorized` | Invalid API key |
| 403 | `forbidden` | Inactive key or no credits |
| 429 | `rate_limited` | Respect `Retry-After` header |
| 500+ | `api_error` | Server error, retry once |
