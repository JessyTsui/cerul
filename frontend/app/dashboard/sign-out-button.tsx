"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";

type SignOutButtonProps = {
  email: string | null;
};

export function SignOutButton({ email }: SignOutButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignOut() {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError(
          getAuthErrorMessage(result.error, "Unable to sign out right now."),
        );
        return;
      }

      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, "Unable to sign out right now."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pointer-events-auto rounded-[20px] border border-[var(--border)] bg-[rgba(12,18,32,0.92)] px-4 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
        Session
      </p>
      <p className="mt-2 max-w-[240px] truncate text-sm text-white">
        {email ?? "Authenticated operator"}
      </p>
      <button
        className="button-secondary mt-3 w-full"
        type="button"
        disabled={isSubmitting}
        onClick={() => void handleSignOut()}
      >
        {isSubmitting ? "Signing out..." : "Sign out"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-[rgb(254,202,202)]">{error}</p>
      ) : null}
    </div>
  );
}
