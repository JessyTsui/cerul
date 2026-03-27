import { Pool, neonConfig } from "@neondatabase/serverless";

import type { Bindings, DbRow } from "../types";

type QueryValue =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | Record<string, unknown>
  | Array<unknown>;

interface QueryResultLike {
  rows?: DbRow[];
  rowCount?: number | null;
  command?: string;
}

interface Queryable {
  query(queryText: string, params?: QueryValue[]): Promise<QueryResultLike>;
  release?: () => void;
}

export interface DatabaseClient {
  fetch<T extends DbRow = DbRow>(queryText: string, ...params: QueryValue[]): Promise<T[]>;
  fetchrow<T extends DbRow = DbRow>(queryText: string, ...params: QueryValue[]): Promise<T | null>;
  fetchval<T = unknown>(queryText: string, ...params: QueryValue[]): Promise<T | null>;
  execute(queryText: string, ...params: QueryValue[]): Promise<string>;
  transaction<T>(callback: (db: DatabaseClient) => Promise<T>): Promise<T>;
}

neonConfig.fetchConnectionCache = false;

function requireDatabaseUrl(env: Bindings): string {
  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  return databaseUrl;
}

function normalizeRows(result: QueryResultLike): DbRow[] {
  return Array.isArray(result.rows) ? result.rows : [];
}

function normalizeCommandStatus(result: QueryResultLike): string {
  const command = (result.command ?? "UPDATE").toString().toUpperCase();
  const rowCount = result.rowCount ?? 0;
  return `${command} ${rowCount}`;
}

class NeonDatabaseClient implements DatabaseClient {
  constructor(
    private readonly env: Bindings,
    private readonly queryable?: Queryable
  ) {}

  private async withClient<T>(callback: (client: Queryable) => Promise<T>): Promise<T> {
    if (this.queryable) {
      return callback(this.queryable);
    }

    const pool = new Pool({
      connectionString: requireDatabaseUrl(this.env),
      max: 1
    });
    const client = (await pool.connect()) as Queryable;

    try {
      return await callback(client);
    } finally {
      client.release?.();
      await pool.end();
    }
  }

  async fetch<T extends DbRow = DbRow>(queryText: string, ...params: QueryValue[]): Promise<T[]> {
    return this.withClient(async (client) => {
      const result = await client.query(queryText, params);
      return normalizeRows(result) as T[];
    });
  }

  async fetchrow<T extends DbRow = DbRow>(queryText: string, ...params: QueryValue[]): Promise<T | null> {
    const rows = await this.fetch<T>(queryText, ...params);
    return rows[0] ?? null;
  }

  async fetchval<T = unknown>(queryText: string, ...params: QueryValue[]): Promise<T | null> {
    const row = await this.fetchrow<DbRow>(queryText, ...params);
    if (row == null) {
      return null;
    }
    const [firstValue] = Object.values(row);
    return (firstValue as T | undefined) ?? null;
  }

  async execute(queryText: string, ...params: QueryValue[]): Promise<string> {
    return this.withClient(async (client) => {
      const result = await client.query(queryText, params);
      return normalizeCommandStatus(result);
    });
  }

  async transaction<T>(callback: (db: DatabaseClient) => Promise<T>): Promise<T> {
    if (this.queryable) {
      return callback(this);
    }

    const pool = new Pool({
      connectionString: requireDatabaseUrl(this.env),
      max: 1
    });
    const client = (await pool.connect()) as Queryable;
    const transactional = new NeonDatabaseClient(this.env, client);

    try {
      await client.query("BEGIN");
      const result = await callback(transactional);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors and surface the original failure.
      }
      throw error;
    } finally {
      client.release?.();
      await pool.end();
    }
  }
}

export function createDatabaseClient(env: Bindings): DatabaseClient {
  return new NeonDatabaseClient(env);
}
