# Scripts Workspace

This directory now only holds frontend-side local automation for the public-safe `cerul` web repository.

Current checked-in entrypoints:

- `scripts/dev.sh` starts the Next.js development server
- `scripts/ensure-local-infra.sh` reminds you that backend services now live in sibling repositories
- `./rebuild.sh` installs frontend dependencies, builds the app, and starts `scripts/dev.sh`

