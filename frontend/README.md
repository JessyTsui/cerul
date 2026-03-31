# Frontend Workspace

Cerul's web application lives in this directory.

## Scope

The frontend is responsible for:

- landing and marketing pages
- public documentation pages
- dashboard and demo surfaces

The frontend should consume Cerul's API instead of becoming the primary business logic layer.

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

## Auth Configuration

Cerul's frontend uses Better Auth for dashboard sessions.

- `BETTER_AUTH_SECRET` is required outside local development
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` enable Google OAuth
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` enable GitHub OAuth
- Google One Tap reuses the same Google OAuth client and is only shown on `/login`
- For Google One Tap, add every frontend origin to Authorized JavaScript origins
  in Google Cloud Console, including local development origins such as
  `http://localhost:3000`

## Routes in this scaffold

- `/` marketing home
- `/docs` public documentation landing page
- `/docs/[slug]` documentation subpages
- `/pricing` pricing page
- `/login` unified Better Auth page with email/password, GitHub, Google, and Google One Tap when configured
- `/signup` compatibility redirect to `/login?mode=signup`
- `/dashboard` private console overview
- `/dashboard/keys`, `/dashboard/usage`, `/dashboard/settings`
- `/admin/pipelines`, `/admin/workers`, `/admin/sources`, `/admin/content`
- `/api/demo/search` and `/api/demo/dashboard` mock API routes for the frontend demo
