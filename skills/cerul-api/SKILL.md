---
name: cerul-api
description: Use Cerul's video search API from Codex or Claude-style agents. Trigger when a user wants to search videos with Cerul, inspect Cerul usage, or integrate Cerul search into scripts or agent workflows. Requires CERUL_API_KEY and optionally CERUL_BASE_URL.
---

# Cerul API

This is the primary agent integration path for the first phase of Cerul.

Use this skill when the task involves:

- querying Cerul search endpoints
- submitting videos to Cerul indexing endpoints
- checking Cerul API usage
- wiring Cerul into scripts, agents, or local automation
- debugging Cerul API authentication or request payloads

## Authentication

- Prefer API key authentication.
- Read the API key from `CERUL_API_KEY`.
- Read the base URL from `CERUL_BASE_URL` if present.
- Default base URL to `https://api.cerul.ai` when the env var is absent.
- Never hardcode keys or write secrets into repository files.
- If the key is missing, stop and ask the user to provide it through their environment.

OAuth is not the default path for this skill. Only use OAuth if Cerul later publishes an explicit OAuth flow for agent integrations.

## Supported Endpoints

- `POST /v1/search`
- `POST /v1/index`
- `GET /v1/index/{video_id}`
- `GET /v1/index`
- `DELETE /v1/index/{video_id}`
- `GET /v1/usage`

## Search Request Shape

```json
{
  "query": "sam altman agi timeline",
  "max_results": 5,
  "include_answer": true,
  "filters": {
    "speaker": "Sam Altman",
    "source": "youtube"
  }
}
```

There is no `search_type` field. Cerul uses one unified search surface and returns summary, speech, and visual matches together.

## Index Request Shape

```json
{
  "url": "https://www.youtube.com/watch?v=abc123",
  "force": false
}
```

## Working Rules

- Prefer direct HTTPS calls over inventing an SDK wrapper.
- Include source URLs and timestamps in the final answer when the API returns them.
- Match the user's language in your explanation, even though the API payload should stay English.
- For code tasks, write one small reusable helper instead of duplicating raw request code in many files.
- If the user wants to search their own video first, submit it to `POST /v1/index` and poll until the status is `completed` or `failed`.
- Search uses one unified surface. Do not invent a `search_type` field.

## Minimal HTTP Example

```bash
curl "${CERUL_BASE_URL:-https://api.cerul.ai}/v1/search" \
  -H "Authorization: Bearer $CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "sam altman agi timeline",
    "max_results": 5,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman"
    }
  }'
```

```bash
curl "${CERUL_BASE_URL:-https://api.cerul.ai}/v1/index" \
  -H "Authorization: Bearer $CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=abc123"
  }'
```

## Minimal Python Example

```python
import os
import requests
import time

base_url = os.environ.get("CERUL_BASE_URL", "https://api.cerul.ai")
api_key = os.environ["CERUL_API_KEY"]
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

submit = requests.post(
    f"{base_url}/v1/index",
    headers=headers,
    json={
        "url": "https://www.youtube.com/watch?v=abc123",
    },
    timeout=30,
)
submit.raise_for_status()
video_id = submit.json()["video_id"]

while True:
    status = requests.get(
        f"{base_url}/v1/index/{video_id}",
        headers=headers,
        timeout=30,
    )
    status.raise_for_status()
    payload = status.json()
    if payload["status"] in {"completed", "failed"}:
        break
    time.sleep(10)

response = requests.post(
    f"{base_url}/v1/search",
    headers=headers,
    json={
        "query": "sam altman agi timeline",
        "max_results": 5,
        "include_answer": True,
        "filters": {"speaker": "Sam Altman"},
    },
    timeout=30,
)
response.raise_for_status()
print(response.json())
```

## Minimal TypeScript Example

```ts
const baseUrl = process.env.CERUL_BASE_URL ?? "https://api.cerul.ai"
const apiKey = process.env.CERUL_API_KEY

if (!apiKey) {
  throw new Error("CERUL_API_KEY is required")
}

const res = await fetch(`${baseUrl}/v1/search`, {
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
})

if (!res.ok) {
  throw new Error(`Cerul request failed: ${res.status}`)
}

const data = await res.json()
console.log(data)
```
