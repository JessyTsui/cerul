import { betterAuth } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";
import { headers } from "next/headers";
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

function getAuthBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.WEB_BASE_URL?.trim() ||
    DEFAULT_AUTH_BASE_URL
  );
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

export function getAuth() {
  if (!authInstance) {
    authInstance = createAuth();
  }

  return authInstance;
}

export function getAuthRouteHandlers() {
  return toNextJsHandler(getAuth());
}

export async function getServerSession() {
  const requestHeaders = await headers();

  if (!requestHeaders.get("cookie")) {
    return null;
  }

  return getAuth().api.getSession({
    headers: requestHeaders,
  });
}
