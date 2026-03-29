"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";
import { isConsolePath } from "@/lib/console-api";

type SiteHeaderAuthActionsProps = {
  currentPath: string;
};

type SessionState = "loading" | "anonymous" | "authenticated";

export function SiteHeaderAuthActions({
  currentPath,
}: SiteHeaderAuthActionsProps) {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void authClient.getSession()
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result?.data?.user?.id) {
          setSessionState("anonymous");
          setIsAdmin(false);
          return;
        }

        setSessionState("authenticated");
        void fetch("/api/console/viewer", {
          credentials: "include",
          cache: "no-store",
        })
          .then(async (response) => {
            if (cancelled || !response.ok) {
              return;
            }

            const payload = await response.json() as {
              isAdmin?: boolean;
            };
            setIsAdmin(payload.isAdmin === true);
          })
          .catch(() => {
            if (!cancelled) {
              setIsAdmin(false);
            }
          });
      })
      .catch(() => {
        if (!cancelled) {
          setSessionState("anonymous");
          setIsAdmin(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

      setSessionState("anonymous");
      setIsAdmin(false);
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

  const isConsoleRoute = isConsolePath(currentPath);
  const showDashboardLink =
    sessionState === "authenticated" && !currentPath.startsWith("/dashboard");
  const showAdminLink =
    sessionState === "authenticated" && isAdmin && !currentPath.startsWith("/admin");
  const showSignOutButton = sessionState === "authenticated" && !isConsoleRoute;

  if (sessionState === "loading") {
    return <div className="h-10 w-[232px]" aria-hidden="true" />;
  }

  if (isConsoleRoute && sessionState !== "authenticated") {
    return null;
  }

  if (sessionState !== "authenticated") {
    return (
      <>
        <Link href="/login" className="button-secondary focus-ring">
          Sign in
        </Link>
        <Link href="/signup" className="button-primary focus-ring min-w-[112px]">
          Sign up
        </Link>
      </>
    );
  }

  return (
    <>
      {showAdminLink ? (
        <Link
          href={"/admin" as Route}
          className="focus-ring rounded-full px-3 py-2 text-sm text-[var(--foreground-tertiary)] transition hover:bg-white/40 hover:text-[var(--foreground)]"
        >
          Admin
        </Link>
      ) : null}
      {showDashboardLink ? (
        <Link href={"/dashboard" as Route} className="button-secondary focus-ring">
          Dashboard
        </Link>
      ) : null}
      {showSignOutButton ? (
        <button
          type="button"
          className="button-primary focus-ring min-w-[112px]"
          disabled={isSubmitting}
          onClick={() => void handleSignOut()}
        >
          {isSubmitting ? "Signing out..." : "Sign out"}
        </button>
      ) : null}
      {error ? (
        <p className="text-xs text-[rgb(254,202,202)]">{error}</p>
      ) : null}
    </>
  );
}
