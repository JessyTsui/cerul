# Frontend Workspace

Cerul's web application lives in this directory.

## Scope

The frontend is responsible for:

- landing and marketing pages
- public documentation pages
- dashboard and demo surfaces

The frontend should consume backend APIs instead of becoming the primary business logic layer.

## Stack

- Next.js App Router
- React
- Tailwind CSS v4
- TypeScript

## Commands

```sh
pnpm --dir frontend install
pnpm --dir frontend dev
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
```

## Deployment

Cerul's web app is ready to deploy to Vercel as a subdirectory app.

- set the Vercel project Root Directory to `frontend`
- keep `frontend/vercel.json` as the project-level Vercel config
- set `NEXT_PUBLIC_SITE_URL` to your canonical public origin when using a custom domain
- make sure `NEXT_PUBLIC_SITE_URL` matches the final host that users and crawlers land on, so canonical URLs and social cards do not point at a redirecting domain

If no custom public URL is provided, the app falls back to Vercel system environment
variables for metadata, canonical URLs, `robots.txt`, and `sitemap.xml`.

## Routes in this scaffold

- `/` marketing home
- `/docs` public documentation landing page
- `/docs/[slug]` documentation subpages
- `/pricing` pricing page
- `/login` and `/signup` auth mock pages
- `/dashboard` private console overview
- `/dashboard/keys`, `/dashboard/usage`, `/dashboard/settings`, `/admin/pipelines`
- `/api/demo/search` and `/api/demo/dashboard` mock API routes for the frontend demo
