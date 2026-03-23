# Cerul API Reference

Video understanding search API for AI agents. Index any video, then search what was said and shown through one public retrieval surface.

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

Search across unified retrieval units. Cerul automatically blends summary, speech, and visual matches. There is no `search_type` field.

#### Request

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 5,
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
| `query` | string | Yes | Natural-language query describing what you want to find |
| `max_results` | integer | No | Number of results to return (1-50, default: 10) |
| `include_answer` | boolean | No | Include a synthesized grounded answer |
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

#### Response

```json
{
  "results": [
    {
      "id": "unit_abc123",
      "score": 0.92,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline - Lex Fridman Podcast",
      "snippet": "I think AGI is coming sooner than most people expect, probably within the next few years...",
      "thumbnail_url": "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/vid_abc/f023.jpg",
      "duration": 7200,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1823.5,
      "timestamp_end": 1945.2,
      "unit_type": "speech"
    }
  ],
  "answer": "Sam Altman has consistently said AGI could arrive within the next few years, while framing progress in concrete product terms.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_abc123def456"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `results[].id` | string | Retrieval unit identifier |
| `results[].score` | float | Relevance score |
| `results[].url` | string | Cerul tracking URL that redirects to the source video |
| `results[].title` | string | Video title |
| `results[].snippet` | string | Snippet derived from transcript or visual evidence |
| `results[].thumbnail_url` | string | Video thumbnail |
| `results[].keyframe_url` | string or null | Keyframe image when available |
| `results[].duration` | integer | Video duration in seconds |
| `results[].source` | string | Source platform (`youtube`, `pexels`, `pixabay`, `upload`) |
| `results[].speaker` | string or null | Speaker name when available |
| `results[].timestamp_start` | float or null | Start timestamp in seconds |
| `results[].timestamp_end` | float or null | End timestamp in seconds |
| `results[].unit_type` | string | One of `summary`, `speech`, `visual` |
| `answer` | string or null | Optional synthesized answer when `include_answer=true` |

---

## Index API

### POST /v1/index

Submit a video URL for indexing. Indexing is free and requires an API key.

```bash
curl "https://api.cerul.ai/v1/index" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=abc123",
    "force": false
  }'
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Video URL to index |
| `force` | boolean | No | Re-index even if the video already exists |

Supported URLs:

- YouTube (`youtube.com/watch`, `youtu.be`, `youtube.com/shorts`)
- Pexels video pages
- Pixabay video pages
- Direct `.mp4`, `.webm`, `.mov`, `.m4v` URLs

#### Response

```json
{
  "video_id": "uuid-xxx",
  "status": "processing",
  "request_id": "req_xxx"
}
```

### GET /v1/index/{video_id}

Check indexing status for one video.

```json
{
  "video_id": "uuid-xxx",
  "status": "completed",
  "title": "Sam Altman on AGI",
  "duration": 7200,
  "units_created": 28,
  "created_at": "2026-03-21T10:00:00Z",
  "completed_at": "2026-03-21T10:03:45Z"
}
```

### GET /v1/index

List videos indexed by the current API key owner.

```bash
curl "https://api.cerul.ai/v1/index?page=1&per_page=20" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"
```

```json
{
  "videos": [
    {
      "video_id": "uuid-xxx",
      "title": "Sam Altman on AGI",
      "status": "completed",
      "units_created": 28,
      "created_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:03:45Z"
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 20
}
```

### DELETE /v1/index/{video_id}

Delete the current user's access to an indexed video.

```json
{
  "deleted": true
}
```

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

Check your current credit balance and usage statistics.

```bash
curl "https://api.cerul.ai/v1/usage" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"
```

```json
{
  "tier": "free",
  "period_start": "2026-03-01",
  "period_end": "2026-03-31",
  "credits_limit": 1000,
  "credits_used": 128,
  "credits_remaining": 872,
  "rate_limit_per_sec": 1,
  "api_keys_active": 1
}
```

---

## Pricing

| Operation | Credits |
|-----------|---------|
| `POST /v1/index` | Free |
| `GET /v1/index` | Free |
| `GET /v1/index/{video_id}` | Free |
| `DELETE /v1/index/{video_id}` | Free |
| `POST /v1/search` | 1 |
| `POST /v1/search` + `include_answer=true` | 2 |

---

## Code Examples

### Python

```python
import requests
import time

API_KEY = "YOUR_CERUL_API_KEY"
BASE_URL = "https://api.cerul.ai"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

submit = requests.post(
    f"{BASE_URL}/v1/index",
    headers=headers,
    json={"url": "https://www.youtube.com/watch?v=abc123"},
    timeout=30,
)
submit.raise_for_status()
video_id = submit.json()["video_id"]

while True:
    status = requests.get(
        f"{BASE_URL}/v1/index/{video_id}",
        headers=headers,
        timeout=30,
    )
    status.raise_for_status()
    payload = status.json()
    if payload["status"] in {"completed", "failed"}:
        break
    time.sleep(10)

search = requests.post(
    f"{BASE_URL}/v1/search",
    headers=headers,
    json={
        "query": "what did they say about AGI",
        "max_results": 5,
        "include_answer": True,
    },
    timeout=30,
)
search.raise_for_status()
print(search.json())
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
    }),
  });

  if (!response.ok) {
    throw new Error(`Cerul request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.results;
}
```

---

## Error Handling

The API uses standard HTTP status codes:

| Status | Description |
|--------|-------------|
| `200 OK` | Request successful |
| `202 Accepted` | Index request accepted and queued |
| `401 Unauthorized` | Missing or invalid API key |
| `404 Not Found` | Requested indexed video or tracking link does not exist |
| `422 Unprocessable Entity` | Invalid request payload or unsupported URL format |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server error |

Error response format:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Unsupported URL format"
  }
}
```
