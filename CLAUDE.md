# Cerul Frontend — Project Conventions

## Repository Scope

This repository is the public-safe server-side Next.js app for Cerul.

- `cerul-api` owns the Hono API, migrations, and OpenAPI source of truth
- `cerul-worker` owns indexing, media processing, and evaluation code
- this repo owns the web app, dashboard UI, auth surface, public docs pages, and the public OpenAPI copy

## Configuration Notes

- `.env` holds runtime URLs, Better Auth secrets, database access, OAuth credentials, and email settings.
- This is not a pure static frontend repo. Server-side auth flows still require `DATABASE_URL`.
- `BETTER_AUTH_SECRET` must match the value used by `cerul-api` for console proxy signing.

## Database (Better Auth + Console Support)

- Better Auth runs in this repo and connects directly to PostgreSQL.
- `frontend/lib/auth-db.ts` manages the shared connection pool and retry behavior.
- If the pool becomes poisoned after a connection failure in development, restart the Next.js dev server.

## Local Development

- `./rebuild.sh` installs frontend dependencies, builds the app, and starts the Next.js dev server.
- `./scripts/dev.sh` starts the frontend only.
- For full-stack local development, run `cerul-api` and `cerul-worker` from their sibling repositories.

## UI Notes

- Dashboard/admin API calls go through `/api/console/[...path]`, which signs requests and forwards them to `API_BASE_URL`.
- Dialogs and overlays should keep a z-index above the top navigation.

