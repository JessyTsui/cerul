# Scripts Workspace

This directory is reserved for local automation and bootstrap scripts.

Use it for:

- database initialization helpers
- local development utilities
- repeatable maintenance tasks that belong to the repository

Prefer checked-in scripts over one-off terminal snippets when the task will be repeated.

Current checked-in entrypoints:

- `scripts/dev.sh` starts the frontend and backend development servers together
- `./rebuild.sh` clears generated artifacts, reinstalls dependencies, and then runs `scripts/dev.sh`
