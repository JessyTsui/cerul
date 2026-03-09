# Backend Workspace

This directory is reserved for the Cerul API service.

- framework: FastAPI
- primary concerns: auth, search orchestration, usage tracking, and billing hooks
- expected subdirectories: `app/`, `tests/`

Keep heavy media processing out of request handlers. Pipeline execution belongs in `workers/`.
