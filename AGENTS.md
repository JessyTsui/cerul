# Repository Guidelines

## Communication & Language
When collaborating in issues, reviews, or direct agent/user conversations, reply to the repository owner in Chinese by default.

Unless explicitly requested otherwise:

- code should be written in English
- public-facing docs should be written in English
- `README.md` content should be written in English
- identifiers, comments, commit messages, and API field names should be written in English

If a document is clearly internal-only and not intended for the public repository, Chinese is acceptable when that is more practical.

## Project Principles
Cerul is an open-core project. The codebase is public; the core moat is not.

Treat these as baseline project rules:

1. Data, indexes, prompts, internal evaluation assets, and model weights are not part of the public repository.
2. Public code should stay reusable and infrastructure-oriented.
3. Avoid adding stack changes unless there is a clear project-level decision to do so.
4. Prefer simple, maintainable building blocks over framework churn.
5. Keep the API layer thin and push heavy processing into workers.

## Product & Architecture Guardrails
Cerul has two tracks, `broll` and `knowledge`, but they should share one platform backbone.

Default architectural assumptions:

- frontend: Next.js
- api: Hono on Cloudflare Workers
- database: Neon PostgreSQL with pgvector
- auth: Better Auth
- heavy indexing and media processing: Python workers
- first agent integration path: installable skill over direct HTTP API

Do not introduce a second primary backend stack, ORM stack, or deployment platform without an explicit decision. In particular, do not casually pivot the project toward TanStack Start, Cloudflare D1, or Drizzle as the default foundation.

For agent integrations, keep the first phase simple:

- ship a documented HTTP API
- ship a skill that uses API keys
- do not add an MCP adapter unless there is clear external demand

Keep these boundaries intact:

- `api/` handles request orchestration, auth, usage, and API responses
- `workers/` handles indexing and other media-heavy processing
- `workers/common/` holds shared Python runtime helpers used by workers and evaluation scripts
- frontend pages should not become the primary business logic layer

Worker-side indexing should continue to follow a shared step-pipeline approach:

- keep indexing flows step-based and composable
- prefer shared context over ad hoc cross-step state passing
- keep idempotency in mind for every pipeline step
- avoid embedding heavy media logic directly inside API handlers

## Open Source Boundary
Assume everything inside this repository may become public.

Do not commit:

- internal strategy memos
- fundraising materials
- internal prompts
- internal benchmark sets
- production data exports
- proprietary ranking parameters
- secrets, local dumps, or ad hoc research files

If material is useful internally but not suitable for the repository, keep it under the local private workspace rather than adding it here.

## Project Structure & Module Organization
Cerul is organized as a lightweight monorepo with root-level product entrypoints. Put the Next.js app in `frontend/` (`app/`, `components/`, `lib/`) and the public API in `api/` (`src/routes`, `src/services`, `src/middleware`). Shared Python runtime helpers belong under `workers/common/` (`config/`, `embedding/`, `pipeline/`, `search/`, `sources/`, `storage.py`), while track-specific indexing flows live in `workers/broll` and `workers/knowledge`. Keep public-safe docs in `docs/`, migrations and seed data in `db/`, installable agent skills in `skills/`, public-safe config files in `config/`, and local automation scripts in `scripts/`.

Do not create a top-level `sdk/` just to wrap Cerul's own backend calls. An SDK only belongs in the repo once there is a real public client package to ship and version independently. Until then, frontend code should call backend APIs directly, and agent integrations should prefer a documented skill plus direct HTTP access. Treat MCP the same way: it is a future adapter, not a required first-class module in the initial repository layout.

## Build, Test, and Development Commands
This repository is still scaffold-first: no root `package.json`, `pyproject.toml`, or `Makefile` is committed yet. Today, the main setup command is:

```sh
cp .env.example .env
```

Use it to seed local secrets, runtime profile selection, and any optional env overrides before running new app code. Public-safe default config should live in `config/*.yaml`, not in `.env`. Frontend browser code must consume a derived public config subset rather than reading raw repo config files directly. When you add runnable modules, expose explicit commands close to that module and document them in both `README.md` and this file (for example, `pnpm --dir frontend dev` or `npm --prefix api run check`).

Current frontend commands:

```sh
pnpm --dir frontend install
pnpm --dir frontend dev
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
```

Current API commands:

```sh
npm --prefix api install
npm --prefix api run dev -- --env development --ip 127.0.0.1 --port 8787
npm --prefix api run check
```

Repository-level reset:

```sh
./rebuild.sh
./rebuild.sh --fast
```

## Coding Style & Naming Conventions
Match the target stack. Use `snake_case` for Python modules, functions, and worker steps (`knowledge`, `scene_threshold`), and `PascalCase` for React components with `camelCase` helpers. Prefer 4-space indentation in Python and 2 spaces in TypeScript, JSON, and YAML. Keep files narrowly scoped: API routing stays in `api/src/routes`, shared worker-side retrieval logic stays in `workers/common/search`, pipeline primitives stay in `workers/common/pipeline`, and app-only utilities stay inside the owning app.

Additional Cerul-specific expectations:

- keep architecture and internal planning docs out of version control unless explicitly meant to be public
- prefer English schema names, table names, env vars, and API payloads
- avoid placeholder-heavy code; create real module boundaries only when they are about to be used
- default to ASCII unless an existing file already uses non-ASCII text for a clear reason

## Testing Guidelines
No repo-wide test runner is defined yet, so add tests with each new module. Name Python tests `test_*.py`; name web tests `*.test.ts` or `*.test.tsx`. Cover happy paths and one failure case for new routers, pipeline steps, and shared search logic. If a PR ships without tests, explain the gap clearly.

For this project specifically, prioritize tests around:

- search request validation
- usage and credit accounting
- pipeline step idempotency
- vector retrieval helpers
- API authentication paths

## Branch, Commit, PR, and Issue Workflow

### Branches
Use `main` as the only long-lived integration branch.

Branch rules:

- start new work from the latest `main`
- keep branches short-lived
- delete merged branches
- do not commit directly to `main`

For agent-created branches, use the `codex/` prefix.

Recommended branch patterns:

- `codex/feature-search-api`
- `codex/fix-api-key-auth`
- `codex/docs-readme-refresh`
- `codex/chore-repo-bootstrap`
- `codex/refactor-broll-pipeline`

Keep branch names:

- lowercase
- English
- hyphenated
- scoped to one clear objective

### Commits
Commit messages should be short, imperative, and in English.

Good patterns:

- `Add initial API route`
- `Fix API key hash lookup`
- `Document public repo scope`
- `Refactor pipeline context handling`
- `Scaffold worker module structure`

Commit rules:

- one logical concern per commit
- avoid mixed commits that combine docs, refactors, and features unless tightly related
- do not use vague subjects such as `update`, `misc`, or `wip`
- prefer clean history over high commit volume

### Pull Requests
Every merge to `main` should go through a PR. Always create PRs as **ready for review** (not draft) unless the user explicitly asks for a draft. This is important because our CI triggers automated Codex reviews on non-draft PRs.

PR title rules:

- write titles in English
- use concise, outcome-focused wording
- match the main change, not the implementation detail

Recommended PR title patterns:

- `Add API key management skeleton`
- `Implement initial broll indexing flow`
- `Rewrite README for public repo`
- `Scaffold public repo structure`

PR body should include:

- summary of the change
- affected directories
- new env vars or configuration changes
- testing status
- screenshots for UI changes
- request/response examples for API changes

PR process rules:

- keep PRs focused and reviewable
- separate public repo cleanup from product logic when possible
- if architecture changes, explain the decision and tradeoffs explicitly
- if tests are missing, say why

Preferred merge rule:

- prefer squash merge for routine work to keep `main` readable
- keep multiple commits only when the sequence itself is meaningful

### Issues
Use issues for work that should be tracked publicly or discussed before implementation.

Open an issue when:

- adding a feature
- fixing a user-visible bug
- changing architecture or infrastructure direction
- introducing a new dependency or platform decision
- documenting a non-trivial follow-up task

An issue is not required for every tiny cleanup.

Recommended issue title patterns:

- `[Feature] Add broll search API`
- `[Bug] Usage endpoint returns wrong remaining credits`
- `[Docs] Clarify open-source scope`
- `[Infra] Add Neon migration workflow`
- `[Decision] Define indexing queue strategy`

Issue rules:

- titles should be in English
- keep titles short and searchable
- describe the expected outcome, not just the symptom
- include acceptance criteria when the task is implementation-driven

## Security & Configuration Tips
Never commit `.env`, provider credentials, or generated artifacts. Use `.env.example` as the source of truth for required private variables such as `OPENAI_API_KEY`, `DATABASE_URL`, and content API keys. Use `config/*.yaml` for commit-safe defaults and non-sensitive tuning values. Treat `publicConfig` as a code-level whitelist derived from those sources, not as a third configuration store.

If a change affects public docs or repository metadata, ensure the result still matches the intended open-source boundary of the project.
