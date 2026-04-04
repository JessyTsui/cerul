import type { Context, MiddlewareHandler } from "hono";

import { getConfig } from "../config";
import type { AuthContext, Bindings, SessionContext } from "../types";
import { createDatabaseClient, createPooledDatabaseClient } from "../db/client";
import type { DatabaseClient } from "../db/client";
import { calculateCreditsRemaining, fetchUsageSummary } from "../services/billing";
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from "../utils/crypto";
import { getRateLimiter } from "../utils/rate-limit";
import { apiError } from "../utils/http";

const API_KEY_PREFIX = "cerul_";
const API_KEY_PATTERN = /^cerul_[A-Za-z0-9]{32,}$/;
const DEFAULT_DEV_AUTH_SECRET = "cerul-local-better-auth-secret-for-development-only";
const BETTER_AUTH_COOKIE_NAMES = [
  "better-auth.session_token",
  "better-auth.session_data",
  "__Secure-better-auth.session_token",
  "__Secure-better-auth.session_data"
];
const SESSION_PROXY_MAX_AGE_SECONDS = 300;
const SESSION_PROXY_USER_ID_HEADER = "x-cerul-session-user-id";
const SESSION_PROXY_EMAIL_HEADER = "x-cerul-session-user-email";
const SESSION_PROXY_TIMESTAMP_HEADER = "x-cerul-session-timestamp";
const SESSION_PROXY_SIGNATURE_HEADER = "x-cerul-session-signature";

type AuthRow = {
  api_key_id: string;
  user_id: string;
  is_active: boolean;
  tier: string;
  rate_limit_per_sec: number;
  billing_hold: boolean;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = (value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getDb(c: Context): DatabaseClient {
  return (c.get("db") as DatabaseClient | undefined) ?? createDatabaseClient(c.env as Bindings);
}

export function baseContextMiddleware(): MiddlewareHandler {
  return async (c: any, next: () => Promise<void>) => {
    c.set("config", getConfig(c.env));
    const db = createPooledDatabaseClient(c.env);
    c.set("db", db);
    try {
      await next();
    } finally {
      await db.dispose();
    }
  };
}

export function parseApiKeyFromAuthorization(authorization: string | null): string {
  if (!authorization) {
    apiError(401, "Missing Authorization header.", {
      headers: { "WWW-Authenticate": "Bearer" }
    });
  }

  const [scheme, token = ""] = authorization.split(" ", 2);
  if (scheme.toLowerCase() !== "bearer" || !token.trim()) {
    apiError(401, "Authorization header must use the Bearer scheme.", {
      headers: { "WWW-Authenticate": "Bearer" }
    });
  }

  const apiKey = token.trim();
  return parseApiKeyToken(apiKey, {
    missingMessage: "Authorization header must use the Bearer scheme.",
    challengeWithBearer: true
  });
}

export function parseApiKeyToken(
  apiKey: string | null | undefined,
  options?: { missingMessage?: string; challengeWithBearer?: boolean }
): string {
  const normalized = (apiKey ?? "").trim();
  if (!normalized) {
    apiError(401, options?.missingMessage ?? "Missing API key.", options?.challengeWithBearer
      ? { headers: { "WWW-Authenticate": "Bearer" } }
      : undefined);
  }

  if (!API_KEY_PATTERN.test(normalized)) {
    apiError(401, "Malformed API key.", {
      ...(options?.challengeWithBearer ? { headers: { "WWW-Authenticate": "Bearer" } } : {})
    });
  }

  return normalized;
}

function buildAuthContext(row: AuthRow, creditsRemaining: number): AuthContext {
  return {
    userId: String(row.user_id),
    apiKeyId: String(row.api_key_id),
    tier: String(row.tier),
    creditsRemaining: Math.max(creditsRemaining, 0),
    rateLimitPerSec: Number(row.rate_limit_per_sec ?? 0)
  };
}

async function fetchAuthRow(db: DatabaseClient, keyHash: string): Promise<AuthRow | null> {
  return db.fetchrow<AuthRow>(
    `
      SELECT
          ak.id AS api_key_id,
          ak.user_id,
          ak.is_active,
          up.tier,
          up.rate_limit_per_sec,
          up.billing_hold
      FROM api_keys AS ak
      JOIN user_profiles AS up ON up.id = ak.user_id
      WHERE ak.key_hash = $1
    `,
    keyHash
  );
}

async function touchApiKeyLastUsed(db: DatabaseClient, apiKeyId: string): Promise<void> {
  await db.execute(
    `
      UPDATE api_keys
      SET last_used_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid
    `,
    apiKeyId
  );
}

async function enforceRateLimit(authContext: AuthContext): Promise<void> {
  const lease = await getRateLimiter().acquire(authContext.apiKeyId, authContext.rateLimitPerSec);
  if (lease.allowed) {
    return;
  }

  apiError(429, "Rate limit exceeded.", {
    headers: {
      "Retry-After": String(Math.max(Math.ceil(lease.retry_after_seconds), 1))
    }
  });
}

export async function requireApiKeyContext(c: Context): Promise<AuthContext> {
  const db = getDb(c);
  const authorization = c.req.header("authorization") ?? null;
  const apiKey = parseApiKeyFromAuthorization(authorization);
  return requireApiKeyContextFromToken(c, apiKey, db);
}

export async function requireApiKeyContextFromToken(
  c: Context,
  apiKey: string,
  db: DatabaseClient = getDb(c)
): Promise<AuthContext> {
  const keyHash = await sha256Hex(apiKey);
  const authRow = await fetchAuthRow(db, keyHash);

  if (authRow == null) {
    apiError(401, "Invalid API key", {
      headers: { "WWW-Authenticate": "Bearer" }
    });
  }
  if (!authRow.is_active) {
    apiError(403, "API key is inactive");
  }

  const usageSummary = await fetchUsageSummary(db, String(authRow.user_id));
  if (usageSummary.billing_hold === true) {
    apiError(403, "Billing account requires review before more requests can be served.");
  }

  const auth = buildAuthContext(authRow, calculateCreditsRemaining(usageSummary));
  await enforceRateLimit(auth);
  await touchApiKeyLastUsed(db, auth.apiKeyId);
  c.set("apiAuth", auth);
  return auth;
}

export function apiKeyAuth(): MiddlewareHandler {
  return async (c: any, next: () => Promise<void>) => {
    await requireApiKeyContext(c);
    await next();
  };
}

function extractBetterAuthCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const filtered = cookies.filter((cookie) => {
    const [name] = cookie.split("=", 1);
    return BETTER_AUTH_COOKIE_NAMES.includes(name);
  });

  return filtered.length > 0 ? filtered.join("; ") : null;
}

function resolveAuthProxySecret(c: Context): string | null {
  const config = (c.get("config") as ReturnType<typeof getConfig> | undefined) ?? getConfig(c.env as Bindings);
  if (config.betterAuthSecret) {
    return config.betterAuthSecret;
  }
  if (config.environment === "production") {
    return null;
  }
  return DEFAULT_DEV_AUTH_SECRET;
}

async function buildProxySignature(input: {
  userId: string;
  email: string | null;
  timestamp: number;
  method: string;
  path: string;
  secret: string;
}): Promise<string> {
  return hmacSha256Hex(
    input.secret,
    [input.userId, input.email ?? "", String(input.timestamp), input.method.toUpperCase(), input.path].join("\n")
  );
}

async function resolveProxySession(c: Context): Promise<SessionContext | null> {
  const secret = resolveAuthProxySecret(c);
  if (secret == null) {
    return null;
  }

  const userId = firstNonEmpty(c.req.header(SESSION_PROXY_USER_ID_HEADER));
  const timestampRaw = firstNonEmpty(c.req.header(SESSION_PROXY_TIMESTAMP_HEADER));
  const signature = firstNonEmpty(c.req.header(SESSION_PROXY_SIGNATURE_HEADER));
  if (userId == null || timestampRaw == null || signature == null) {
    return null;
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SESSION_PROXY_MAX_AGE_SECONDS) {
    return null;
  }

  const email = firstNonEmpty(c.req.header(SESSION_PROXY_EMAIL_HEADER));
  const expectedSignature = await buildProxySignature({
    userId,
    email,
    timestamp,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    secret
  });

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  return { userId, email };
}

async function fetchBetterAuthSession(c: Context): Promise<Record<string, unknown> | null> {
  const cookieHeader = extractBetterAuthCookieHeader(c.req.header("cookie") ?? null);
  if (!cookieHeader) {
    return null;
  }

  const config = (c.get("config") as ReturnType<typeof getConfig> | undefined) ?? getConfig(c.env as Bindings);
  const sessionUrl = `${config.public.webBaseUrl.replace(/\/+$/, "")}/api/auth/get-session`;
  let response: Response;

  try {
    response = await fetch(sessionUrl, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
        accept: "application/json"
      }
    });
  } catch (error) {
    apiError(503, "Better Auth session service is unavailable.");
  }

  if ([401, 403, 404].includes(response.status)) {
    return null;
  }
  if (response.status >= 500) {
    apiError(503, "Better Auth session service returned an error.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    apiError(503, "Better Auth session service returned invalid JSON.");
  }

  if (payload == null) {
    return null;
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    apiError(503, "Better Auth session payload is malformed.");
  }

  return payload as Record<string, unknown>;
}

export async function requireSessionContext(c: Context): Promise<SessionContext> {
  const proxySession = await resolveProxySession(c);
  if (proxySession) {
    c.set("session", proxySession);
    return proxySession;
  }

  const payload = await fetchBetterAuthSession(c);
  const user = payload?.user;
  if (user == null || typeof user !== "object" || Array.isArray(user)) {
    apiError(401, "Missing authenticated session.");
  }

  const userId = firstNonEmpty((user as Record<string, unknown>).id as string | undefined);
  if (userId == null) {
    apiError(401, "Missing authenticated session.");
  }

  const session = {
    userId,
    email: firstNonEmpty((user as Record<string, unknown>).email as string | undefined)
  };
  c.set("session", session);
  return session;
}

export function sessionAuth(): MiddlewareHandler {
  return async (c: any, next: () => Promise<void>) => {
    await requireSessionContext(c);
    await next();
  };
}

async function fetchConsoleIdentity(db: DatabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      SELECT
          id,
          email,
          console_role
      FROM user_profiles
      WHERE id = $1
    `,
    userId
  );
}

function normalizeEmail(value: string | null | undefined): string | null {
  return firstNonEmpty(value)?.toLowerCase() ?? null;
}

export async function requireAdminContext(c: Context): Promise<Record<string, unknown>> {
  const session = (c.get("session") as SessionContext | undefined) ?? (await requireSessionContext(c));
  const db = getDb(c);
  const config = (c.get("config") as ReturnType<typeof getConfig> | undefined) ?? getConfig(c.env as Bindings);
  const identity = await fetchConsoleIdentity(db, session.userId);
  const consoleRole = firstNonEmpty(identity?.console_role as string | undefined, "user")?.toLowerCase() ?? "user";
  const profileEmail = normalizeEmail(identity?.email as string | undefined);
  const sessionEmail = normalizeEmail(session.email) ?? profileEmail;

  if (consoleRole === "admin" || (sessionEmail != null && config.dashboard.adminEmails.includes(sessionEmail))) {
    const adminIdentity = identity ?? {
      id: session.userId,
      email: sessionEmail,
      console_role: consoleRole
    };
    c.set("adminIdentity", adminIdentity);
    return adminIdentity;
  }

  apiError(403, "Admin console access is restricted to administrator accounts.");
}

export function adminAuth(): MiddlewareHandler {
  return async (c: any, next: () => Promise<void>) => {
    await requireAdminContext(c);
    await next();
  };
}
