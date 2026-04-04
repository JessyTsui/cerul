---
name: cerul
description: Search indexed video knowledge with Cerul. Use when a user wants to find what was said, shown, or presented in videos, inspect Cerul usage, or integrate Cerul into an agent workflow. Requires CERUL_API_KEY and optionally CERUL_BASE_URL.
---

# Cerul

Cerul is a video understanding search API for AI agents.

Use this skill when the task involves:

- finding video segments by speech, visuals, slides, code, or on-screen text
- answering questions like "what did X say about Y?"
- checking Cerul credits, billing period, wallet balance, or rate limits
- wiring Cerul into scripts, agents, or local automation

## Preferred Integration Path

- If a Cerul MCP server is already configured in the current client, prefer the MCP tools.
- Otherwise call the public Cerul HTTP API directly.
- The first public contract includes only `POST /v1/search` and `GET /v1/usage`.
- Do not call private indexing endpoints from this skill.

## Authentication

- Read the API key from `CERUL_API_KEY`.
- Read the base URL from `CERUL_BASE_URL` if present.
- Default the base URL to `https://api.cerul.ai`.
- When calling the HTTP API directly, set `X-Cerul-Client-Source` to a stable identifier such as `skill/claude`, `skill/codex`, or `skill/opencode`.
- Never hardcode secrets or write them into repository files.
- If `CERUL_API_KEY` is missing, stop and ask the user to provide it through their environment.

## Base URL

```text
https://api.cerul.ai
```

## Public Endpoints

- `POST /v1/search`
- `GET /v1/usage`

## Search Request Schema

```json
{
  "query": "Sam Altman views on AI video generation tools",
  "max_results": 5,
  "ranking_mode": "rerank",
  "include_answer": true,
  "filters": {
    "speaker": "Sam Altman",
    "published_after": "2024-01-01",
    "min_duration": 60,
    "max_duration": 7200,
    "source": "youtube"
  }
}
```

### Search Request Fields

- `query`: required string, max 400 chars, must contain at least one non-whitespace character.
- `max_results`: optional integer, `1-50`, default `10`.
- `ranking_mode`: optional string, one of `embedding` or `rerank`, default `embedding`.
- `include_answer`: optional boolean, default `false`. Costs 2 credits instead of 1.
- `filters`: optional object.

### Search Filter Fields

- `speaker`: optional string.
- `published_after`: optional date string in `YYYY-MM-DD`.
- `min_duration`: optional integer, minimum `0`.
- `max_duration`: optional integer, minimum `0`.
- `source`: optional string such as `youtube`.

### Search Request Rules

- Do not invent a `search_type` field.
- Do not send `image` in this skill path. Image search is not part of the first public contract.
- If both `min_duration` and `max_duration` are present, `min_duration` must be less than or equal to `max_duration`.

## Search Response Schema

```json
{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.93,
      "rerank_score": 0.97,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AI video generation",
      "snippet": "Current AI video generation tools are improving quickly but still constrained by controllability.",
      "transcript": "Current AI video generation tools are improving quickly but still constrained by controllability, production reliability, and the ability to steer outputs precisely.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/hmtuvNfytjM/f0123.jpg",
      "duration": 7200,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223.0,
      "timestamp_end": 1345.0
    }
  ],
  "answer": "Sam Altman frames current AI video generation tools as improving quickly but still constrained by controllability and production reliability.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
}
```

### Search Response Fields

- `results`: array of search results.
- `answer`: optional string or null. Present only when `include_answer=true`.
- `credits_used`: integer.
- `credits_remaining`: integer.
- `request_id`: string matching `req_<24-hex-chars>`.

### Search Result Fields

- `id`: string.
- `score`: number from `0.0` to `1.0`.
- `rerank_score`: optional number or null.
- `url`: tracking URL to the source video.
- `title`: string.
- `snippet`: string.
- `transcript`: string or null.
- `thumbnail_url`: string or null.
- `keyframe_url`: string or null.
- `duration`: integer in seconds.
- `source`: string.
- `speaker`: string or null.
- `timestamp_start`: number or null.
- `timestamp_end`: number or null.

## Usage Response Schema

```json
{
  "tier": "free",
  "plan_code": "free",
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "credits_limit": 0,
  "credits_used": 18,
  "credits_remaining": 82,
  "wallet_balance": 82,
  "credit_breakdown": {
    "included_remaining": 0,
    "bonus_remaining": 82,
    "paid_remaining": 0
  },
  "expiring_credits": [],
  "billing_hold": false,
  "daily_free_remaining": 7,
  "daily_free_limit": 10,
  "rate_limit_per_sec": 1,
  "api_keys_active": 1
}
```

### Usage Response Fields

- `tier`: current subscription tier.
- `plan_code`: normalized billing plan code, currently `free`, `pro`, or `enterprise`.
- `period_start`: billing period start date in `YYYY-MM-DD`.
- `period_end`: billing period end date in `YYYY-MM-DD`.
- `credits_limit`: included monthly credits for the current tier.
- `credits_used`: credits used in the current billing period.
- `credits_remaining`: remaining spendable credits.
- `wallet_balance`: total spendable credits currently available.
- `credit_breakdown.included_remaining`: remaining subscription credits.
- `credit_breakdown.bonus_remaining`: remaining bonus credits.
- `credit_breakdown.paid_remaining`: remaining purchased credits.
- `expiring_credits[]`: objects with `grant_type`, `credits`, and `expires_at`.
- `rate_limit_per_sec`: maximum requests per second for the account.
- `api_keys_active`: number of active API keys.
- `billing_hold`: whether the account is blocked pending review.
- `daily_free_remaining`: remaining free searches for the current UTC day.
- `daily_free_limit`: total free searches per UTC day.

## Error Model

Every public error response uses:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "query must be 400 characters or fewer"
  }
}
```

### Error Codes

- `invalid_request`
- `unauthorized`
- `forbidden`
- `not_found`
- `rate_limited`
- `api_error`

### Common Cases

- `400` or `422`: invalid payload.
- `401`: missing, malformed, or invalid API key.
- `403`: inactive key, billing hold, or insufficient credits.
- `429`: rate limited. Respect the `Retry-After` header when present.
- `500+`: server-side error.

## Working Rules

- Match the user's language in your explanation, but keep API field names and payloads in English.
- Always include source URLs when the API returns them.
- Include timestamps when `timestamp_start` or `timestamp_end` is available.
- Keep claims grounded in the returned evidence. Do not hallucinate content that is not in the search results.
- Prefer one reusable helper over duplicating raw HTTP calls in multiple files.

## Minimal HTTP Examples

```bash
curl "${CERUL_BASE_URL:-https://api.cerul.ai}/v1/search" \
  -H "Authorization: Bearer $CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sam altman agi timeline",
    "max_results": 5,
    "ranking_mode": "rerank",
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "published_after": "2024-01-01"
    }
  }'
```

```bash
curl "${CERUL_BASE_URL:-https://api.cerul.ai}/v1/usage" \
  -H "Authorization: Bearer $CERUL_API_KEY"
```

## Minimal Python Example

```python
import os
import requests

base_url = os.environ.get("CERUL_BASE_URL", "https://api.cerul.ai")
api_key = os.environ["CERUL_API_KEY"]

search = requests.post(
    f"{base_url}/v1/search",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "query": "sam altman agi timeline",
        "max_results": 5,
        "ranking_mode": "rerank",
        "include_answer": True,
        "filters": {
            "speaker": "Sam Altman",
            "published_after": "2024-01-01",
        },
    },
    timeout=30,
)
search.raise_for_status()
print(search.json())

usage = requests.get(
    f"{base_url}/v1/usage",
    headers={"Authorization": f"Bearer {api_key}"},
    timeout=30,
)
usage.raise_for_status()
print(usage.json())
```

## Minimal TypeScript Example

```ts
const baseUrl = process.env.CERUL_BASE_URL ?? "https://api.cerul.ai";
const apiKey = process.env.CERUL_API_KEY;

if (!apiKey) {
  throw new Error("CERUL_API_KEY is required");
}

const response = await fetch(`${baseUrl}/v1/search`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: "sam altman agi timeline",
    max_results: 5,
    include_answer: true,
    filters: {
      speaker: "Sam Altman",
    },
  }),
});

if (!response.ok) {
  throw new Error(`Cerul request failed: ${response.status}`);
}

console.log(await response.json());
```
