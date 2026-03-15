"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { AuthModeSwitcher } from "@/components/auth/auth-mode-switcher";
import { authClient } from "@/lib/auth";
import { buildAuthPageHref, getAuthErrorMessage } from "@/lib/auth-shared";

type SignupFormProps = {
  nextPath: string;
};

export function SignupForm({ nextPath }: SignupFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedName = fullName.trim().replace(/\s+/g, " ");
    const [trimmedFirstName, ...lastNameParts] = normalizedName.split(" ");
    const trimmedLastName = lastNameParts.join(" ").trim();

    if (!trimmedFirstName || !trimmedLastName) {
      setError("First and last name are required.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await authClient.signUp.email({
        name: `${trimmedFirstName} ${trimmedLastName}`.trim(),
        email: email.trim(),
        password,
      });

      if (result.error) {
        setError(
          getAuthErrorMessage(result.error, "Unable to create that account."),
        );
        return;
      }

      startTransition(() => {
        router.replace(nextPath as Route);
        router.refresh();
      });
    } catch (nextError) {
      setError(
        getAuthErrorMessage(nextError, "Unable to create an account right now."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
      <AuthModeSwitcher activeMode="signup" nextPath={nextPath} />

      <div className="space-y-4 pt-2">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="signup-name">
              Full name
            </label>
            <div className="auth-input-shell" data-leading-icon="true">
              <span className="auth-input-leading-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M20 21a8 8 0 0 0-16 0" />
                  <circle cx="12" cy="8" r="4" />
                </svg>
              </span>
              <input
                id="signup-name"
                className="auth-input"
                type="text"
                placeholder="Jessy Tsui"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="signup-email">
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
                id="signup-email"
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

          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="signup-password">
                Password
              </label>
              <div className="auth-input-shell" data-leading-icon="true">
                <span className="auth-input-leading-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="4" y="11" width="16" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                  </svg>
                </span>
                <input
                  id="signup-password"
                  className="auth-input !pr-12"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
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

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="signup-confirm-password">
                Confirm password
              </label>
              <div className="auth-input-shell" data-leading-icon="true">
                <span className="auth-input-leading-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="4" y="11" width="16" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                  </svg>
                </span>
                <input
                  id="signup-confirm-password"
                  className="auth-input !pr-12"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--foreground-tertiary)] transition hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--foreground-secondary)]"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                >
                  {showConfirmPassword ? (
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
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="h-11 w-full rounded-xl bg-white text-sm font-semibold text-[#090c14] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </div>
      </div>

      <p className="text-center text-sm text-[var(--foreground-tertiary)]">
        Already have an account?{" "}
        <Link
          href={buildAuthPageHref("/login", nextPath) as Route}
          className="font-medium text-white transition hover:text-[var(--brand-bright)]"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
