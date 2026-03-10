# Cerul API Reference

Video understanding search API for AI agents. Search what is shown in videos, not just what is said.

## Base URL

```
https://api.cerul.ai
```

## Authentication

All API requests must include your API key in the Authorization header using the Bearer token format:

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json"
```

Get your API key from the [Cerul Dashboard](https://cerul.ai/dashboard).

---

## Search API

### POST /v1/search

Search for video content using semantic queries. Returns matching videos with direct URLs.

#### Request

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cinematic drone shot of coastal highway at sunset",
    "search_type": "broll",
    "max_results": 5,
    "filters": {
      "min_duration": 5,
      "max_duration": 30
    }
  }'
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query describing the video content you want |
| `search_type` | string | Yes | Either `"broll"` (stock footage) or `"knowledge"` (educational content) |
| `max_results` | integer | No | Number of results to return (1-50, default: 10) |
| `include_answer` | boolean | No | Include AI-generated summary for knowledge searches |
| `filters` | object | No | Additional filters based on search type |

#### B-roll Filters

```json
{
  "min_duration": 5,        // Minimum video length in seconds
  "max_duration": 60,       // Maximum video length in seconds
  "source": "pexels"        // Filter by source (pexels, pixabay)
}
```

#### Knowledge Filters

```json
{
  "speaker": "Sam Altman",       // Filter by speaker name
  "published_after": "2023-01-01" // Filter by publication date
}
```

#### Response

```json
{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.94,
      "title": "Aerial drone shot of coastal highway",
      "description": "Cinematic 4K drone footage of winding coastal road at golden hour with ocean views",
      "video_url": "https://videos.pexels.com/video-files/28192743/aerial-coastal-drone.mp4",
      "thumbnail_url": "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
      "duration": 18,
      "source": "pexels",
      "license": "pexels-license"
    }
  ],
  "credits_used": 1,
  "credits_remaining": 999,
  "request_id": "req_abc123xyz"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the result |
| `score` | float | Relevance score (0.0-1.0) |
| `title` | string | Video title |
| `description` | string | Video description |
| `video_url` | string | **Direct URL to the MP4 file** (valid for 24 hours) |
| `thumbnail_url` | string | URL to preview image |
| `duration` | integer | Video length in seconds |
| `source` | string | Content source (pexels, pixabay, youtube) |
| `license` | string | License type for usage rights |

**Knowledge-specific fields:**

| Field | Type | Description |
|-------|------|-------------|
| `timestamp_start` | float | Start time in seconds (for knowledge) |
| `timestamp_end` | float | End time in seconds (for knowledge) |
| `answer` | string | AI-generated summary (if `include_answer: true`) |

---

## Usage API

### GET /v1/usage

Check your current credit balance and usage statistics.

#### Request

```bash
curl "https://api.cerul.ai/v1/usage" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"
```

#### Response

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

## Code Examples

### Python

```python
import requests

API_KEY = "YOUR_CERUL_API_KEY"
BASE_URL = "https://api.cerul.ai"

# Search for b-roll footage
response = requests.post(
    f"{BASE_URL}/v1/search",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    },
    json={
        "query": "business handshake in modern office",
        "search_type": "broll",
        "max_results": 5
    }
)

data = response.json()

# Get the first video URL
if data["results"]:
    video_url = data["results"][0]["video_url"]
    print(f"Video URL: {video_url}")
```

### JavaScript/Node.js

```javascript
const API_KEY = 'YOUR_CERUL_API_KEY';
const BASE_URL = 'https://api.cerul.ai';

async function searchVideos(query, searchType = 'broll') {
  const response = await fetch(`${BASE_URL}/v1/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      search_type: searchType,
      max_results: 5
    })
  });

  const data = await response.json();
  return data.results;
}

// Usage
searchVideos('cinematic drone shot', 'broll')
  .then(results => {
    results.forEach(video => {
      console.log(`${video.title}: ${video.video_url}`);
    });
  });
```

### Using with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.cerul.ai/v1",
    api_key="YOUR_CERUL_API_KEY"
)

response = client.chat.completions.create(
    model="cerul-broll",
    messages=[{
        "role": "user",
        "content": "cinematic drone shot of coastal highway"
    }]
)

print(response.choices[0].message.content)
```

---

## Error Handling

The API uses standard HTTP status codes:

| Status | Description |
|--------|-------------|
| `200 OK` | Request successful |
| `400 Bad Request` | Invalid request parameters |
| `401 Unauthorized` | Missing or invalid API key |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Server error (rare) |

Error response format:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Missing required field: query"
  }
}
```

---

## Rate Limits

| Tier | Requests/second | Monthly Credits |
|------|-----------------|-----------------|
| Free | 1 | 1,000 |
| Builder ($20/mo) | 10 | 10,000 |
| Enterprise | Custom | Custom |

Rate limit headers are included in all responses:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1709856000
```

---

## Pricing

### Free Tier
- **$0/month**
- 1,000 credits
- 1 request/second
- Community support

### Builder Tier
- **$20/month**
- 10,000 credits
- 10 requests/second
- Priority support
- Usage analytics

### Enterprise
- Custom pricing
- Unlimited credits
- Custom rate limits
- SLA guarantee
- Dedicated support

---

## Support

- Documentation: https://cerul.ai/docs
- Dashboard: https://cerul.ai/dashboard
- GitHub: https://github.com/JessyTsui/cerul
- Email: team@cerul.ai
