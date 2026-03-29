import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

type AuthDatabase = Record<string, never>;

let pool: Pool | null = null;
let db: Kysely<AuthDatabase> | null = null;
let databaseGeneration = 0;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to enable Better Auth.");
  }

  return databaseUrl;
}

export function normalizeAuthDatabaseUrl(databaseUrl: string): string {
  if (databaseUrl.includes("connect_timeout=")) {
    return databaseUrl;
  }

  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set("connect_timeout", "30");
    return parsed.toString();
  } catch {
    return `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}connect_timeout=30`;
  }
}

function getRetryableErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (typeof current === "string") {
      messages.push(current);
      continue;
    }

    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }

    if ("cause" in current) {
      queue.push(current.cause);
    }

    if ("body" in current) {
      queue.push(current.body);
    }
  }

  return messages;
}

export function isRetryableAuthDatabaseError(error: unknown): boolean {
  const codes = new Set<string>();

  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string") {
      codes.add(error.code);
    }

    if (
      "body" in error &&
      error.body &&
      typeof error.body === "object" &&
      "code" in error.body &&
      typeof error.body.code === "string"
    ) {
      codes.add(error.body.code);
    }
  }

  for (const retryableCode of [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "57P01",
    "57P02",
    "57P03",
    "FAILED_TO_GET_SESSION",
  ]) {
    if (codes.has(retryableCode)) {
      return true;
    }
  }

  const normalizedMessage = getRetryableErrorMessages(error)
    .join("\n")
    .toLowerCase();

  return [
    "connection terminated unexpectedly",
    "server closed the connection unexpectedly",
    "connection ended unexpectedly",
    "client has encountered a connection error and is not queryable",
    "read econnreset",
    "write epipe",
    "connection timeout expired",
    "failed to get session",
  ].some((fragment) => normalizedMessage.includes(fragment));
}

async function disposePool(currentPool: Pool | null): Promise<void> {
  if (!currentPool) {
    return;
  }

  try {
    await currentPool.end();
  } catch {
    // Best effort cleanup only.
  }
}

export async function resetAuthDatabaseState(): Promise<void> {
  const currentPool = pool;

  pool = null;
  db = null;
  databaseGeneration += 1;

  await disposePool(currentPool);
}

export function getAuthDatabaseGeneration(): number {
  return databaseGeneration;
}

export async function withAuthDatabaseRecovery<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableAuthDatabaseError(error)) {
      throw error;
    }

    await resetAuthDatabaseState();
    return operation();
  }
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: normalizeAuthDatabaseUrl(getDatabaseUrl()),
    });
  }

  return pool;
}

export function getAuthDatabase(): Kysely<AuthDatabase> {
  if (!db) {
    db = new Kysely<AuthDatabase>({
      dialect: new PostgresDialect({
        pool: getPool(),
      }),
    });
  }

  return db;
}

type ProfileInput = {
  id: string;
  email: string;
  name: string;
};

export async function upsertUserProfile(profile: ProfileInput): Promise<void> {
  const displayName = profile.name.trim() || null;
  const email = profile.email.trim().toLowerCase();

  await withAuthDatabaseRecovery(() =>
    sql`
      INSERT INTO user_profiles (id, email, display_name)
      VALUES (${profile.id}, ${email}, ${displayName})
      ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          updated_at = NOW()
    `.execute(getAuthDatabase()),
  );
}
