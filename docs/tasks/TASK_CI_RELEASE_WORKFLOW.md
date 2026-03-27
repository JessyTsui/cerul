# Task: CI/CD and Release Workflow

## Goal

Set up automated deployment pipelines and a version-based release workflow for the entire Cerul project:
- **CF Workers API** auto-deploys to staging on push to `main`, deploys to production on version tag
- **API type checking** runs in CI on every PR
- **Docker image** auto-builds and pushes to GitHub Container Registry on version tag
- Semantic versioning with git tags (`v1.0.0`, `v1.1.0`, etc.)

## Current State

- **Frontend (Vercel)**: Already auto-deploys on push to `main` — no changes needed
- **Backend API (CF Workers)**: Manual `npx wrangler deploy` only — needs automation
- **Workers (Docker)**: No image registry, manual `docker build` on VPS — needs automation
- **CI**: Exists in `.github/workflows/ci.yml` — runs frontend lint/build/test, backend test, workers test. Does NOT include API type checking
- **No staging environment** for CF Workers
- **No version tags or release process**

## Architecture After This Task

```
Feature branch → PR
  ├── CI runs (existing tests + new API type check)
  └── Vercel Preview deploy (automatic)

Merge to main
  ├── Vercel production deploy (automatic, existing)
  ├── CF Workers staging deploy (NEW — auto, to staging-api.cerul.ai)
  └── Docker image NOT built (only on tag)

Create tag v1.x.x
  ├── CF Workers production deploy (NEW — auto, to api.cerul.ai)
  ├── Docker image build + push to ghcr.io (NEW)
  └── GitHub Release created (NEW)
```

## Implementation Plan

### 1. Add CF Workers staging environment to wrangler.toml

Add a `[env.staging]` section to `api/wrangler.toml`. The staging environment should:
- Use a different Worker name: `cerul-api-staging`
- Bind to `staging-api.cerul.ai` custom domain
- Set `CERUL_ENV = "staging"`
- Set `API_BASE_URL = "https://staging-api.cerul.ai"`
- Share the same R2 bucket and other vars
- Secrets will be set manually via `wrangler secret put --env staging`

Reference the existing `api/wrangler.toml` for the production config structure.

### 2. Add API type check to existing CI workflow

Add a new job to `.github/workflows/ci.yml`:

```yaml
api-typecheck:
  name: API Type Check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
      working-directory: api
    - run: npx tsc --noEmit
      working-directory: api
```

This ensures API TypeScript code compiles cleanly on every PR.

### 3. Create staging deploy workflow

Create `.github/workflows/deploy-staging.yml`:

**Trigger:** Push to `main` when `api/` files change
**Action:** Deploy CF Workers to staging environment

```yaml
name: Deploy API Staging

on:
  push:
    branches: [main]
    paths:
      - 'api/**'

jobs:
  deploy:
    name: Deploy to CF Workers (staging)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
        working-directory: api
      - run: npx wrangler deploy --env staging
        working-directory: api
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### 4. Create production release workflow

Create `.github/workflows/release.yml`:

**Trigger:** Push of a version tag matching `v*` (e.g., `v1.0.0`)
**Actions:**
1. Deploy CF Workers to production
2. Build Docker image and push to GitHub Container Registry (`ghcr.io`)
3. Create a GitHub Release

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  packages: write

jobs:
  deploy-api:
    name: Deploy API to CF Workers (production)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
        working-directory: api
      - run: npx wrangler deploy
        working-directory: api
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

  build-worker-image:
    name: Build and Push Worker Docker Image
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}/worker
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  create-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    needs: [deploy-api, build-worker-image]
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Generate release notes
        id: notes
        run: |
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          if [ -n "$PREV_TAG" ]; then
            echo "notes<<EOF" >> "$GITHUB_OUTPUT"
            git log --pretty=format:"- %s (%h)" "${PREV_TAG}..HEAD" >> "$GITHUB_OUTPUT"
            echo "" >> "$GITHUB_OUTPUT"
            echo "EOF" >> "$GITHUB_OUTPUT"
          else
            echo "notes=Initial release" >> "$GITHUB_OUTPUT"
          fi
      - uses: softprops/action-gh-release@v2
        with:
          body: |
            ## What's Changed
            ${{ steps.notes.outputs.notes }}

            ## Deployments
            - **API**: Deployed to CF Workers (api.cerul.ai)
            - **Worker Image**: `ghcr.io/${{ github.repository }}/worker:${{ github.ref_name }}`

            ## How to deploy workers to VPS
            ```bash
            docker pull ghcr.io/${{ github.repository }}/worker:${{ github.ref_name }}
            # Update docker-compose.worker.yml image field, then:
            docker compose -f docker-compose.worker.yml up -d
            ```
```

### 5. Update docker-compose.worker.yml to support registry image

Update `docker-compose.worker.yml` so it can either build locally or pull from registry:

```yaml
services:
  worker:
    # For local build:
    # build:
    #   context: .
    #   dockerfile: Dockerfile
    # For registry (fill in version tag):
    image: ghcr.io/jessytsui/cerul/worker:latest
    env_file: .env
    environment:
      - WORKER_CONCURRENCY=6
      - LOG_LEVEL=INFO
    volumes:
      # Optional: mount YouTube cookies
      # - ./cookies.txt:/app/cookies.txt:ro
    restart: unless-stopped
```

Keep the `build:` section as comments so users can choose either approach.

### 6. Add Docker build test to CI

Add a job to `.github/workflows/ci.yml` that validates the Dockerfile builds successfully on PRs that touch worker code:

```yaml
docker-build-test:
  name: Docker Build Test
  runs-on: ubuntu-latest
  if: contains(github.event.pull_request.changed_files, 'Dockerfile') || contains(github.event.pull_request.changed_files, 'workers/')
  steps:
    - uses: actions/checkout@v6
    - uses: docker/build-push-action@v6
      with:
        context: .
        push: false
        tags: cerul-worker:test
```

Note: The `if` condition above is illustrative. Use `paths` filter or `dorny/paths-filter` action for reliable path-based triggering. A simpler approach: always run this job but use Docker layer caching to keep it fast.

## Required GitHub Secrets

These need to be added to the repo's Settings → Secrets → Actions:

| Secret | How to get |
|--------|-----------|
| `CLOUDFLARE_API_TOKEN` | CF Dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template |

`GITHUB_TOKEN` is automatic — no setup needed. It grants `packages:write` for ghcr.io.

## How to Use After Implementation

**Daily development:**
```bash
git checkout -b feature/xxx
# ... make changes, push, create PR
# CI runs tests + API type check
# Vercel creates preview deploy
# Review and merge to main
# → CF Workers staging auto-deploys
```

**Release to production:**
```bash
git tag v1.0.0
git push origin v1.0.0
# → CF Workers production deploys
# → Docker image pushed to ghcr.io
# → GitHub Release created
```

**Update VPS workers after release:**
```bash
# On each VPS:
docker pull ghcr.io/jessytsui/cerul/worker:1.0.0
docker compose -f docker-compose.worker.yml up -d
```

## Key Files to Reference

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Existing CI — add API type check job and Docker build test |
| `api/wrangler.toml` | Add `[env.staging]` section |
| `api/package.json` | Verify `npm ci` works, check scripts |
| `docker-compose.worker.yml` | Update to support registry image |
| `Dockerfile` | Reference for Docker build (don't modify) |

## Notes

- The staging CF Worker needs its own secrets. After the workflow is set up, run: `cd api && npx wrangler secret put DATABASE_URL --env staging` (and other secrets). Use the same values as production for now since they share the same Neon database.
- `CLOUDFLARE_API_TOKEN` must have permissions for both `cerul-api` (production) and `cerul-api-staging` workers.
- The Docker build uses GitHub Actions cache (`type=gha`) to speed up rebuilds — only changed layers get rebuilt.
- Version tags should follow semver: `v1.0.0` for initial release, `v1.1.0` for features, `v1.0.1` for patches.
