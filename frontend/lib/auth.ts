"use client";

import { createAuthClient } from "better-auth/react";
import { oneTapClient } from "better-auth/client/plugins";

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
const baseAuthClientOptions = {
  ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
  fetchOptions: {
    credentials: "include" as const,
  },
};

function createOneTapAuthClient(clientId: string) {
  return createAuthClient({
    ...baseAuthClientOptions,
    plugins: [
      oneTapClient({
        clientId,
      }),
    ],
  });
}

type OneTapAuthClient = ReturnType<typeof createOneTapAuthClient>;

const oneTapAuthClients = new Map<string, OneTapAuthClient>();

export const authClient = createAuthClient(baseAuthClientOptions);

export function getOneTapAuthClient(clientId: string) {
  const normalizedClientId = clientId.trim();

  if (!normalizedClientId) {
    throw new Error("Google One Tap client ID is required.");
  }

  const cachedClient = oneTapAuthClients.get(normalizedClientId);
  if (cachedClient) {
    return cachedClient;
  }

  const client = createOneTapAuthClient(normalizedClientId);

  oneTapAuthClients.set(normalizedClientId, client);
  return client;
}
