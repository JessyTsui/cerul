# Remote MCP Server & Agent Skills Distribution Plan

## Overview

This document plans two distribution channels for Cerul's AI agent integration:

1. **Remote MCP Server** (`mcp.cerul.ai/mcp/`) — zero-install, hosted MCP endpoint
2. **Agent Skills** (`cerul-ai/skills`) — cross-agent skill definitions

These complement the existing SDK packages (cerul-js, cerul-python) and replace the originally planned local MCP package (@cerul/mcp).

---

## Design Decisions

| Decision | Conclusion |
|----------|-----------|
| Local MCP package (@cerul/mcp) | **Not shipping.** Remote MCP is strictly better for a 2-endpoint API. No reason to ask users to run a local Node process |
| Remote MCP transport | **Streamable HTTP** (MCP spec 2025-03-26). Stateless, one POST endpoint |
| MCP hosting | **Same Cloudflare Workers deployment** as the main API. Route `/mcp` alongside `/v1/*` |
| MCP authentication | **API key in URL query param** (v1). OAuth 2.1 deferred to v2 |
| Skills distribution | **Main repo `skills/cerul/`** with `npx skills add` support. No separate repo |
| cerul-mcp repo | **Archived / paused.** MCP logic lives in the main `cerul` API codebase |

---

## Part 1: Remote MCP Server

### 1.1 Why Remote Over Local

| | Local (`npx @cerul/mcp`) | Remote (`mcp.cerul.ai/mcp/`) |
|--|--------------------------|------------------------------|
| Installation | Node.js required, npx download | **Nothing** |
| Updates | User runs npm update | **Automatic** (deploy = update) |
| Maintenance | Separate repo, separate CI, separate npm publish | **Zero** (part of main API) |
| Auth | API key in local env var | API key in URL, OAuth later |
| Compatibility | Only stdio-capable clients | **All MCP clients** (native or via mcp-remote bridge) |

For an API with 2 endpoints, maintaining a separate npm package is overhead with no benefit.

### 1.2 Architecture

```
User's AI agent (Claude Code / Cursor / Codex / ...)
        │
        │  HTTP POST (JSON-RPC over Streamable HTTP)
        ▼
  mcp.cerul.ai/mcp/?apiKey=cerul_sk_...
        │
        │  Cloudflare Workers (same deployment as api.cerul.ai)
        │  Hono route: /mcp
        │  ┌─────────────────────────────┐
        │  │ StreamableHTTPTransport      │
        │  │ ┌─────────────────────────┐  │
        │  │ │ MCP Server              │  │
        │  │ │  tool: cerul_search     │──┼──→ internal call to search service
        │  │ │  tool: cerul_usage      │──┼──→ internal call to usage service
        │  │ └─────────────────────────┘  │
        │  └─────────────────────────────┘
        ▼
  JSON-RPC response (application/json or text/event-stream)
```

The MCP server calls the search and usage services **internally** (same Worker), not through the public HTTP API. This avoids an extra network hop.

### 1.3 Exposed Tools

| Tool Name | Description | Maps To |
|-----------|-------------|---------|
| `cerul_search` | Search indexed videos for visual content, speech, and on-screen text | POST /v1/search |
| `cerul_usage` | Check credit balance, billing period, and rate limits | GET /v1/usage |

#### cerul_search Input Schema

```json
{
  "query": { "type": "string", "description": "Natural language search query (max 400 chars)" },
  "max_results": { "type": "number", "description": "1-50, default 5" },
  "include_answer": { "type": "boolean", "description": "AI summary (costs 2 credits instead of 1)" },
  "speaker": { "type": "string", "description": "Filter by speaker name" },
  "published_after": { "type": "string", "description": "YYYY-MM-DD" },
  "min_duration": { "type": "number", "description": "Minimum video duration in seconds" },
  "max_duration": { "type": "number", "description": "Maximum video duration in seconds" },
  "source": { "type": "string", "description": "Filter by source (e.g. youtube)" }
}
```

Note: MCP default `max_results` is 5 (not the API's 10) to keep agent context concise.

#### cerul_usage Input Schema

No input parameters.

### 1.4 Authentication

**V1: API key in URL query parameter**

```
POST https://mcp.cerul.ai/mcp/?apiKey=cerul_sk_...
```

The `/mcp` route handler extracts `apiKey` from the URL, validates it through the same auth logic used by `/v1/*`, and injects the authenticated context into the MCP server.

**V2 (future): OAuth 2.1**

When implemented, users can connect without exposing their API key:
```bash
claude mcp add --transport http cerul https://mcp.cerul.ai/mcp
# Opens browser → Cerul OAuth consent → token stored in keychain
```

OAuth requires:
- Authorization endpoint on cerul.ai
- Token endpoint
- PKCE support
- MCP Dynamic Client Registration (RFC 7591)

Deferred until there's user demand.

### 1.5 Implementation (Hono + @modelcontextprotocol/sdk)

The MCP route is added to the existing Hono API app. Using `@hono/mcp` for clean integration with Cloudflare Workers:

```typescript
// api/src/routes/mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";

export function createMcpRouter() {
  const router = new Hono();
  const transport = new StreamableHTTPTransport();

  function createServer(apiKey: string) {
    const server = new McpServer({
      name: "cerul",
      version: "1.0.0",
    });

    server.tool("cerul_search", "Search indexed videos ...", schema, async (params) => {
      // Call search service internally (not through HTTP)
      const result = await searchService.execute(apiKey, params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

    server.tool("cerul_usage", "Check credit balance ...", {}, async () => {
      const usage = await usageService.execute(apiKey);
      return { content: [{ type: "text", text: JSON.stringify(usage, null, 2) }] };
    });

    return server;
  }

  router.post("/mcp", async (c) => {
    const apiKey = new URL(c.req.url).searchParams.get("apiKey");
    if (!apiKey) return c.json({ error: "apiKey query parameter required" }, 401);
    // validate key, then handle MCP request
    const server = createServer(apiKey);
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  // GET and DELETE return 405 (stateless server)
  router.get("/mcp", (c) => c.json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  }, 405));

  return router;
}
```

Stateless mode (`sessionIdGenerator: undefined`) — each request creates a fresh MCP server. Simple, no state management, works perfectly on Cloudflare Workers.

### 1.6 Domain

**Option A: Subdomain `mcp.cerul.ai`** (recommended)
- Clean URL: `mcp.cerul.ai/mcp/`
- Points to the same Cloudflare Workers deployment
- Just a CNAME + route in wrangler.toml

**Option B: Path on `api.cerul.ai`**
- URL: `api.cerul.ai/mcp`
- No DNS change needed
- Slightly less discoverable

Recommend Option A for branding consistency (Tavily uses `mcp.tavily.com`).

### 1.7 Client Configuration

**Claude Code:**
```bash
claude mcp add --transport http cerul https://mcp.cerul.ai/mcp/?apiKey=cerul_sk_...
# Add --scope user for global availability
```

**Cursor / Windsurf / Cline (no native remote MCP support):**
```json
{
  "mcpServers": {
    "cerul": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.cerul.ai/mcp/?apiKey=cerul_sk_..."]
    }
  }
}
```

`mcp-remote` is a community package that bridges stdio ↔ Streamable HTTP. Users still need Node.js for this, but they're not installing our package — just a generic bridge.

**Codex:**
```bash
codex mcp add --transport http cerul https://mcp.cerul.ai/mcp/?apiKey=cerul_sk_...
```

---

## Part 2: Agent Skills

### 2.1 What Are Skills

Skills are markdown files that teach AI agents how to use your API. The agent reads the SKILL.md, understands the API contract, and writes HTTP requests itself. No runtime dependency, no process, just documentation that agents can act on.

Skills work across **all** AI coding tools:

| Agent | Skill Location |
|-------|---------------|
| Claude Code | `.claude/skills/` or `~/.claude/skills/` |
| Codex | `.agents/skills/` |
| Cursor | `.cursor/skills/` |
| Windsurf | `.windsurf/skills/` |
| Cline | `.cline/skills/` |
| opencode / openclaw | Project root or agent-specific dir |

The `npx skills add` CLI (from vercel-labs/skills) automates installation to the right directory.

### 2.2 Location

Skills live in the main `cerul` repo — no separate repo needed for a single SKILL.md:

```
cerul/
  skills/
    cerul/
      SKILL.md                # Single skill covering search + usage + best practices
  .claude-plugin/
    plugin.json               # Claude Code plugin manifest
    marketplace.json          # Claude Code marketplace listing
```

The existing `skills/cerul/` is the distributable version of the Cerul agent skill.

### 2.3 Skill Content

One SKILL.md covering everything — search, usage, best practices:

```yaml
---
name: cerul
description: |
  Search indexed video knowledge via the Cerul API. Use this skill when
  the user wants to find video segments by what was said, shown, or
  presented. Searches speech, visual content, and on-screen text.
  Also covers checking credit balance and rate limits.
  Requires CERUL_API_KEY environment variable.
---

# Cerul — Video Knowledge Search API

## When to Use
- User wants to search videos by content (speech, visuals, slides)
- User asks "find videos where...", "what did X say about...", etc.
- User needs timestamped evidence from video sources
- User wants to check API credits or rate limits

## Setup
export CERUL_API_KEY=cerul_sk_...

## Endpoints
- POST /v1/search — search indexed videos
- GET /v1/usage — check credits and rate limits

## Search Quick Start
curl https://api.cerul.ai/v1/search \
  -H "Authorization: Bearer $CERUL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query", "max_results": 5}'

## Request Parameters
[Full parameter table from API contract]

## Response Format
[Response schema with field descriptions]

## Rules
- Always include source URLs and timestamps in answers
- Match the user's language, keep API payloads in English
- Do not invent a search_type field — one unified search surface
- Only use search and usage endpoints (no index endpoints)
- include_answer costs 2 credits instead of 1

## Examples
[curl, Python, TypeScript examples]
```

The existing `skills/cerul/SKILL.md` in the main repo already follows this pattern. The `cerul-ai/skills` repo version will be a polished copy with Claude Code plugin metadata added.

### 2.4 Claude Code Plugin Manifest

`.claude-plugin/plugin.json`:
```json
{
  "name": "cerul",
  "version": "0.1.0",
  "description": "Cerul video search — find any moment by what was said, shown, or presented",
  "author": {
    "name": "Cerul AI"
  },
  "skills": "./skills/",
  "keywords": ["video", "search", "ai-agent", "mcp"],
  "category": "external-integrations"
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "owner": "cerul-ai",
  "repo": "skills",
  "description": "Search video knowledge from AI agents — speech, visuals, and on-screen text",
  "tags": ["video-search", "ai-agent", "api"],
  "category": "external-integrations"
}
```

### 2.5 Installation

**Via `npx skills add` (recommended, cross-agent):**
```bash
# Install from main repo
npx skills add cerul-ai/cerul --skill cerul

# Install globally
npx skills add cerul-ai/cerul --skill cerul -g
```

**Via Claude Code plugin:**
```bash
/plugin install https://github.com/cerul-ai/cerul
```

**Manual (any agent):**
```bash
# Copy to your agent's skill directory
curl -o ~/.claude/skills/cerul/SKILL.md \
  https://raw.githubusercontent.com/cerul-ai/cerul/main/skills/cerul/SKILL.md
```

### 2.6 Relationship Between Skills, Remote MCP, and SDKs

```
                         ┌─────────────────────────────────────┐
                         │           Cerul REST API            │
                         │  POST /v1/search  |  GET /v1/usage  │
                         └──────────┬────────────────┬─────────┘
                                    │                │
              ┌─────────────────────┼────────────────┼─────────────────────┐
              │                     │                │                     │
         Remote MCP             Skills            SDK (JS)           SDK (Python)
    mcp.cerul.ai/mcp/     cerul-ai/skills       cerul (npm)        cerul (PyPI)
              │                     │                │                     │
    Agent calls MCP tool    Agent reads doc     Developer imports   Developer imports
    → MCP calls API         → Agent calls API   → calls API        → calls API
              │                     │                │                     │
    Zero install            Zero install         npm install        pip install
    Structured tools        Flexible             Type-safe          Type-safe
    Reliable                Lightweight          Full control       Full control
```

Each channel serves a different use case:

| Channel | Best For |
|---------|---------|
| **Remote MCP** | AI agents that support MCP — structured, reliable tool calls |
| **Skills** | Any AI agent — zero dependency, works everywhere |
| **JS SDK** | JS/TS developers building apps with Cerul |
| **Python SDK** | Python developers building apps with Cerul |

They all hit the same REST API. Users pick whichever fits their workflow.

---

## Part 3: Vercel AI SDK Integration (@cerul/ai-sdk)

### 3.1 What It Is

A thin wrapper that exposes Cerul search as a Vercel AI SDK tool, so developers building AI apps can add video search in one line:

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { cerulSearch } from '@cerul/ai-sdk'

const result = await generateText({
  model: openai('gpt-4o'),
  tools: { search: cerulSearch({ apiKey: 'cerul_sk_...' }) },
  prompt: 'Find videos where Sam Altman discusses AGI timeline',
})
```

### 3.2 Why It Matters

Vercel AI SDK is the dominant framework for building AI-powered web apps in the Next.js ecosystem. Tavily, Exa, and other search APIs all ship AI SDK integrations. Without one, developers need to manually define tool schemas — friction that makes them pick a competitor.

### 3.3 Priority

**After** SDK + Remote MCP + Skills are stable. This is a growth channel, not a launch blocker.

### 3.4 Location

Published as `@cerul/ai-sdk` on npm. Source lives in `cerul-js` repo under `packages/ai-sdk/` (shares build tooling with the core SDK).

---

## Implementation Checklist

### Remote MCP Server (mcp.cerul.ai/mcp/)

- [ ] Add `@modelcontextprotocol/sdk` and `@hono/mcp` to API dependencies
- [ ] Implement `api/src/routes/mcp.ts` with cerul_search + cerul_usage tools
- [ ] Wire up API key extraction from URL query param
- [ ] Reuse existing search and usage service logic internally
- [ ] Add CNAME for `mcp.cerul.ai` → same Workers deployment
- [ ] Add `/mcp` route to wrangler.toml routes
- [ ] Test with Claude Code: `claude mcp add --transport http cerul https://mcp.cerul.ai/mcp/?apiKey=...`
- [ ] Test with Cursor via `mcp-remote` bridge
- [ ] Add `/mcp` endpoint documentation to cerul.ai/docs

### Agent Skills (main repo)

- [ ] Keep the distributable skill in `skills/cerul/`
- [ ] Polish `skills/cerul/SKILL.md` with full contract from `openapi.yaml`
- [ ] Add `.claude-plugin/plugin.json` + `marketplace.json` to repo root
- [ ] Test: `npx skills add cerul-ai/cerul --skill cerul` in Claude Code
- [ ] Test: same skill in Codex, Cursor
- [ ] Submit to skills marketplaces (FastMCP, LobeHub)

### Vercel AI SDK (@cerul/ai-sdk) — Phase 2

- [ ] Create `packages/ai-sdk/` in cerul-js repo
- [ ] Implement `cerulSearch()` tool factory with zod schema
- [ ] Publish to npm as `@cerul/ai-sdk`

---

## Updated Distribution Overview

```
cerul-ai/                          GitHub Organization
  cerul              ← public  | Main repo: API + Workers + Remote MCP + DB + Frontend + Docs + Skills
  cerul-js           ← public  | TypeScript SDK (cerul) + AI SDK (@cerul/ai-sdk)
  cerul-python       ← public  | Python SDK (cerul)
  cerul-mcp          ← PAUSED  | Not needed — remote MCP lives in main API
```

## Updated Priority

```
Phase 1: cerul-js + cerul-python (SDK core)           ← in progress
Phase 2: Remote MCP (mcp.cerul.ai/mcp/)               ← this plan
Phase 3: Agent skills (cerul-ai/skills)                ← this plan
Phase 4: @cerul/ai-sdk (Vercel AI SDK integration)
Phase 5: cerul-search (open-source CLI)
```
