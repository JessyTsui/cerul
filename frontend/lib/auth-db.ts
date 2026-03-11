import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

type AuthDatabase = Record<string, never>;

let pool: Pool | null = null;
let db: Kysely<AuthDatabase> | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to enable Better Auth.");
  }

  return databaseUrl;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
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

  await sql`
    INSERT INTO user_profiles (id, email, display_name)
    VALUES (${profile.id}, ${email}, ${displayName})
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = NOW()
  `.execute(getAuthDatabase());
}
