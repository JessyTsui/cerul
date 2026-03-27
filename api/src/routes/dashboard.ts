import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { adminAuth, sessionAuth } from "../middleware/auth";
import { isPaidTier, keyLimitForTier, monthlyCreditLimitForTier } from "../services/billing";
import { createCheckoutSession, createPortalSession, StripeServiceError } from "../services/stripe";
import { apiError, emptyResponse } from "../utils/http";
import { sha256Hex, randomHex } from "../utils/crypto";
import { ensureJsonObject } from "../utils/validation";

const API_KEY_PREFIX = "cerul_sk_";
const API_KEY_TOKEN_LENGTH = 32;
const API_KEY_PREFIX_LENGTH = 16;

type DashboardSession = {
  userId: string;
  email: string | null;
};

function utcNow(): Date {
  return new Date();
}

export function getCurrentBillingPeriod(reference?: Date): [string, string] {
  const today = reference ?? utcNow();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  return [periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)];
}

function normalizeApiKeySummary(record: Record<string, unknown> | null): Record<string, unknown> {
  const payload = record ?? {};
  return {
    id: String(payload.id ?? ""),
    name: String(payload.name ?? ""),
    prefix: String(payload.prefix ?? ""),
    created_at: payload.created_at ?? null,
    last_used_at: payload.last_used_at ?? null,
    is_active: Boolean(payload.is_active ?? false)
  };
}

function normalizeProcessingJobSummary(record: Record<string, unknown> | null): Record<string, unknown> {
  const payload = record ?? {};
  return {
    id: String(payload.id ?? ""),
    track: payload.track ?? null,
    job_type: String(payload.job_type ?? ""),
    status: payload.status ?? null,
    attempts: Number(payload.attempts ?? 0),
    max_attempts: Number(payload.max_attempts ?? 0),
    error_message: payload.error_message ?? null,
    created_at: payload.created_at ?? null,
    started_at: payload.started_at ?? null,
    completed_at: payload.completed_at ?? null,
    updated_at: payload.updated_at ?? null
  };
}

function normalizeProcessingJobDetail(record: Record<string, unknown> | null): Record<string, unknown> {
  const payload = normalizeProcessingJobSummary(record);
  return {
    ...payload,
    source_id: record?.source_id == null ? null : String(record.source_id),
    input_payload: record?.input_payload ?? {},
    locked_by: record?.locked_by ?? null,
    locked_at: record?.locked_at ?? null,
    next_retry_at: record?.next_retry_at ?? null
  };
}

function normalizeProcessingJobStep(record: Record<string, unknown> | null): Record<string, unknown> {
  const payload = record ?? {};
  const artifacts = typeof payload.artifacts === "object" && payload.artifacts != null ? payload.artifacts : {};
  const startedAt = payload.started_at instanceof Date ? payload.started_at : payload.started_at ? new Date(String(payload.started_at)) : null;
  const completedAt = payload.completed_at instanceof Date ? payload.completed_at : payload.completed_at ? new Date(String(payload.completed_at)) : null;
  const updatedAt = payload.updated_at instanceof Date ? payload.updated_at : payload.updated_at ? new Date(String(payload.updated_at)) : null;

  let durationMs: number | null = null;
  if (startedAt) {
    const end = completedAt ?? updatedAt ?? utcNow();
    durationMs = Math.max(end.getTime() - startedAt.getTime(), 0);
  }

  const logs = Array.isArray((artifacts as any).logs)
    ? (artifacts as any).logs
      .filter((item: any) => item && typeof item === "object" && String(item.message ?? "").trim())
      .map((item: any) => ({
        at: item.at ?? null,
        level: String(item.level ?? "info"),
        message: String(item.message ?? "").trim(),
        details: typeof item.details === "object" && item.details != null ? item.details : null
      }))
    : [];

  return {
    id: String(payload.id ?? ""),
    step_name: String(payload.step_name ?? ""),
    status: payload.status ?? null,
    artifacts,
    error_message: payload.error_message ?? null,
    started_at: payload.started_at ?? null,
    completed_at: payload.completed_at ?? null,
    updated_at: payload.updated_at ?? null,
    duration_ms: durationMs,
    guidance: typeof (artifacts as any).guidance === "string" ? String((artifacts as any).guidance).trim() || null : null,
    logs
  };
}

async function findAuthUser(db: DatabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  return db.fetchrow(
    `
      SELECT id, email, name
      FROM "user"
      WHERE id = $1
    `,
    userId
  );
}

async function provisionUserProfileFromAuthUser(db: DatabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const authUser = await findAuthUser(db, userId);
  if (!authUser) {
    return null;
  }

  const email = String(authUser.email ?? "").trim().toLowerCase() || null;
  const displayName = String(authUser.name ?? "").trim() || null;
  return db.fetchrow(
    `
      INSERT INTO user_profiles (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET email = COALESCE(EXCLUDED.email, user_profiles.email),
          display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
          updated_at = NOW()
      RETURNING
          id,
          email,
          console_role,
          tier,
          monthly_credit_limit,
          rate_limit_per_sec,
          stripe_customer_id
    `,
    userId,
    email,
    displayName
  );
}

async function fetchUserProfile(db: DatabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const profile = await db.fetchrow(
    `
      SELECT
          id,
          email,
          console_role,
          tier,
          monthly_credit_limit,
          rate_limit_per_sec,
          stripe_customer_id
      FROM user_profiles
      WHERE id = $1
    `,
    userId
  );
  if (profile) {
    return profile;
  }
  return provisionUserProfileFromAuthUser(db, userId);
}

async function countActiveApiKeys(db: DatabaseClient, userId: string): Promise<number> {
  return Number(
    (await db.fetchval(
      `
        SELECT COUNT(*)
        FROM api_keys
        WHERE user_id = $1
          AND is_active = TRUE
      `,
      userId
    )) ?? 0
  );
}

async function insertApiKey(
  db: DatabaseClient,
  userId: string,
  name: string,
  keyHash: string,
  prefix: string
): Promise<Record<string, unknown>> {
  const row = await db.fetchrow(
    `
      INSERT INTO api_keys (user_id, name, key_hash, prefix, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING id, name, prefix, created_at, last_used_at, is_active
    `,
    userId,
    name,
    keyHash,
    prefix
  );
  if (!row) {
    apiError(500, "Failed to create API key.");
  }
  return row;
}

async function listApiKeysForUser(db: DatabaseClient, userId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.fetch(
    `
      SELECT id, name, prefix, created_at, last_used_at, is_active
      FROM api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    userId
  );
  return rows.map((row) => normalizeApiKeySummary(row));
}

async function softDeleteApiKey(db: DatabaseClient, keyId: string, userId: string): Promise<boolean> {
  const row = await db.fetchrow(
    `
      UPDATE api_keys
      SET is_active = FALSE
      WHERE id = $1
        AND user_id = $2
      RETURNING id
    `,
    keyId,
    userId
  );
  return row != null;
}

async function fetchUsageSummary(
  db: DatabaseClient,
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<Record<string, unknown>> {
  return (
    await db.fetchrow(
      `
        SELECT COALESCE(credits_used, 0) AS credits_used,
               COALESCE(request_count, 0) AS request_count
        FROM usage_monthly
        WHERE user_id = $1
          AND period_start = $2
          AND period_end = $3
      `,
      userId,
      periodStart,
      periodEnd
    )
  ) ?? { credits_used: 0, request_count: 0 };
}

async function fetchDailyUsageBreakdown(
  db: DatabaseClient,
  userId: string,
  periodStart: string,
  periodEnd: string
): Promise<Record<string, unknown>[]> {
  return db.fetch(
    `
      SELECT DATE(occurred_at) AS date,
             COUNT(*) AS request_count,
             COALESCE(SUM(credits_used), 0) AS credits_used
      FROM usage_events
      WHERE user_id = $1
        AND occurred_at >= $2
        AND occurred_at < ($3::date + INTERVAL '1 day')
      GROUP BY DATE(occurred_at)
      ORDER BY date ASC
    `,
    userId,
    periodStart,
    periodEnd
  );
}

function notCancelledJobCondition(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE((${prefix}input_payload->>'cancelled_by_user')::boolean, FALSE) = FALSE`;
}

async function countProcessingJobs(
  db: DatabaseClient,
  jobStatus?: string | null,
  track?: string | null
): Promise<number> {
  const failedClause = jobStatus === "failed" ? ` AND ${notCancelledJobCondition()}` : "";
  return Number(
    (await db.fetchval(
      `
        SELECT COUNT(*)
        FROM processing_jobs
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR track = $2)
          ${failedClause}
      `,
      jobStatus ?? null,
      track ?? null
    )) ?? 0
  );
}

async function listProcessingJobs(
  db: DatabaseClient,
  jobStatus: string | null | undefined,
  track: string | null | undefined,
  limit: number,
  offset: number
): Promise<Record<string, unknown>[]> {
  const failedClause = jobStatus === "failed" ? ` AND ${notCancelledJobCondition()}` : "";
  const rows = await db.fetch(
    `
      SELECT
          id,
          track,
          job_type,
          status,
          attempts,
          max_attempts,
          error_message,
          created_at,
          started_at,
          completed_at,
          updated_at
      FROM processing_jobs
      WHERE ($1::text IS NULL OR status = $1)
        AND ($2::text IS NULL OR track = $2)
        ${failedClause}
      ORDER BY created_at DESC
      LIMIT $3
      OFFSET $4
    `,
    jobStatus ?? null,
    track ?? null,
    limit,
    offset
  );
  return rows.map((row) => normalizeProcessingJobSummary(row));
}

async function fetchProcessingJob(db: DatabaseClient, jobId: string): Promise<Record<string, unknown> | null> {
  const row = await db.fetchrow(
    `
      SELECT
          id,
          track,
          source_id,
          job_type,
          status,
          input_payload,
          error_message,
          attempts,
          max_attempts,
          locked_by,
          locked_at,
          next_retry_at,
          created_at,
          started_at,
          completed_at,
          updated_at
      FROM processing_jobs
      WHERE id = $1
    `,
    jobId
  );
  return row ? normalizeProcessingJobDetail(row) : null;
}

async function listProcessingJobSteps(db: DatabaseClient, jobId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.fetch(
    `
      SELECT
          id,
          step_name,
          status,
          artifacts,
          error_message,
          started_at,
          completed_at,
          updated_at
      FROM processing_job_steps
      WHERE job_id = $1
      ORDER BY
          COALESCE(started_at, completed_at, updated_at) ASC,
          step_name ASC
    `,
    jobId
  );
  return rows.map((row) => normalizeProcessingJobStep(row));
}

async function fetchProcessingJobStats(db: DatabaseClient): Promise<Record<string, number>> {
  const row = await db.fetchrow(
    `
      SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'running') AS running,
          COUNT(*) FILTER (WHERE status = 'retrying') AS retrying,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (
              WHERE status = 'failed'
                AND ${notCancelledJobCondition()}
          ) AS failed,
          COUNT(*) FILTER (WHERE track = 'broll') AS broll,
          COUNT(*) FILTER (WHERE track = 'knowledge') AS knowledge,
          COUNT(*) FILTER (WHERE track = 'unified') AS unified
      FROM processing_jobs
    `
  );
  const payload = row ?? {};
  return {
    total: Number(payload.total ?? 0),
    pending: Number(payload.pending ?? 0),
    running: Number(payload.running ?? 0),
    retrying: Number(payload.retrying ?? 0),
    completed: Number(payload.completed ?? 0),
    failed: Number(payload.failed ?? 0),
    broll: Number(payload.broll ?? 0),
    knowledge: Number(payload.knowledge ?? 0),
    unified: Number(payload.unified ?? 0)
  };
}

async function generateApiKey(): Promise<{ rawKey: string; keyHash: string; prefix: string }> {
  const token = randomHex(API_KEY_TOKEN_LENGTH);
  const rawKey = `${API_KEY_PREFIX}${token}`;
  const keyHash = await sha256Hex(rawKey);
  return {
    rawKey,
    keyHash,
    prefix: rawKey.slice(0, API_KEY_PREFIX_LENGTH)
  };
}

export function createDashboardRouter(): any {
  const router = new Hono();

  router.post("/api-keys", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const rawPayload = ensureJsonObject(await c.req.json(), "Request body must be a JSON object.");
    const name = String(rawPayload.name ?? "").trim();

    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    const tier = String(profile.tier ?? "free").toLowerCase();
    const activeKeyCount = await countActiveApiKeys(db, session.userId);
    const keyLimit = keyLimitForTier(tier);
    if (activeKeyCount >= keyLimit) {
      apiError(403, `${tier} tier allows at most ${keyLimit} active API key(s).`);
    }
    if (!name) {
      apiError(422, "API key name must not be empty.");
    }

    const generated = await generateApiKey();
    const created = await insertApiKey(db, session.userId, name, generated.keyHash, generated.prefix);
    return c.json(
      {
        key_id: String(created.id),
        raw_key: generated.rawKey
      },
      201
    );
  });

  router.get("/api-keys", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    return c.json({
      api_keys: await listApiKeysForUser(db, session.userId)
    });
  });

  router.delete("/api-keys/:keyId", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const deleted = await softDeleteApiKey(db, c.req.param("keyId"), session.userId);
    if (!deleted) {
      apiError(404, "API key not found.");
    }
    return emptyResponse(204);
  });

  router.get("/usage/monthly", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    const [periodStart, periodEnd] = getCurrentBillingPeriod();
    const summary = await fetchUsageSummary(db, session.userId, periodStart, periodEnd);
    const dailyBreakdown = await fetchDailyUsageBreakdown(
      db,
      session.userId,
      periodStart,
      periodEnd
    );
    const apiKeysActive = await countActiveApiKeys(db, session.userId);
    const tier = String(profile.tier ?? "free").toLowerCase();
    const creditsLimit = Number(profile.monthly_credit_limit ?? monthlyCreditLimitForTier(tier));
    const creditsUsed = Number(summary.credits_used ?? 0);

    return c.json({
      tier,
      period_start: periodStart,
      period_end: periodEnd,
      credits_limit: creditsLimit,
      credits_used: creditsUsed,
      credits_remaining: Math.max(creditsLimit - creditsUsed, 0),
      request_count: Number(summary.request_count ?? 0),
      api_keys_active: apiKeysActive,
      rate_limit_per_sec: Number(profile.rate_limit_per_sec ?? 0),
      has_stripe_customer: Boolean(profile.stripe_customer_id),
      daily_breakdown: dailyBreakdown
    });
  });

  router.get("/jobs", sessionAuth(), adminAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const statusFilter = c.req.query("status") ?? null;
    const track = c.req.query("track") ?? null;
    const limit = Math.max(Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 200), 1);
    const offset = Math.max(Number.parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
    const jobs = await listProcessingJobs(db, statusFilter, track, limit, offset);
    const totalCount = await countProcessingJobs(db, statusFilter, track);
    return c.json({ jobs, total_count: totalCount });
  });

  router.get("/jobs/stats", sessionAuth(), adminAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const stats = await fetchProcessingJobStats(db);
    return c.json({
      total: stats.total,
      pending: stats.pending,
      running: stats.running,
      retrying: stats.retrying,
      completed: stats.completed,
      failed: stats.failed,
      tracks: {
        broll: stats.broll,
        knowledge: stats.knowledge,
        unified: stats.unified
      }
    });
  });

  router.get("/jobs/:jobId", sessionAuth(), adminAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const jobId = c.req.param("jobId");
    const job = await fetchProcessingJob(db, jobId);
    if (!job) {
      apiError(404, "Processing job not found.");
    }
    const steps = await listProcessingJobSteps(db, jobId);
    return c.json({
      ...job,
      steps
    });
  });

  router.post("/billing/checkout", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    const currentTier = String(profile.tier ?? "free").toLowerCase();
    if (isPaidTier(currentTier)) {
      apiError(409, "Subscription already exists; use the billing portal instead.");
    }

    const email = session.email ?? (profile.email == null ? null : String(profile.email));
    if (!email) {
      apiError(400, "Authenticated session is missing an email address.");
    }

    try {
      const checkoutUrl = await createCheckoutSession(
        config,
        session.userId,
        email,
        profile.stripe_customer_id == null ? null : String(profile.stripe_customer_id)
      );
      return c.json({ checkout_url: checkoutUrl });
    } catch (error) {
      if (error instanceof StripeServiceError) {
        apiError(503, error.message);
      }
      throw error;
    }
  });

  router.post("/billing/portal", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }
    const stripeCustomerId = profile.stripe_customer_id == null ? null : String(profile.stripe_customer_id);
    if (!stripeCustomerId) {
      apiError(404, "Stripe customer not found for this user.");
    }

    try {
      const portalUrl = await createPortalSession(config, stripeCustomerId);
      return c.json({ portal_url: portalUrl });
    } catch (error) {
      if (error instanceof StripeServiceError) {
        apiError(503, error.message);
      }
      throw error;
    }
  });

  return router;
}
