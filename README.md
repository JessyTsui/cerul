<div align="center">
  <h1>Cerul</h1>
  <p><strong>Video understanding search infrastructure for AI agents.</strong></p>
  <p>Search what is shown in videos, not just what is said.</p>
  <p>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache_2.0-1f6feb" /></a>
    <img alt="Status" src="https://img.shields.io/badge/status-bootstrap-111827" />
    <img alt="Model" src="https://img.shields.io/badge/model-open--core-0f766e" />
  </p>
</div>

---

> Cerul is being built for a part of the web that agents still struggle to use well: video.

## Overview

Cerul is an early-stage open-source project focused on video understanding for AI agents.

The goal is to make videos searchable in a way that goes beyond transcripts by capturing the information that appears on screen: slides, charts, product demos, code screens, whiteboards, and other visual evidence.

## What Cerul Is Building

Cerul currently has two product directions built on the same foundation:

| Track | Purpose | Description |
| --- | --- | --- |
| `broll` | Lightweight showcase | Semantic visual search over free stock footage sources such as Pexels and Pixabay |
| `knowledge` | Core product direction | Search and retrieval over talks, podcasts, keynotes, and other knowledge-dense videos |

Both tracks are intended to share the same core infrastructure:

- API layer
- indexing pipelines
- authentication and usage controls
- storage and retrieval primitives
- agent integrations

## Why This Exists

Web pages are already easy for agents to search. Video is not.

Cerul is aimed at the gap between raw video content and structured retrieval. The long-term focus is not transcript search alone, but a system that can index and retrieve the parts of a video that actually matter for reasoning and citation.

## Current Status

This repository is still in the bootstrap phase.

What exists today:

- public repository scaffold
- license and environment template
- project structure for frontend, backend, workers, docs, database migrations, and agent skills

What is not in the repository yet:

- production data
- internal evaluation assets
- tuned prompts and ranking parameters
- proprietary indexes or model weights

## Repository Layout

```text
frontend/     Next.js application
backend/      FastAPI service and backend modules
workers/      Indexing pipelines and job workers
docs/         Public architecture, API, product, and runbook docs
db/           Migrations and public-safe seed data
skills/       Installable agent skills for Codex / Claude-style clients
config/       Public-safe YAML config defaults and templates
scripts/      Bootstrap and local utility scripts
```

## Agent Integration Strategy

Cerul's first agent integration path is intentionally simple:

- expose a stable HTTP API
- authenticate with API keys
- provide an installable skill for Codex / Claude-style clients

MCP is not part of the first implementation plan. If it becomes useful later, it should be added as a thin adapter over the same backend API rather than as a second integration surface with its own business logic.

## Development Direction

The near-term build sequence is straightforward:

1. Establish the public project skeleton.
2. Implement the first end-to-end `broll` indexing and search flow.
3. Add the heavier `knowledge` ingestion and retrieval pipeline.
4. Add agent-facing integrations, starting with an installable skill.

## Open Source Scope

Cerul follows an open-core direction.

Public in this repository:

- application code
- pipeline framework
- agent integration artifacts
- local development scaffolding

Not public:

- production indexes
- user behavior data
- internal benchmarks
- proprietary training data
- tuned production prompts and parameters

## Community

- [Contributing Guide](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License

This repository is licensed under [Apache 2.0](./LICENSE).
