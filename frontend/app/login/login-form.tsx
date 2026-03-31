"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { AuthModeSwitcher } from "@/components/auth/auth-mode-switcher";
import { AuthSocialSection } from "@/components/auth/auth-social-section";
import { authClient } from "@/lib/auth";
import type { AuthSocialProviderId } from "@/lib/auth-providers";
import { buildAuthPageHref, getAuthErrorMessage } from "@/lib/auth-shared";

type LoginFormProps = {
  nextPath: string;
  enabledProviders: AuthSocialProviderId[];
  googleOneTapClientId: string | null;
  initialError?: string | null;
};

export function LoginForm({
  nextPath,
  enabledProviders,
  googleOneTapClientId,
  initialError = null,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      });

      if (result.error) {
        setError(
          getAuthErrorMessage(result.error, "Unable to sign in with that account."),
        );
        return;
      }

      startTransition(() => {
        router.replace(nextPath as Route);
        router.refresh();
      });
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, "Unable to sign in right now."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
      <AuthModeSwitcher activeMode="login" nextPath={nextPath} />

      <div className="space-y-4 pt-2">
        <AuthSocialSection
          mode="login"
          nextPath={nextPath}
          enabledProviders={enabledProviders}
          googleOneTapClientId={googleOneTapClientId}
          onErrorChange={setError}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="login-email">
            Work email
          </label>
          <div className="auth-input-shell" data-leading-icon="true">
            <span className="auth-input-leading-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </span>
            <input
              id="login-email"
              className="auth-input"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="login-password">
              Password
            </label>
            <a
              href="mailto:support@cerul.ai?subject=Cerul%20password%20help"
              className="text-xs text-[var(--foreground-tertiary)] transition hover:text-[var(--foreground-secondary)]"
            >
              Forgot password?
            </a>
          </div>
          <div className="auth-input-shell" data-leading-icon="true">
            <span className="auth-input-leading-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
            </span>
            <input
              id="login-password"
              className="auth-input !pr-12"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--foreground-tertiary)] transition hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--foreground-secondary)]"
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3 21 21" />
                  <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                  <path d="M16.68 16.67A10.94 10.94 0 0 1 12 18C7 18 3.73 14.89 2 12c.92-1.55 2.14-3.01 3.65-4.16" />
                  <path d="M9.88 5.09A11 11 0 0 1 12 5c5 0 8.27 3.11 10 6-1.01 1.7-2.41 3.3-4.17 4.5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-[var(--foreground-secondary)]">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] bg-transparent accent-[var(--brand)]"
          />
          Remember me
        </label>

        {error ? (
          <div className="rounded-[18px] border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] px-4 py-3 text-sm text-[var(--error)]">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="button-primary w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </div>

      <p className="text-center text-sm text-[var(--foreground-tertiary)]">
        Don&apos;t have an account?{" "}
        <Link
          href={buildAuthPageHref("/signup", nextPath) as Route}
          className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
