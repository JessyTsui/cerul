# Contributing to Cerul

Thanks for your interest in contributing.

Cerul is still in an early bootstrap phase, so the repository is intentionally lightweight. The goal right now is to keep the project easy to evolve while establishing clear contribution boundaries.

## Before You Start

Please keep these points in mind:

- public repository content should be written in English
- code, comments, commit messages, API payloads, and public-facing docs should be written in English
- internal strategy, prompts, evaluation assets, and proprietary data do not belong in this repository
- major architectural changes should be discussed before implementation

## Development Scope

Cerul currently has two product tracks:

- `broll`: lightweight semantic search over free stock footage
- `knowledge`: search and retrieval over knowledge-dense videos

They should continue to share one common platform backbone. Contributions that introduce a parallel primary stack, duplicate business logic, or unnecessary framework churn are unlikely to be accepted.

For agent-facing integrations, the default path is:

- direct HTTP API
- API key authentication
- installable skill

Please do not add an MCP layer unless there is a documented reason and a clear user need.

## Repository Structure

```text
frontend/     Next.js application
api/          Hono / Cloudflare Workers API
workers/      Indexing pipelines, background workers, and shared Python helpers
docs/         Public project docs
db/           Migrations and public-safe seeds
skills/       Installable agent skills
config/       Public-safe config defaults
scripts/      Local scripts and bootstrap helpers
```

## Branches

Use `main` as the source branch for new work.

Recommended naming:

- `feature/...`
- `fix/...`
- `docs/...`
- `chore/...`
- `refactor/...`

Agent-created branches may use the `codex/` prefix.

Examples:

- `feature/search-api`
- `fix/api-key-auth`
- `docs/readme-refresh`
- `codex/feature-broll-indexing`

## Commits

Write commit messages in short, imperative English.

Examples:

- `Add initial API route`
- `Fix API key hash lookup`
- `Document public repo scope`

Try to keep each commit focused on one logical concern.

## Pull Requests

All changes should go through a pull request.

Please keep PRs:

- focused
- reviewable
- limited to one main objective

PRs should include:

- a short summary
- affected directories
- any new env vars or config changes
- testing status
- screenshots for UI changes
- request/response examples for API changes when relevant

If tests are missing, say so explicitly.

## Issues

Use issues for:

- new features
- user-visible bugs
- architecture decisions
- infrastructure changes
- documented follow-up tasks

Issue titles should be written in English and describe the intended outcome clearly.

## Security and Sensitive Material

Do not commit:

- secrets
- `.env` files
- production exports
- internal prompts
- private evaluation sets
- model weights
- internal fundraising or strategy materials

If a file is useful internally but should not be public, keep it out of this repository.

Public-safe runtime defaults belong in `config/`. Secrets and provider credentials belong in `.env` or deployment platform env vars.

## Code Style

- Python: `snake_case`, 4-space indentation
- TypeScript / JSON / YAML: 2-space indentation
- React components: `PascalCase`
- keep business logic out of UI pages when possible
- keep heavy media processing inside workers, not API handlers

## Testing

There is no repo-wide test command yet.

When adding real modules, include tests alongside them whenever practical:

- Python tests: `test_*.py`
- web tests: `*.test.ts` or `*.test.tsx`

Prioritize coverage for:

- request validation
- usage and credit accounting
- pipeline step idempotency
- authentication paths
- retrieval helpers

## License

By contributing, you agree that your contributions will be licensed under the repository's [Apache 2.0](./LICENSE) license.
