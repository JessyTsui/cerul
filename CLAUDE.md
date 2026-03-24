# Cerul — Project Conventions

## Configuration Architecture

Runtime configuration is split into two layers by sensitivity:

### `.env` files — Secrets & credentials only
API keys, database URLs, auth secrets, third-party tokens.
- `.env.example` — template (committed to git)
- `.env` — local development (gitignored)
- `.env.production` — production deployment (gitignored)

### `config/*.yaml` — Non-sensitive parameters
Search thresholds, model names, feature flags, public URLs, tuning knobs.
- `config/base.yaml` — shared defaults
- `config/development.yaml` — local overrides
- `config/production.yaml` — production overrides

### Decision rule for new parameters

| Question | → Location |
|----------|-----------|
| Would leaking this value cause a security incident? | `.env` |
| Is this an API key, password, token, or connection string? | `.env` |
| Everything else (thresholds, model IDs, feature toggles, URLs) | `config/*.yaml` |

When adding a new parameter:
1. Add to **all three** `.env` files if it's a secret, or the relevant `config/*.yaml` if not
2. Keep the key list across `.env`, `.env.example`, and `.env.production` in sync at all times
