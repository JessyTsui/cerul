"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";

type ResetPasswordFormProps = {
  token: string | null;
  initialError?: string | null;
};

function PasswordVisibilityButton(props: {
  visible: boolean;
  onClick: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.visible ? props.hideLabel : props.showLabel}
      className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--foreground-tertiary)] transition hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--foreground-secondary)]"
      onClick={props.onClick}
    >
      {props.visible ? (
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
  );
}

export function ResetPasswordForm({
  token,
  initialError = null,
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is invalid or expired.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (result.error) {
        setError(
          getAuthErrorMessage(
            result.error,
            "Unable to reset your password right now.",
          ),
        );
        return;
      }

      setIsSuccess(true);
    } catch (requestError) {
      setError(
        getAuthErrorMessage(
          requestError,
          "Unable to reset your password right now.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Password updated
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Your password has been reset
          </h2>
          <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
            Sign in with your new password to continue.
          </p>
        </div>

        <p className="text-center text-sm text-[var(--foreground-tertiary)]">
          <Link
            href={"/login" as Route}
            className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (!token || error === "This link is invalid or has already been used." || error === "This link has expired. Please request a new one.") {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Reset link unavailable
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            This reset link is invalid or expired
          </h2>
          <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
            Request a fresh password reset email and try again.
          </p>
        </div>

        {error ? (
          <div className="rounded-[18px] border border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] px-4 py-3 text-sm text-[var(--error)]">
            {error}
          </div>
        ) : null}

        <p className="text-center text-sm text-[var(--foreground-tertiary)]">
          <Link
            href={"/forgot-password" as Route}
            className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
          >
            Request another reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          New password
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
          Choose a new password
        </h2>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="reset-password">
          New password
        </label>
        <div className="auth-input-shell" data-leading-icon="true">
          <span className="auth-input-leading-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 1 1 8 0v3" />
            </svg>
          </span>
          <input
            id="reset-password"
            className="auth-input !pr-12"
            type={showPassword ? "text" : "password"}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
          <PasswordVisibilityButton
            visible={showPassword}
            onClick={() => setShowPassword((current) => !current)}
            showLabel="Show password"
            hideLabel="Hide password"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="reset-confirm-password">
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
            id="reset-confirm-password"
            className="auth-input !pr-12"
            type={showConfirmPassword ? "text" : "password"}
            placeholder="Repeat password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
          />
          <PasswordVisibilityButton
            visible={showConfirmPassword}
            onClick={() => setShowConfirmPassword((current) => !current)}
            showLabel="Show password confirmation"
            hideLabel="Hide password confirmation"
          />
        </div>
      </div>

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
        {isSubmitting ? "Resetting..." : "Reset password"}
      </button>

      <p className="text-center text-sm text-[var(--foreground-tertiary)]">
        <Link
          href={"/login" as Route}
          className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
