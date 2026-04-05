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
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "30");
    }

    const useLibpqCompat = parsed.searchParams.get("uselibpqcompat") === "true";
    const sslMode = parsed.searchParams.get("sslmode");

    if (
      !useLibpqCompat &&
      (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca")
    ) {
      // pg-connection-string v2 currently treats these aliases as verify-full and emits a warning.
      // We normalize explicitly so the runtime keeps the stronger semantics without noisy startup logs.
      parsed.searchParams.set("sslmode", "verify-full");
    }

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
      connectionTimeoutMillis: 60_000,
      idleTimeoutMillis: 30_000,
      max: 5,
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
  grantSignupBonus?: boolean;
  createDefaultApiKey?: boolean;
};

const SIGNUP_BONUS_CREDITS = 100;
const DEFAULT_API_KEY_NAME = "Default";
const API_KEY_PREFIX = "cerul_";
const API_KEY_TOKEN_LENGTH = 32;
const API_KEY_PREFIX_LENGTH = 16;

const encoder = new TextEncoder();

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", asArrayBuffer(encoder.encode(value)));
  return toHex(digest);
}

function randomHex(length: number): string {
  const byteLength = Math.ceil(length / 2);
  const buffer = new Uint8Array(byteLength);
  crypto.getRandomValues(buffer);
  return [...buffer].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, length);
}

async function generateApiKey(): Promise<{ rawKey: string; keyHash: string; prefix: string }> {
  const token = randomHex(API_KEY_TOKEN_LENGTH);
  const rawKey = `${API_KEY_PREFIX}${token}`;
  const keyHash = await sha256Hex(rawKey);
  return {
    rawKey,
    keyHash,
    prefix: rawKey.slice(0, API_KEY_PREFIX_LENGTH),
  };
}

export async function upsertUserProfile(profile: ProfileInput): Promise<void> {
  const displayName = profile.name.trim() || null;
  const email = profile.email.trim().toLowerCase();
  const database = getAuthDatabase();

  await withAuthDatabaseRecovery(() =>
    database.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO user_profiles (id, email, display_name)
        VALUES (${profile.id}, ${email}, ${displayName})
        ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            updated_at = NOW()
      `.execute(trx);

      if (!profile.grantSignupBonus) {
        if (!profile.createDefaultApiKey) {
          return;
        }
      } else {
        const insertedGrant = await sql<{ id: string }>`
          INSERT INTO credit_grants (
            user_id,
            grant_key,
            grant_type,
            plan_code,
            total_credits,
            remaining_credits,
            expires_at,
            metadata
          )
          VALUES (
            ${profile.id},
            ${`signup_bonus:${profile.id}`},
            'promo_bonus',
            'free',
            ${SIGNUP_BONUS_CREDITS},
            ${SIGNUP_BONUS_CREDITS},
            NULL,
            ${JSON.stringify({ reason: "signup_bonus" })}::jsonb
          )
          ON CONFLICT (grant_key) DO NOTHING
          RETURNING id
        `.execute(trx);

        const grantId = insertedGrant.rows[0]?.id;
        if (grantId) {
          await sql`
            INSERT INTO credit_transactions (
              user_id,
              grant_id,
              kind,
              amount,
              metadata
            )
            VALUES (
              ${profile.id},
              ${grantId}::uuid,
              'grant',
              ${SIGNUP_BONUS_CREDITS},
              ${JSON.stringify({
                grant_key: `signup_bonus:${profile.id}`,
                grant_type: "promo_bonus",
                reason: "signup_bonus",
              })}::jsonb
            )
          `.execute(trx);
        }
      }

      if (!profile.createDefaultApiKey) {
        return;
      }

      const generatedKey = await generateApiKey();
      await sql`
        INSERT INTO api_keys (
          user_id,
          name,
          key_hash,
          prefix,
          raw_key,
          is_active
        )
        SELECT
          ${profile.id},
          ${DEFAULT_API_KEY_NAME},
          ${generatedKey.keyHash},
          ${generatedKey.prefix},
          ${generatedKey.rawKey},
          TRUE
        WHERE NOT EXISTS (
          SELECT 1
          FROM api_keys
          WHERE user_id = ${profile.id}
            AND is_active = TRUE
        )
      `.execute(trx);
    }),
  );
}
