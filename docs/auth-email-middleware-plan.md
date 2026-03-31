# Auth: Unified Login, Email System, Password Reset & Middleware

Implementation plan for Codex. All work is in `frontend/`.

---

## 0. UX Overhaul: Unified Login Page

### Current state
- Separate `/login` and `/signup` pages with `AuthModeSwitcher` tab component
- Signup form collects: full name, email, password, confirm password
- Login form collects: email, password, remember me

### Target state (like Resend)
- **Single `/login` page** handles both sign-in and sign-up
- Default view: social buttons (Google, GitHub) + email + password + "Log in" button
- Below the form: "Don't have an account? **Sign up**" text link
- Clicking "Sign up" expands/switches to show additional fields: full name + confirm password, and the button changes to "Create account"
- After signup, user is redirected to `/verify-email` to check their inbox
- `/signup` route should **redirect to `/login`** (backwards compatibility)

### Implementation

#### 0.1 Merge into a single form: `app/login/login-form.tsx`

Rewrite `login-form.tsx` to support both modes internally:

```
State: mode = "login" | "signup" (default: "login")
```

**Login mode (default):**
- Social buttons (Google, GitHub) at top
- "or" divider
- Email input
- Password input with "Forgot your password?" link
- "Log in" button
- Footer: "Don't have an account? **Sign up**" — clicking toggles mode to "signup"
- "By signing in, you agree to our Terms and Privacy Policy."

**Signup mode:**
- Social buttons (Google, GitHub) at top
- "or" divider
- Full name input
- Email input
- Password input (min 8 chars)
- Confirm password input
- "Create account" button
- Footer: "Already have an account? **Sign in**" — clicking toggles mode to "login"
- "By signing up, you agree to our Terms and Privacy Policy."

Mode switching is done via React state (no page navigation). The URL stays `/login` in both modes.

#### 0.2 Simplify `app/login/page.tsx`

Remove the `AuthModeSwitcher` import. The page just renders the unified `LoginForm`.

Update `AuthShell` props:
- Login mode: `heroTitle="Welcome back"`, `heroDescription="Sign in to your Cerul account."`
- Signup mode: `heroTitle="Get started"`, `heroDescription="Create your Cerul account to start searching video."`

The hero text should update when the mode toggles. Pass `mode` as state to the page, or have the form control the shell text via a callback/context.

Simpler approach: keep the AuthShell hero static with a neutral message that works for both:
- `heroTitle="Welcome to Cerul"`
- `heroDescription="The real-time video search engine for AI agents."`

#### 0.3 Redirect `/signup` to `/login`

Replace `app/signup/page.tsx` with a simple redirect:

```ts
import { redirect } from "next/navigation";

export default function SignupPage() {
  redirect("/login");
}
```

Or alternatively, keep `/signup` as a valid route that renders the same login page but with initial mode set to "signup" (via `?mode=signup` query param). This preserves any existing links to `/signup`.

#### 0.4 Delete unused files

- Delete `app/signup/signup-form.tsx` (logic merged into login-form.tsx)
- Delete `components/auth/auth-mode-switcher.tsx` (no longer needed)

#### 0.5 Update all internal links

Search the codebase for references to `/signup` and update:
- `app/page.tsx`: "Get API key" button links to `/signup` → change to `/login?mode=signup`
- `components/site-header.tsx` or `site-header-auth-actions.tsx`: any "Sign up" links
- `components/auth/auth-shell.tsx`: legal footer text
- Any other references

---

## 1. Prerequisites

### 1.1 Install Resend SDK

```bash
pnpm add resend
```

### 1.2 Environment Variables

Add to `.env`, `.env.example`, and `.env.production`:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=Cerul <noreply@cerul.ai>
```

Resend requires a verified domain. The domain `cerul.ai` must be verified in the Resend dashboard with DNS records (DKIM, SPF, DMARC).

---

## 2. Email Infrastructure

### 2.1 Create `lib/email.ts` — Resend client

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "Cerul <noreply@cerul.ai>";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(input: SendEmailInput) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set; skipping email send.");
    console.log(`[email] Would have sent to ${input.to}: ${input.subject}`);
    return;
  }

  await resend.emails.send({
    from: EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}
```

When `RESEND_API_KEY` is not set (local dev), log to console instead of sending. This avoids blocking local development.

### 2.2 Create `lib/email-templates.ts` — HTML email templates

All email templates must share a consistent, polished design. Requirements:

- **Brand-consistent**: Use Cerul's warm color palette — cream backgrounds, dark text, blue-gold accent gradient
- **Clean and modern**: Generous whitespace, rounded containers, clear hierarchy
- **Mobile-responsive**: Single-column layout, max-width 560px, inline CSS only (no external stylesheets)
- **Dark mode support**: Use `@media (prefers-color-scheme: dark)` with inverted colors
- **Accessibility**: Sufficient contrast ratios, semantic HTML, alt text on images

**Color palette (inline CSS):**
- Background: `#faf8f5` (light) / `#1a1714` (dark)
- Card background: `#ffffff` (light) / `#262220` (dark)
- Text primary: `#2c2418` (light) / `#e8e4dc` (dark)
- Text secondary: `#6b5d4f` (light) / `#a89b8c` (dark)
- Brand accent: `#88a5f2` (button backgrounds, links)
- Brand gradient: `linear-gradient(135deg, #88a5f2, #c5a55a)` (for decorative accent line at top of card)
- Border: `#e8e0d4` (light) / `#3d3530` (dark)
- Button text: `#ffffff`

**Shared layout structure (every template):**
1. Outer wrapper: full-width cream/dark background with padding
2. Inner card: white/dark rounded container (border-radius: 16px), subtle border, shadow
3. Top accent: 4px gradient bar at the top of the card (brand gradient)
4. Logo: Cerul text logo or SVG at top of card content (centered)
5. Content: heading, body text, CTA button (if applicable)
6. Footer: muted text with "Cerul — The video search layer for AI agents" and unsubscribe/help links

**CTA button style:**
- Background: `#88a5f2`, border-radius: 12px, padding: 14px 32px
- Font: 15px, font-weight 600, white text, no underline
- Fallback: plain text link below button for email clients that don't render buttons

**Templates to implement:**

#### `emailVerificationTemplate(params: { name: string; url: string })`
- Subject: "Verify your Cerul email"
- Heading: "Verify your email address"
- Body: "Hi {name}, thanks for signing up. Click below to verify your email and get started."
- CTA: "Verify email" button linking to `url`
- Footer note: "This link expires in 24 hours. If you didn't create a Cerul account, you can safely ignore this email."

#### `passwordResetTemplate(params: { name: string; url: string })`
- Subject: "Reset your Cerul password"
- Heading: "Reset your password"
- Body: "Hi {name}, we received a request to reset your password. Click below to choose a new one."
- CTA: "Reset password" button linking to `url`
- Footer note: "This link expires in 1 hour. If you didn't request this, you can safely ignore this email."

#### `welcomeTemplate(params: { name: string })`
- Subject: "Welcome to Cerul"
- Heading: "Welcome to Cerul, {name}!"
- Body: Brief welcome message. Mention: (1) 1,000 free search requests/month, (2) API key available in dashboard, (3) link to quickstart docs
- CTA: "Go to dashboard" button linking to `{SITE_URL}/dashboard`
- Secondary link: "Read the quickstart" linking to `{SITE_URL}/docs`

#### `passwordChangedTemplate(params: { name: string })`
- Subject: "Your Cerul password was changed"
- Heading: "Password changed"
- Body: "Hi {name}, your password was successfully changed. If you didn't make this change, contact support immediately."
- No CTA button needed
- Support link: "Contact support" linking to `mailto:support@cerul.ai`

---

## 3. Better Auth Configuration Updates

### 3.1 Enable email verification and password reset in `lib/auth-server.ts`

Better Auth has built-in support for email verification and forgot password. Enable them in the `betterAuth()` config:

```ts
import { oneTap } from "better-auth/plugins";
// Add these imports:
import { sendEmail } from "./email";
import {
  emailVerificationTemplate,
  passwordResetTemplate,
  welcomeTemplate,
  passwordChangedTemplate,
} from "./email-templates";
```

Update the `createAuth()` function — add to the `betterAuth({...})` config object:

```ts
emailAndPassword: {
  enabled: true,
  autoSignIn: true,
  requireEmailVerification: true,
  sendResetPassword: async ({ user, url }) => {
    await sendEmail({
      to: user.email,
      subject: "Reset your Cerul password",
      html: passwordResetTemplate({ name: user.name, url }),
    });
  },
},
emailVerification: {
  sendOnSignUp: true,
  autoSignInAfterVerification: true,
  sendVerificationEmail: async ({ user, url }) => {
    await sendEmail({
      to: user.email,
      subject: "Verify your Cerul email",
      html: emailVerificationTemplate({ name: user.name, url }),
    });
  },
},
```

### 3.2 Send welcome email on user creation

In the existing `databaseHooks.user.create.after` handler, add the welcome email send after `upsertUserProfile`:

```ts
databaseHooks: {
  user: {
    create: {
      async after(user) {
        await upsertUserProfile({
          id: user.id,
          email: user.email,
          name: user.name,
        });
        // Send welcome email (fire-and-forget, don't block auth flow)
        void sendEmail({
          to: user.email,
          subject: "Welcome to Cerul",
          html: welcomeTemplate({ name: user.name }),
        }).catch((err) => {
          console.error("[auth] Failed to send welcome email:", err);
        });
      },
    },
    // ... update hook stays the same
  },
},
```

### 3.3 Password change notification

Better Auth fires a hook when passwords change. Use it to send notification emails. Check Better Auth docs for the correct hook — it may be in `emailAndPassword.sendPasswordChangedEmail` or similar. If not available as a built-in hook, add it in the password change handler.

---

## 4. Forgot Password Page

### 4.1 Create `app/forgot-password/page.tsx`

Server component. Uses the `AuthShell` layout (same as login).

### 4.2 Create `app/forgot-password/forgot-password-form.tsx`

Client component (`"use client"`).

**UI:**
- Heading: "Reset your password"
- Description: "Enter the email address you signed up with and we'll send you a reset link."
- Email input field (same style as login form)
- Submit button: "Send reset link"
- Loading state: "Sending..."
- Success state: Show a success message "Check your inbox — we sent a reset link to {email}." with a back-to-login link. Hide the form.
- Error state: Show error inline (same red box as login forms)
- Bottom link: "Back to sign in" linking to `/login`

**Logic:**
```ts
await authClient.forgetPassword({ email, redirectTo: "/reset-password" });
```

---

## 5. Reset Password Page

### 5.1 Create `app/reset-password/page.tsx`

Server component. Uses the `AuthShell` layout. Reads `token` from search params and passes it to the form.

### 5.2 Create `app/reset-password/reset-password-form.tsx`

Client component.

**UI:**
- Heading: "Choose a new password"
- New password input (min 8 chars, with visibility toggle — reuse the same style)
- Confirm password input (with visibility toggle)
- Submit button: "Reset password"
- Loading state: "Resetting..."
- Success state: "Your password has been reset." with "Sign in" link
- Error state: inline error box
- If no token in URL: Show error "This reset link is invalid or expired." with link to `/forgot-password`

**Logic:**
```ts
await authClient.resetPassword({ newPassword, token });
```

On success, also send password-changed notification email (this should happen server-side via Better Auth hooks, not client-side).

---

## 6. Email Verification Page

### 6.1 Create `app/verify-email/page.tsx`

This page handles two scenarios:

**Scenario A — User lands here after clicking the verification link in their email:**
- The URL contains a verification token
- Better Auth handles the token verification via its built-in callback endpoint
- After verification, the user is auto-signed-in (configured above) and redirected to `/dashboard`
- If token is invalid/expired, show error with "Resend verification email" button

**Scenario B — User is redirected here after signup (unverified):**
- Show a "Check your email" message: "We sent a verification link to {email}."
- "Resend verification email" button
- "Back to sign in" link

### 6.2 Unverified user redirect

When `requireEmailVerification: true` is set, Better Auth will reject sign-in attempts from unverified users. The login form's error handler should detect this specific error and redirect to `/verify-email` with the email as a query param.

In `login-form.tsx`, after `authClient.signIn.email()`:

```ts
if (result.error?.code === "EMAIL_NOT_VERIFIED") {
  router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  return;
}
```

Check the exact error code Better Auth returns for unverified emails — it may be `email_not_verified` or similar.

---

## 7. Global Middleware

### 7.1 Create `middleware.ts` in `frontend/`

Next.js middleware runs on every request at the edge. Use it to protect authenticated routes and redirect unauthenticated users.

```ts
import { type NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/admin"];

// Routes only for unauthenticated users (redirect to dashboard if logged in)
const GUEST_ONLY_PATHS = ["/login", "/forgot-password", "/reset-password"];

const PUBLIC_PREFIXES = [
  "/api/",
  "/_next/",
  "/fonts/",
  "/docs",
  "/pricing",
  "/privacy",
  "/terms",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes and assets
  if (
    pathname === "/" ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  // Better Auth uses "better-auth.session_token" by default.
  // In production with useSecureCookies: true, it becomes "__Secure-better-auth.session_token".
  // Check the actual cookie name by inspecting browser cookies after login.
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ||
    request.cookies.get("__Secure-better-auth.session_token");
  const isAuthenticated = !!sessionCookie;

  // Protected routes: redirect to login if not authenticated
  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Guest-only routes: redirect to dashboard if already authenticated
  if (GUEST_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-.*|apple-touch-icon|logo\\.svg|robots\\.txt|sitemap\\.xml).*)",
  ],
};
```

**Important notes:**
- Middleware only checks for cookie **presence**, not validity. Full session validation still happens server-side in layouts (e.g., `dashboard/layout.tsx` calling `getConsoleViewer()`). Middleware is a fast first gate, layout is the authoritative check.
- Keep the existing `dashboard/layout.tsx` auth check as-is. Do **not** remove it.
- The `/verify-email` path should NOT be in `GUEST_ONLY_PATHS` — users may need to access it in various states.
- The `/signup` path is not listed because it just redirects to `/login`.

---

## 8. File Summary

| File | Action | Description |
|------|--------|-------------|
| `lib/email.ts` | Create | Resend client wrapper |
| `lib/email-templates.ts` | Create | 4 HTML email templates (verification, reset, welcome, password-changed) |
| `lib/auth-server.ts` | Modify | Enable email verification, password reset, welcome email hook |
| `app/login/page.tsx` | Modify | Simplify — remove AuthModeSwitcher, neutral hero text |
| `app/login/login-form.tsx` | Rewrite | Unified login/signup form with internal mode toggle |
| `app/signup/page.tsx` | Rewrite | Simple redirect to `/login` (or `/login?mode=signup`) |
| `app/signup/signup-form.tsx` | Delete | Logic merged into login-form.tsx |
| `components/auth/auth-mode-switcher.tsx` | Delete | No longer needed |
| `app/forgot-password/page.tsx` | Create | Forgot password page (server component) |
| `app/forgot-password/forgot-password-form.tsx` | Create | Forgot password form (client component) |
| `app/reset-password/page.tsx` | Create | Reset password page (server component) |
| `app/reset-password/reset-password-form.tsx` | Create | Reset password form (client component) |
| `app/verify-email/page.tsx` | Create | Email verification page (handles token + resend) |
| `middleware.ts` | Create | Global route protection middleware |
| `.env.example` | Modify | Add `RESEND_API_KEY` and `EMAIL_FROM` |
| `.env` | Modify | Add `RESEND_API_KEY` and `EMAIL_FROM` |
| `.env.production` | Modify | Add `RESEND_API_KEY` and `EMAIL_FROM` |
| `package.json` | Modify | Add `resend` dependency |

Also update any files that link to `/signup`:
- `app/page.tsx` — "Get API key" button
- `components/site-header.tsx` or `site-header-auth-actions.tsx` — header links
- `components/auth/auth-shell.tsx` — legal footer

---

## 9. Design Constraints

- The unified login page must use the existing `AuthShell` component for layout
- All form styling must match the existing login form exactly (same input styles, button styles, error box styles, icon styles)
- The mode toggle ("Don't have an account? Sign up" / "Already have an account? Sign in") is a text link, not a tab — simpler than the current `AuthModeSwitcher`
- Email templates must use **inline CSS only** — no Tailwind, no external stylesheets, no `<style>` blocks (many email clients strip them)
- Email templates should degrade gracefully in plaintext email clients
- Social-login users (Google/GitHub) don't have passwords — if a social-only user tries forgot-password, show: "This account uses Google/GitHub sign-in. No password to reset."
- The middleware must not break `/api/auth/*` routes (Better Auth callbacks) or `/api/console/*` routes (session header forwarding)
- Do **not** remove the existing auth check in `dashboard/layout.tsx` — the middleware is additive

---

## 10. Testing Checklist

- [ ] `/login` shows login form by default (email, password, social buttons)
- [ ] Clicking "Sign up" toggles to signup mode (adds name + confirm password fields)
- [ ] Clicking "Sign in" toggles back to login mode
- [ ] `/signup` redirects to `/login`
- [ ] Email/password signup sends verification email (or logs to console if no RESEND_API_KEY)
- [ ] After signup, user is redirected to `/verify-email`
- [ ] Unverified user cannot sign in; sees "verify your email" prompt
- [ ] Clicking verification link in email verifies account and signs user in
- [ ] "Resend verification email" button works
- [ ] Forgot password sends reset email
- [ ] Reset password link works and sets new password
- [ ] Password change triggers notification email
- [ ] Welcome email sent on first signup
- [ ] Social login (Google/GitHub) skips email verification (already verified by provider)
- [ ] Middleware redirects unauthenticated users from `/dashboard` to `/login`
- [ ] Middleware redirects authenticated users from `/login` to `/dashboard`
- [ ] Middleware does not block public pages (`/`, `/docs`, `/pricing`, `/privacy`, `/terms`)
- [ ] Middleware does not block API routes (`/api/auth/*`, `/api/console/*`)
- [ ] All email templates render correctly in Gmail, Apple Mail, Outlook
- [ ] Email templates look good in dark mode
- [ ] All new pages use AuthShell and match existing visual style
