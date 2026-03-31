"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";

type PasswordResetStatus = "credential" | "social" | "unknown";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [resultState, setResultState] = useState<"sent" | "social" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function lookupPasswordResetStatus(
    normalizedEmail: string,
  ): Promise<PasswordResetStatus> {
    const response = await fetch("/api/auth/password-reset-status", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: normalizedEmail,
      }),
    });

    const payload = await response.json().catch(() => null) as {
      status?: PasswordResetStatus;
    } | null;

    return payload?.status ?? "unknown";
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const status = await lookupPasswordResetStatus(normalizedEmail);

      if (status === "social") {
        setSubmittedEmail(normalizedEmail);
        setResultState("social");
        return;
      }

      const result = await authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: "/reset-password",
      });

      if (result.error) {
        setError(
          getAuthErrorMessage(
            result.error,
            "Unable to send a password reset link right now.",
          ),
        );
        return;
      }

      setSubmittedEmail(normalizedEmail);
      setResultState("sent");
    } catch (requestError) {
      setError(
        getAuthErrorMessage(
          requestError,
          "Unable to send a password reset link right now.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (resultState === "sent" && submittedEmail) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Check your inbox
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Reset link sent
          </h2>
          <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
            We sent a password reset link to <span className="font-medium text-[var(--foreground)]">{submittedEmail}</span>.
          </p>
        </div>

        <div className="rounded-[18px] border border-[var(--border)] bg-white/70 px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]">
          Open the email and follow the secure link to choose a new password.
        </div>

        <p className="text-center text-sm text-[var(--foreground-tertiary)]">
          <Link
            href={"/login" as Route}
            className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  if (resultState === "social" && submittedEmail) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Password reset unavailable
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            This account uses social sign-in
          </h2>
          <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
            <span className="font-medium text-[var(--foreground)]">{submittedEmail}</span> uses Google or GitHub sign-in, so there is no password to reset.
          </p>
        </div>

        <div className="rounded-[18px] border border-[var(--border)] bg-white/70 px-4 py-4 text-sm leading-7 text-[var(--foreground-secondary)]">
          Return to login and continue with the social provider you used when the account was created.
        </div>

        <p className="text-center text-sm text-[var(--foreground-tertiary)]">
          <Link
            href={"/login" as Route}
            className="font-medium text-[var(--foreground)] transition hover:text-[var(--brand-bright)]"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          Password recovery
        </p>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
          Reset your password
        </h2>
        <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
          Enter the email address you signed up with and we&apos;ll send you a secure reset link.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--foreground-secondary)]" htmlFor="forgot-password-email">
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
            id="forgot-password-email"
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
        {isSubmitting ? "Sending..." : "Send reset link"}
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
