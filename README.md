<div align="center">
  <br />
  <a href="https://cerul.ai">
    <img src="./assets/logo.png" alt="Cerul" width="80" />
  </a>
  <h1>Cerul</h1>
  <p><strong>Video understanding search API for AI agents.</strong></p>
  <p>Search what is shown in videos, not just what is said.</p>

  <p>
    <a href="https://cerul.ai/docs"><strong>Docs</strong></a> &middot;
    <a href="https://cerul.ai/docs#quickstart"><strong>Quickstart</strong></a> &middot;
    <a href="https://cerul.ai/docs#api-reference"><strong>API Reference</strong></a> &middot;
    <a href="https://cerul.ai/pricing"><strong>Pricing</strong></a> &middot;
    <a href="https://github.com/cerul-ai/cerul"><strong>GitHub</strong></a>
  </p>

  <p>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache_2.0-3b82f6?style=flat-square" /></a>
    <img alt="Status" src="https://img.shields.io/badge/status-beta-f97316?style=flat-square" />
    <img alt="Model" src="https://img.shields.io/badge/model-open--core-22c55e?style=flat-square" />
  </p>
</div>

<br />

<div align="center">
  <img src="./assets/screenshot-home.png" alt="Cerul — Copy, paste, run. Get video results in seconds." width="840" />
</div>

<br />

## Why Cerul

Web pages are easy for AI agents to search. **Video is not.**

Most video search today is limited to transcripts — what was *said*. Cerul goes further by indexing what is *shown*: slides, charts, product demos, code walkthroughs, whiteboards, and other visual evidence.

> [!NOTE]
> Cerul is in active development. The API is live at [cerul.ai](https://cerul.ai) — get a free API key to start.

## Quickstart

Index any video, then search it with one query:

```bash
curl "https://api.cerul.ai/v1/index" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=hmtuvNfytjM"
  }'
```

```bash
curl "https://api.cerul.ai/v1/search" \
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 3,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'
```

<details>
<summary><strong>Example search response</strong></summary>

```json
{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.96,
      "title": "Sam Altman on the Future of AI Creative Tools",
      "url": "https://cerul.ai/v/a8f3k2x",
      "snippet": "AI video generation tools are improving fast, but controllability and reliability still need work.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "keyframe_url": "https://cdn.cerul.ai/frames/hmtuvNfytjM/f012.jpg",
      "duration": 5400,
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223,
      "timestamp_end": 1345,
      "unit_type": "speech"
    }
  ],
  "answer": "Altman frames AI video generation as improving quickly, while noting that production-grade control is still the bottleneck.",
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_abc123xyz456"
}
```

</details>

## Features

| | Feature | Description |
|---|---|---|
| **Visual Retrieval** | Beyond transcripts | Index slides, charts, demos, and on-screen content — not just speech |
| **Unified Search** | One query surface | Search summaries, speech segments, and visual evidence without choosing a track |
| **Unified Indexing** | `POST /v1/index` | Index YouTube, Pexels, Pixabay, and direct video URLs on the same pipeline |
| **Agent-Ready** | Built for LLMs | Designed for tool-use and function calling — clean JSON in, clean JSON out |
| **Timestamp Precision** | Frame-accurate results | Every result comes with exact start/end timestamps and confidence scores |
| **Agent Integrations** | Skills + Remote MCP | Installable skills plus a hosted MCP endpoint for zero-install tool use |
| **Open Core** | Apache 2.0 | Public client surfaces and agent integrations are open source |

## Architecture

```text
frontend/     Next.js app — landing page, docs, dashboard, auth surface
docs/         Public-safe docs and API references
skills/       Agent skills for Codex / Claude-style clients
openapi.yaml  Public copy of the API contract
scripts/      Frontend-side local helpers
```

Private companion repositories:

- `cerul-api` — Hono / Cloudflare Workers API, migrations, OpenAPI source of truth
- `cerul-worker` — Python workers, evaluation assets, and Docker deployment

This repository is a public-safe server-side Next.js app. It still requires `DATABASE_URL` for Better Auth and a few server-side auth helpers, but it no longer contains the backend API or worker implementation.

## Development

```bash
# Frontend-only development in this repository
./rebuild.sh
pnpm --dir frontend dev

# Full-stack local development uses sibling repositories
(cd ../cerul-api && ./rebuild.sh)
(cd ../cerul-worker && ./rebuild.sh)
```

<details>
<summary><strong>Full command reference</strong></summary>

**Frontend**

```bash
pnpm --dir frontend install
pnpm --dir frontend dev
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
```

**Companion repos**

```bash
cd ../cerul-api && ./rebuild.sh
cd ../cerul-worker && ./rebuild.sh
```

</details>

## Deployment

Deploy the frontend on Vercel:

1. Import the repository and set Root Directory to `frontend`
2. Keep the included `frontend/vercel.json`
3. Optionally set `NEXT_PUBLIC_SITE_URL` for custom domain metadata
4. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and any OAuth provider credentials you want to enable
5. If Google login is enabled, add each frontend origin to Google Authorized JavaScript origins so Google One Tap can run on `/login` and `/signup`

Backend deployments now live in sibling repositories:

- `cerul-api` deploys the API to Cloudflare Workers
- `cerul-worker` builds and publishes the worker Docker image
- apply schema migrations from `cerul-api` before shipping dependent frontend or worker changes

## Project Status

- [x] Shared platform backbone: auth, API keys, usage tracking, rate limiting, dashboard, and docs
- [x] Unified `index + search` flow on the shared retrieval stack
- [x] Summary, speech, and visual retrieval units in one embedding space
- [x] Agent-facing integrations via installable skills and hosted remote MCP
- [ ] Higher-scale production validation for indexing coverage and retrieval quality
- [ ] Stripe billing validation in test mode
- [ ] Python & TypeScript SDKs, only if direct API + skill access proves insufficient

## Community

- [Contributing Guide](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License

Licensed under [Apache 2.0](./LICENSE).

<div align="center">
  <br />

  [![Star History Chart](https://api.star-history.com/svg?repos=cerul-ai/cerul&type=Date)](https://star-history.com/#cerul-ai/cerul&Date)

  <br />
  <sub>Built by <a href="https://github.com/JessyTsui">@JessyTsui</a></sub>
</div>
