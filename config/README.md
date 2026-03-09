# Config Workspace

This directory holds versioned, public-safe runtime config for Cerul.

Rules:

- commit only values that are safe to publish
- keep secrets in the root `.env` file or deployment platform env vars
- prefer structured config files here over growing `.env` with non-secret tuning knobs
- treat env vars as overrides, not the primary store for application behavior

Recommended files:

- `base.yaml` for shared defaults
- `development.yaml` for local-safe overrides
- `production.yaml` for public production-safe overrides

Consumption model:

- backend and workers load `base.yaml` + one environment file + env overrides
- frontend server code should read only a whitelisted public subset
- `publicConfig` is a derived code-level export from `config/*.yaml` + env, not a separate source of truth
- browser code must not read raw files from this directory directly
- if `frontend/` is deployed from a subdirectory, generate or copy a public config artifact during build instead of assuming runtime filesystem access to the repo root

Safe candidates for this directory:

- search thresholds and ranking defaults
- enabled tracks and demo defaults
- public URLs and non-secret feature flags
- prompt template identifiers, but not private tuned prompt bodies

Do not put these here:

- API keys
- database passwords
- auth secrets
- webhook signing secrets
- proprietary production prompt contents
