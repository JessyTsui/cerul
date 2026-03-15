"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { authClient } from "@/lib/auth";

type AuthSessionRedirectProps = {
  nextPath: string;
};

export function AuthSessionRedirect({
  nextPath,
}: AuthSessionRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    const cookieHeader = document.cookie;
    const hasAuthCookie =
      cookieHeader.includes("better-auth.session_token")
      || cookieHeader.includes("better-auth.session_data")
      || cookieHeader.includes("__Secure-better-auth.session_token")
      || cookieHeader.includes("__Secure-better-auth.session_data");

    if (!hasAuthCookie) {
      return;
    }

    let cancelled = false;

    void authClient
      .getSession()
      .then((result) => {
        if (cancelled || !result?.data?.user?.id) {
          return;
        }

        startTransition(() => {
          router.replace(nextPath as Route);
          router.refresh();
        });
      })
      .catch(() => {
        // Ignore local preview auth bootstrap failures when no session exists.
      });

    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  return null;
}
