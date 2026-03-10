# Backend Workspace

Cerul's API service lives in this directory.

## Scope

- framework: FastAPI
- primary concerns: auth, search orchestration, usage tracking, and billing hooks
- keep heavy media processing out of request handlers
- keep ingestion and indexing execution in `workers/`

## Current scaffold

- `app/main.py` provides the FastAPI entrypoint
- `app/routers/health.py` exposes lightweight health and metadata routes
- `tests/` is the home for backend validation as the service expands

## Commands

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
backend/.venv/bin/pytest backend/tests
```
