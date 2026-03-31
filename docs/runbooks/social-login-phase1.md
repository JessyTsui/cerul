# Social Login Phase 1

This document captures Cerul's phase 1 login upgrade: what we planned, what was implemented, how to configure it, and how to validate it locally and in production.

## Summary

Cerul keeps a single authentication backbone:

- frontend: Next.js
- auth runtime: Better Auth
- database: PostgreSQL
- session surface: dashboard and console login

Phase 1 expands the existing email/password flow with:

- GitHub OAuth
- Google OAuth
- Google One Tap on `/login` and `/signup`

This phase does **not** introduce a second auth stack, passkeys, 2FA, Microsoft SSO, Apple sign-in, or web3/SIWE.

## Goals

- Preserve the current email/password login flow
- Add high-conversion social sign-in options that match Cerul's developer audience
- Keep dashboard sessions and API key authentication separate
- Avoid duplicate users when the same email signs in through Google, GitHub, and email/password
- Keep the UI functional when social providers are not configured

## Scope

### Included

- Better Auth social providers for GitHub and Google
- Better Auth account linking with trusted providers
- Google One Tap for anonymous users on `/login` and `/signup`
- Shared redirect handling through the existing `next` parameter
- Friendly callback error handling on auth pages
- Auth configuration docs for local and production setup

### Explicitly excluded

- Microsoft SSO
- Apple sign-in
- Passkeys
- 2FA
- SIWE / web3 wallet login
- Email verification rollout changes
- Password reset flow changes
- Public API authentication changes

## Implementation Overview

### 1. Provider configuration

Social providers are resolved from environment variables and only enabled when both the client ID and client secret are present.

Configured providers:

- `google`
- `github`

Provider parsing lives in:

- [frontend/lib/auth-providers.ts](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/lib/auth-providers.ts)

### 2. Better Auth server wiring

The Better Auth server continues to use PostgreSQL-backed sessions and now adds:

- `socialProviders.google`
- `socialProviders.github`
- `account.accountLinking.enabled = true`
- `account.accountLinking.trustedProviders = ["google", "github"]`
- `oneTap()` plugin when Google is configured

Server auth wiring lives in:

- [frontend/lib/auth-server.ts](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/lib/auth-server.ts)

### 3. Client auth wiring

The default client still handles:

- email/password sign-in
- email/password sign-up
- sign-out
- update user

A dedicated client factory is used for Google One Tap so the One Tap plugin only loads when Google is configured.

Client auth wiring lives in:

- [frontend/lib/auth.ts](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/lib/auth.ts)

### 4. Auth page UX

Both auth pages now follow the same order:

1. Continue with GitHub
2. Continue with Google
3. Email/password form

Behavior:

- social buttons only render when their provider is configured
- Google One Tap only attempts to initialize on `/login` and `/signup`
- One Tap failure or dismissal falls back to the normal social buttons and email/password form
- callback errors are rendered back on the auth page instead of failing silently

Main UI files:

- [frontend/components/auth/auth-social-section.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/components/auth/auth-social-section.tsx)
- [frontend/app/login/login-form.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/app/login/login-form.tsx)
- [frontend/app/signup/signup-form.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/app/signup/signup-form.tsx)
- [frontend/app/login/page.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/app/login/page.tsx)
- [frontend/app/signup/page.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/app/signup/page.tsx)

### 5. Redirect and header behavior

The existing `next` redirect path remains the single redirect mechanism.

This now applies consistently to:

- email/password sign-in
- email/password sign-up
- GitHub OAuth
- Google OAuth
- Google One Tap
- header Sign in / Sign up calls to action

Shared helpers live in:

- [frontend/lib/auth-shared.ts](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/lib/auth-shared.ts)
- [frontend/components/site-header-auth-actions.tsx](/Users/jessytsui/.codex/worktrees/3397/repo/frontend/components/site-header-auth-actions.tsx)

## Environment Configuration

Required for production:

- `BETTER_AUTH_SECRET`

Optional, but required to enable each provider:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Local setup:

```sh
cp .env.example .env
```

If no Google credentials are set:

- Google button is hidden
- Google One Tap does not initialize

If no GitHub credentials are set:

- GitHub button is hidden

## Google One Tap Requirements

Google One Tap reuses the same Google OAuth client.

In Google Cloud Console, configure:

- Authorized JavaScript origins
- Authorized redirect URIs for the Better Auth callback flow

Typical origins:

- `http://localhost:3000`
- `https://cerul.ai`

One Tap will not work correctly if the frontend origin is missing from Authorized JavaScript origins.

## Verification Checklist

### Automated checks

Run:

```sh
pnpm --dir frontend test
pnpm --dir frontend lint
pnpm --dir frontend build
```

### Manual checks

Verify these flows:

- email/password sign-up still works
- email/password sign-in still works
- sign-out still works
- GitHub sign-in creates a session and `user_profiles` row
- Google sign-in creates a session and `user_profiles` row
- a pre-existing email/password user signing in with the same Google email links to the same Cerul user
- a pre-existing email/password user signing in with the same GitHub email links to the same Cerul user
- `next` redirect works after email, GitHub, Google, and One Tap login
- Google One Tap only appears on `/login` and `/signup`
- auth pages still work when One Tap is dismissed, skipped, or unavailable
- admin access still resolves correctly for configured admin emails after social login

## Rollout Notes

- Phase 1 is safe to deploy with no provider credentials present because the new UI is configuration-gated
- Production rollout can happen incrementally:
  - deploy code first
  - add GitHub OAuth credentials
  - add Google OAuth credentials
  - enable Google One Tap once Authorized JavaScript origins are confirmed
- API key authentication is unchanged and remains the public API authentication mechanism

## Future Follow-ups

Good candidates for later phases:

- Microsoft SSO for team and enterprise accounts
- account settings UI for linked providers
- password reset and email verification improvements
- passkeys
- web3 / SIWE as an optional niche login path
