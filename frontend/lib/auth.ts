"use client";

import { createAuthClient } from "better-auth/react";

function resolveAuthClientBaseUrl(): string | undefined {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredBaseUrl || typeof window === "undefined") {
    return configuredBaseUrl || undefined;
  }

  try {
    const configuredOrigin = new URL(configuredBaseUrl).origin;
    if (configuredOrigin !== window.location.origin) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return configuredBaseUrl;
}

const resolvedBaseUrl = resolveAuthClientBaseUrl();

export const authClient = createAuthClient({
  ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
  fetchOptions: {
    credentials: "include",
  },
});
