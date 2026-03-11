"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";

type SignupFormProps = {
  nextPath: string;
};

export function SignupForm({ nextPath }: SignupFormProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

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
    <form
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
        Create account
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">
            First name
          </span>
          <input
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            type="text"
            placeholder="Jessy"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">
            Last name
          </span>
          <input
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            type="text"
            placeholder="Tsui"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">
            Work email
          </span>
          <input
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">
            Password
          </span>
          <input
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">
            Confirm password
          </span>
          <input
            className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            type="password"
            placeholder="Repeat password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-[rgba(248,113,113,0.35)] bg-[rgba(127,29,29,0.22)] px-4 py-3 text-sm text-[rgb(254,202,202)]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="button-accent mt-6 w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Creating account..." : "Create workspace"}
      </button>
      <p className="mt-4 text-sm text-[var(--foreground-tertiary)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--brand-bright)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
