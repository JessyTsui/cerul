# Cerul — Project Conventions

## Configuration Architecture

Runtime configuration is split into two layers by sensitivity:

### `.env` files — Secrets, credentials, and deployment-specific settings
API keys, database URLs, auth secrets, model names, embedding dimensions, URLs, feature flags.
- `.env.example` — template (committed to git)
- `.env` — local development (gitignored)
- `.env.production` — production deployment (gitignored)

### `config/base.yaml` — Algorithm and business parameters only
Search thresholds, rerank counts, scene detection sensitivity, download quality, feature toggles.
These are values that rarely change between environments.

### Decision rule for new parameters

| Question | Location |
|----------|----------|
| Is this a secret (API key, password, token, connection string)? | `.env` |
| Does this change between environments (URLs, model names, dimensions)? | `.env` |
| Is this a tuning knob that's the same everywhere (thresholds, top-N counts)? | `config/base.yaml` |

When adding a new parameter:
1. Add to **all three** `.env` files if it belongs in `.env`, keeping keys in sync
2. Only add to `config/base.yaml` if it's a pure algorithm/business parameter
