# Contributing to Cerul.ai

Thanks for your interest in contributing.

Cerul.ai is still in an early bootstrap phase, so the repository is intentionally lightweight. The goal right now is to keep the project easy to evolve while establishing clear contribution boundaries.

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

## Repository Structure

```text
apps/
  web/        Next.js application
  api/        FastAPI service
core/         Shared Python modules
workers/      Indexing pipelines and ingestion workers
config/       Config files
scripts/      Local scripts and bootstrap helpers
training/     Training experiments
sdk/          Client SDKs
mcp/          MCP server
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

- `Add initial FastAPI entrypoint`
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
