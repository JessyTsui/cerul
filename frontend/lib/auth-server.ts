import { betterAuth } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";
import { headers } from "next/headers";
import { cache } from "react";
import { getAuthDatabase, upsertUserProfile } from "./auth-db";

const DEFAULT_DEV_AUTH_SECRET =
  "cerul-local-better-auth-secret-for-development-only";
const DEFAULT_AUTH_BASE_URL = "http://localhost:3000";

function expandTrustedOrigins(baseURL: string): string[] {
  const configuredOrigins = [
    baseURL,
    process.env.NEXT_PUBLIC_SITE_URL?.trim(),
    process.env.WEB_BASE_URL?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (process.env.NODE_ENV === "production") {
    return Array.from(new Set(configuredOrigins));
  }

  const localAliases = new Set<string>();

  for (const origin of configuredOrigins) {
    localAliases.add(origin);

    try {
      const url = new URL(origin);
      if (url.hostname === "localhost") {
        url.hostname = "127.0.0.1";
        localAliases.add(url.toString().replace(/\/$/, ""));
      } else if (url.hostname === "127.0.0.1") {
        url.hostname = "localhost";
        localAliases.add(url.toString().replace(/\/$/, ""));
      }
    } catch {
      continue
    }
  }

  return Array.from(localAliases);
}

function getAuthBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.WEB_BASE_URL?.trim() ||
    DEFAULT_AUTH_BASE_URL
  );
}

function getAuthSecret(): string {
  const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }

  return DEFAULT_DEV_AUTH_SECRET;
}

function createAuth() {
  const baseURL = getAuthBaseUrl();

  return betterAuth({
    baseURL,
    secret: getAuthSecret(),
    trustedOrigins: expandTrustedOrigins(baseURL),
    database: {
      db: getAuthDatabase(),
      type: "postgres",
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          async after(user) {
            await upsertUserProfile({
              id: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
        update: {
          async after(user) {
            await upsertUserProfile({
              id: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
      },
    },
  });
}

let authInstance: ReturnType<typeof createAuth> | null = null;
const SESSION_CACHE_TTL_MS = process.env.NODE_ENV === "development" ? 15_000 : 5_000;
const SESSION_CACHE_LIMIT = 128;
const sessionCache = new Map<
  string,
  {
    expiresAt: number;
    value: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;
  }
>();

function pruneExpiredSessionCache(now: number) {
  for (const [key, entry] of sessionCache.entries()) {
    if (entry.expiresAt <= now) {
      sessionCache.delete(key);
    }
  }

  if (sessionCache.size <= SESSION_CACHE_LIMIT) {
    return;
  }

  const overflow = sessionCache.size - SESSION_CACHE_LIMIT;
  for (const key of sessionCache.keys()) {
    sessionCache.delete(key);
    if (sessionCache.size <= SESSION_CACHE_LIMIT - overflow) {
      break;
    }
  }
}

export function getAuth() {
  if (!authInstance) {
    authInstance = createAuth();
  }

  return authInstance;
}

export function getAuthRouteHandlers() {
  return toNextJsHandler(getAuth());
}

export const getServerSession = cache(async function getServerSession() {
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const now = Date.now();
  const cached = sessionCache.get(cookieHeader);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const session = await getAuth().api.getSession({
    headers: requestHeaders,
  });

  sessionCache.set(cookieHeader, {
    expiresAt: now + SESSION_CACHE_TTL_MS,
    value: session,
  });
  pruneExpiredSessionCache(now);

  return session;
});
