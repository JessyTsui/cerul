# Cerul API Reference

Video understanding search API for AI agents. Search across indexed videos through one public retrieval surface.

## Base URL

```text
https://api.cerul.ai
```

## Authentication

All authenticated API requests use Bearer API keys.

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json"
```

Get your key from the [Cerul Dashboard](https://cerul.ai/dashboard).

---

## Search API

### POST /v1/search

Search across unified retrieval units. Cerul automatically blends speech, visual, and on-screen text evidence. There is no `search_type` field.

#### Request

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural-language query describing what you want to find (max 400 characters) |
| `max_results` | integer | No | Number of results to return (1-50, default: 10) |
| `ranking_mode` | string | No | `"embedding"` (default) or `"rerank"` |
| `include_answer` | boolean | No | Include a synthesized grounded answer. Search costs 1 credit by default, or 2 credits when `include_answer=true` |
| `filters` | object | No | Optional unified filters |

#### Filters

```json
{
  "speaker": "Sam Altman",
  "published_after": "2024-01-01",
  "min_duration": 60,
  "max_duration": 3600,
  "source": "youtube"
}
```

`image` search is not part of the first public contract yet.

#### Response

```json
{
  "results": [
    {
      "id": "unit_abc123",
      "score": 0.92,
      "rerank_score": 0.97,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline - Lex Fridman Podcast",
      "snippet": "I think AGI is coming sooner than most people expect, probably within the next few years...",
      "transcript": "I think AGI is coming sooner than most people expect, probably within the next few years, and the roadmap starts to look more concrete once the tooling matures.",
      "thumbnail_url": "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/vid_abc/f023.jpg",
      "duration": 7200,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1823.5,
      "timestamp_end": 1945.2
    }
  ],
  "answer": "Sam Altman has consistently said AGI could arrive within the next few years, while framing progress in concrete product terms.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `results[].id` | string | Retrieval unit identifier |
| `results[].score` | float | Relevance score |
| `results[].rerank_score` | float or null | Reranking score when `ranking_mode="rerank"` |
| `results[].url` | string | Cerul tracking URL that redirects to the source video |
| `results[].title` | string | Video title |
| `results[].snippet` | string | Snippet derived from transcript or visual evidence |
| `results[].thumbnail_url` | string or null | Video thumbnail |
| `results[].transcript` | string or null | Full ASR transcript text for the matched segment. May be null for visual-only segments. |
| `results[].thumbnail_url` | string or null | Video thumbnail |
| `results[].keyframe_url` | string or null | Keyframe image when available. Direct HTTPS URL to a JPEG — agents running in a terminal can render this inline (see [Rendering keyframes in the terminal](#rendering-keyframes-in-the-terminal)) |
| `results[].duration` | integer | Video duration in seconds |
| `results[].source` | string | Source platform (`youtube`, `pexels`, `pixabay`, `upload`) |
| `results[].speaker` | string or null | Speaker name when available |
| `results[].timestamp_start` | float or null | Start timestamp in seconds |
| `results[].timestamp_end` | float or null | End timestamp in seconds |
| `answer` | string or null | Optional synthesized answer when `include_answer=true` |
| `credits_used` | integer | Credits consumed by this request |
| `credits_remaining` | integer | Remaining spendable credits after this request |
| `request_id` | string | Request identifier in the form `req_<24-hex-chars>` |

---

## Public Contract Scope

The first public Cerul API contract includes only these authenticated endpoints:

- `POST /v1/search`
- `GET /v1/usage`

Index endpoints are intentionally omitted from the public contract for now, and are not part of the first SDK / MCP surface.

---

## Remote MCP

Cerul also exposes a hosted MCP endpoint for agents that support Streamable HTTP.

### Endpoint

```text
https://api.cerul.ai/mcp?apiKey=YOUR_CERUL_API_KEY
```

This MCP server is stateless and currently authenticates with the `apiKey` URL query parameter.

### Exposed Tools

- `cerul_search`
- `cerul_usage`

### cerul_search Tool Inputs

The MCP tool mirrors the public search contract, but flattens `filters` into top-level tool arguments:

```json
{
  "query": "Sam Altman views on AI video generation tools",
  "max_results": 5,
  "ranking_mode": "rerank",
  "include_answer": true,
  "speaker": "Sam Altman",
  "published_after": "2024-01-01",
  "min_duration": 60,
  "max_duration": 7200,
  "source": "youtube"
}
```

`cerul_usage` takes no arguments.

### Claude Code

```bash
claude mcp add --transport http cerul \
  "https://api.cerul.ai/mcp?apiKey=YOUR_CERUL_API_KEY"
```

### Codex

```bash
codex mcp add --transport http cerul \
  "https://api.cerul.ai/mcp?apiKey=YOUR_CERUL_API_KEY"
```

### Clients That Still Need a Stdio Bridge

Some clients still expect a local stdio server. In those environments, use a generic bridge such as `mcp-remote`:

```json
{
  "mcpServers": {
    "cerul": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.cerul.ai/mcp?apiKey=YOUR_CERUL_API_KEY"
      ]
    }
  }
}
```

---

## Rendering keyframes in the terminal

Each search result includes a `keyframe_url` pointing to a JPEG image of the most representative frame in that segment. AI agents running in a terminal can render this image inline — no browser required — using standard terminal graphics protocols.

### iTerm2 / WezTerm

```python
import httpx, base64

def show_keyframe(url: str, width_chars: int = 40) -> None:
    data = httpx.get(url).content
    b64 = base64.b64encode(data).decode()
    print(f"\x1b]1337;File=inline=1;width={width_chars};preserveAspectRatio=1:{b64}\x07")
```

### Kitty / Ghostty / WezTerm

```python
import httpx, base64

def show_keyframe(url: str) -> None:
    data = httpx.get(url).content
    b64 = base64.b64encode(data).decode()
    chunks = [b64[i:i+4096] for i in range(0, len(b64), 4096)]
    for i, chunk in enumerate(chunks):
        m = 0 if i == len(chunks) - 1 else 1
        header = f"a=T,f=100,m={m}" if i == 0 else f"m={m}"
        print(f"\x1b_G{header};{chunk}\x1b\\", end="")
    print()
```

### Usage in an agent tool

```python
results = cerul_search("Sam Altman on AGI", max_results=5)
for r in results:
    if r.get("keyframe_url"):
        show_keyframe(r["keyframe_url"])
    print(f"{r['title']} — {r['url']}\n")
```

Both protocols require a compatible terminal. iTerm2 and Kitty protocols are supported by iTerm2, Kitty, Ghostty, and WezTerm. If your terminal does not support either protocol, the escape sequences are silently ignored and only the text output is shown.

---

## Tracking URLs

Cerul search results return `results[].url` in the form `https://cerul.ai/v/{short_id}`.

- `GET /v/{short_id}` records a redirect event and immediately 302s to the source video
- `GET /v/{short_id}/detail` renders a Cerul detail page and records a page-view event
- `GET /v/{short_id}/go` records an outbound click and 302s to the source video

Tracking endpoints are public and do not require API keys.

---

## Usage API

### GET /v1/usage

Check your current credit balance, wallet breakdown, daily free allowance, and usage statistics.

```bash
curl "https://api.cerul.ai/v1/usage" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"
```

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
  "rate_limit_per_sec": 1,
  "api_keys_active": 1,
  "billing_hold": false,
  "daily_free_remaining": 7,
  "daily_free_limit": 10
}
```

---

## Pricing

| Operation | Credits |
|-----------|---------|
| `GET /v1/usage` | Free |
| `POST /v1/search` | 1 |
| `POST /v1/search` + `include_answer=true` | 2 |

All users also receive 10 free searches per UTC day. When a request uses the daily free allowance, `credits_used` is `0`.

---

## Code Examples

### Python

```python
import requests

API_KEY = "YOUR_CERUL_API_KEY"
BASE_URL = "https://api.cerul.ai"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

search = requests.post(
    f"{BASE_URL}/v1/search",
    headers=headers,
    json={
        "query": "what did they say about AGI",
        "max_results": 5,
        "include_answer": True,
        "ranking_mode": "rerank",
    },
    timeout=30,
)
search.raise_for_status()
print(search.json())

usage = requests.get(
    f"{BASE_URL}/v1/usage",
    headers=headers,
    timeout=30,
)
usage.raise_for_status()
print(usage.json())
```

### JavaScript / Node.js

```javascript
const API_KEY = process.env.CERUL_API_KEY;
const BASE_URL = "https://api.cerul.ai";

async function searchVideos(query) {
  const response = await fetch(`${BASE_URL}/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: true,
      ranking_mode: "rerank",
    }),
  });

  if (!response.ok) {
    throw new Error(`Cerul request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.results;
}

async function getUsage() {
  const response = await fetch(`${BASE_URL}/v1/usage`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Cerul request failed: ${response.status}`);
  }

  return response.json();
}
```

---

## Error Handling

The public API uses a stable JSON error envelope:

| HTTP Status | `error.code` | Description |
|-------------|--------------|-------------|
| `400` | `invalid_request` | Invalid JSON body or request validation error |
| `401` | `unauthorized` | Missing or invalid API key |
| `403` | `forbidden` | Inactive API key or insufficient credits |
| `404` | `not_found` | Route or resource not found |
| `422` | `invalid_request` | Payload is syntactically valid but semantically invalid |
| `429` | `rate_limited` | Rate limit exceeded |
| `500+` | `api_error` | Unexpected server error |

Error response format:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Unsupported URL format"
  }
}
```
