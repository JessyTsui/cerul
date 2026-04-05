import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { adminAuth, sessionAuth } from "../middleware/auth";
import {
  BillingHoldError,
  calculateCreditsRemaining,
  consumeSearchCredits,
  fetchBillingCatalogState,
  fetchDailySearchAllowance,
  fetchReferralStats,
  fetchUsageSummary as fetchUserUsageSummary,
  InsufficientCreditsError,
  isPaidTier,
  keyLimitForTier,
  redeemReferralCode,
  refundCredits,
  updateReferralCode
} from "../services/billing";
import { getProProduct } from "../services/billing-catalog";
import {
  createCheckoutSession,
  createPortalSession,
  createSetupSession,
  listPaymentMethods,
  retrieveCheckoutSession,
  retrieveInvoice,
  retrieveSubscription,
  createTopupCheckoutSession,
  activateCheckoutSubscription,
  StripeServiceError
} from "../services/stripe";
import {
  fulfillSubscriptionInvoice,
  fulfillTopupCheckout
} from "../services/billing";
import { sendBillingNotification } from "../services/transactional-email";
import { apiError, emptyResponse } from "../utils/http";
import { sha256Hex, randomHex } from "../utils/crypto";
import { ensureJsonObject, parseBoolean, parseInteger, asString, isPlainObject, parseDateString } from "../utils/validation";
import { UnifiedSearchService } from "../services/search";
import type { SearchRequest, UnifiedFilters } from "../types";

const API_KEY_PREFIX = "cerul_";
const API_KEY_TOKEN_LENGTH = 32;
const API_KEY_PREFIX_LENGTH = 16;

type DashboardSession = {
  userId: string;
  email: string | null;
};

function utcNow(): Date {
  return new Date();
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

function stripeCreatedAt(value: unknown): Date | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed * 1000);
}

function normalizeExpandableId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "object" && value != null && "id" in value) {
    return normalizeString((value as { id?: unknown }).id);
  }
  return null;
}

function sumDiscounts(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.reduce((sum, item) => sum + normalizeInteger(
    typeof item === "object" && item != null && "amount" in item ? (item as { amount?: unknown }).amount : null
  ), 0);
}

function extractInvoicePeriod(invoice: Record<string, unknown>): { periodStart: string; periodEnd: string } {
  const lines = Array.isArray((invoice.lines as { data?: unknown[] } | undefined)?.data)
    ? ((invoice.lines as { data?: unknown[] }).data ?? [])
    : [];
  const firstLine = lines.find((line) => typeof line === "object" && line != null) as Record<string, unknown> | undefined;
  const period = firstLine && typeof firstLine.period === "object" && firstLine.period != null
    ? firstLine.period as Record<string, unknown>
    : {};
  const startSeconds = Number(period.start);
  const endSeconds = Number(period.end);
  const createdAt = stripeCreatedAt(invoice.created) ?? new Date();

  if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
    const periodStart = new Date(startSeconds * 1000).toISOString().slice(0, 10);
    const periodEnd = new Date(Math.max(endSeconds * 1000 - 1000, startSeconds * 1000)).toISOString().slice(0, 10);
    return { periodStart, periodEnd };
  }

  const year = createdAt.getUTCFullYear();
  const month = createdAt.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

function isCheckoutComplete(checkoutSession: Record<string, unknown>): boolean {
  return normalizeString(checkoutSession.status) === "complete";
}

function isPaymentCheckoutPaid(checkoutSession: Record<string, unknown>): boolean {
  return normalizeString(checkoutSession.payment_status) === "paid";
}

function isSubscriptionCheckoutReady(checkoutSession: Record<string, unknown>): boolean {
  const paymentStatus = normalizeString(checkoutSession.payment_status);
  return paymentStatus === "paid" || paymentStatus === "no_payment_required";
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
    raw_key: payload.raw_key == null ? null : String(payload.raw_key),
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

function normalizeQueryLogResultPreviews(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item != null);
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
          stripe_customer_id,
          has_payment_method_on_file,
          stripe_subscription_id,
          billing_hold,
          auto_recharge_enabled,
          auto_recharge_threshold,
          auto_recharge_quantity
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
          stripe_customer_id,
          has_payment_method_on_file,
          stripe_subscription_id,
          billing_hold,
          auto_recharge_enabled,
          auto_recharge_threshold,
          auto_recharge_quantity
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
  prefix: string,
  rawKey: string
): Promise<Record<string, unknown>> {
  const row = await db.fetchrow(
    `
      INSERT INTO api_keys (user_id, name, key_hash, prefix, raw_key, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id, name, prefix, raw_key, created_at, last_used_at, is_active
    `,
    userId,
    name,
    keyHash,
    prefix,
    rawKey
  );
  if (!row) {
    apiError(500, "Failed to create API key.");
  }
  return row;
}

async function listApiKeysForUser(db: DatabaseClient, userId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.fetch(
    `
      SELECT id, name, prefix, raw_key, created_at, last_used_at, is_active
      FROM api_keys
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC
    `,
    userId
  );
  return rows.map((row) => normalizeApiKeySummary(row));
}

async function resolvePlaygroundApiKeyId(
  db: DatabaseClient,
  userId: string,
  requestedKeyId?: string | null
): Promise<string> {
  const row = requestedKeyId
    ? await db.fetchrow(
        `
          SELECT id
          FROM api_keys
          WHERE id = $1
            AND user_id = $2
            AND is_active = TRUE
        `,
        requestedKeyId,
        userId
      )
    : await db.fetchrow(
        `
          SELECT id
          FROM api_keys
          WHERE user_id = $1
            AND is_active = TRUE
          ORDER BY created_at ASC
          LIMIT 1
        `,
        userId
      );

  if (!row) {
    if (requestedKeyId) {
      apiError(404, "Selected API key not found or inactive.");
    }
    apiError(403, "No active API key found. Create an API key first.");
  }

  return String(row.id);
}

function normalizePlaygroundFilters(filters: unknown): UnifiedFilters | null {
  if (filters == null) {
    return null;
  }
  if (!isPlainObject(filters)) {
    apiError(400, "filters must be an object.");
  }

  const normalized: UnifiedFilters = {
    speaker: asString(filters.speaker),
    published_after: parseDateString(filters.published_after, "filters.published_after"),
    min_duration: filters.min_duration == null ? null : parseInteger(filters.min_duration, "filters.min_duration", 0),
    max_duration: filters.max_duration == null ? null : parseInteger(filters.max_duration, "filters.max_duration", 0),
    source: asString(filters.source),
  };

  if ((normalized.min_duration ?? 0) < 0 || (normalized.max_duration ?? 0) < 0) {
    apiError(400, "filters duration values must be greater than or equal to 0.");
  }
  if (
    normalized.min_duration != null &&
    normalized.max_duration != null &&
    normalized.min_duration > normalized.max_duration
  ) {
    apiError(400, "min_duration must be less than or equal to max_duration");
  }

  return normalized;
}

async function ensurePlaygroundResultOwnership(
  db: DatabaseClient,
  userId: string,
  requestId: string,
  resultId: string
): Promise<void> {
  const row = await db.fetchrow(
    `
      SELECT 1
      FROM query_logs AS ql
      WHERE ql.request_id = $1
        AND ql.user_id = $2
        AND ql.search_surface = 'playground'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(ql.results_preview) AS preview(item)
          WHERE preview.item->>'result_id' = $3
        )
      LIMIT 1
    `,
    requestId,
    userId,
    resultId
  );

  if (!row) {
    apiError(404, "Playground result not found for this request.");
  }
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

async function fetchUsageAggregate(
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
  const rows = await db.fetch<{ date: string; request_count: number; credits_used: number }>(
    `
      SELECT TO_CHAR(DATE(occurred_at), 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS request_count,
             COALESCE(SUM(credits_used), 0)::int AS credits_used
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
  return rows;
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
    const hasPaid = isPaidTier(tier) || Boolean(profile.has_payment_method_on_file);
    const activeKeyCount = await countActiveApiKeys(db, session.userId);
    const keyLimit = hasPaid ? Infinity : keyLimitForTier(tier);
    if (activeKeyCount >= keyLimit) {
      apiError(403, `Free tier allows at most ${keyLimit} active API key(s). Add a payment method to unlock unlimited keys.`);
    }
    if (!name) {
      apiError(422, "API key name must not be empty.");
    }

    const generated = await generateApiKey();
    const created = await insertApiKey(
      db,
      session.userId,
      name,
      generated.keyHash,
      generated.prefix,
      generated.rawKey
    );
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
    const activeCount = await countActiveApiKeys(db, session.userId);
    if (activeCount <= 1) {
      apiError(403, "Cannot delete your last API key. At least one active key is required.");
    }
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
    const summary = await fetchUserUsageSummary(db, session.userId);
    const aggregate = await fetchUsageAggregate(db, session.userId, periodStart, periodEnd);
    const dailyBreakdown = await fetchDailyUsageBreakdown(
      db,
      session.userId,
      periodStart,
      periodEnd
    );
    const apiKeysActive = await countActiveApiKeys(db, session.userId);
    const dailyFree = await fetchDailySearchAllowance(db, session.userId);
    const tier = String(summary.plan_code ?? profile.tier ?? "free").toLowerCase();
    const creditsLimit = Number(summary.credits_limit ?? 0);
    const creditsUsed = Number(summary.credits_used ?? 0);
    const creditsRemaining = calculateCreditsRemaining(summary);

    return c.json({
      tier,
      period_start: periodStart,
      period_end: periodEnd,
      credits_limit: creditsLimit,
      credits_used: creditsUsed,
      credits_remaining: creditsRemaining,
      wallet_balance: Number(summary.wallet_balance ?? creditsRemaining),
      credit_breakdown: summary.credit_breakdown ?? {
        included_remaining: 0,
        bonus_remaining: 0,
        paid_remaining: 0
      },
      expiring_credits: Array.isArray(summary.expiring_credits) ? summary.expiring_credits : [],
      request_count: Number(aggregate.request_count ?? 0),
      api_keys_active: apiKeysActive,
      rate_limit_per_sec: Number(profile.rate_limit_per_sec ?? 0),
      has_stripe_customer: Boolean(profile.stripe_customer_id),
      billing_hold: Boolean(summary.billing_hold),
      daily_free_remaining: dailyFree.remaining,
      daily_free_limit: dailyFree.limit,
      daily_breakdown: dailyBreakdown,
      server_timestamp: new Date().toISOString()
    });
  });

  router.get("/query-logs", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const limitParam = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);
    const offsetParam = Number.parseInt(c.req.query("offset") ?? "0", 10);
    const offset = Math.max(offsetParam, 0);

    const rows = await db.fetch<{
      request_id: string;
      search_type: string;
      search_surface: string | null;
      query_text: string;
      include_answer: boolean;
      result_count: number;
      latency_ms: number | null;
      created_at: string;
      credits_used: number | null;
      answer_text: string | null;
      results_preview: unknown;
    }>(
      `
        SELECT
            ql.request_id,
            ql.search_type,
            ql.search_surface,
            ql.query_text,
            ql.include_answer,
            ql.result_count,
            ql.latency_ms,
            ql.created_at,
            ql.answer_text,
            ql.results_preview,
            ue.credits_used
        FROM query_logs ql
        LEFT JOIN usage_events ue ON ue.request_id = ql.request_id
        WHERE ql.user_id = $1
        ORDER BY ql.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      session.userId,
      limit,
      offset
    );

    const total = await db.fetchval<number>(
      `SELECT COUNT(*)::int FROM query_logs WHERE user_id = $1`,
      session.userId
    );

    return c.json({
      items: rows.map((row) => ({
        request_id: row.request_id,
        search_type: row.search_type,
        search_surface: row.search_surface,
        query_text: row.query_text,
        include_answer: row.include_answer,
        result_count: Number(row.result_count ?? 0),
        latency_ms: row.latency_ms != null ? Number(row.latency_ms) : null,
        credits_used: row.credits_used != null ? Number(row.credits_used) : 0,
        created_at: row.created_at,
        answer_text: row.answer_text ?? null,
        results: normalizeQueryLogResultPreviews(row.results_preview).slice(0, 5).map((preview) => ({
          rank: Number(preview.rank ?? 0),
          title: preview.title ?? "",
          source: preview.source ?? "",
          thumbnail_url: preview.thumbnail_url ?? null,
          target_url: preview.url ?? null,
          score: preview.score != null ? Number(preview.score) : null,
        })),
      })),
      total: Number(total ?? 0),
      limit,
      offset,
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
      apiError(409, "A subscription already exists; use the billing portal instead.");
    }
    if (Boolean(profile.billing_hold)) {
      apiError(403, "Billing account requires review before a new checkout can be created.");
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

  router.post("/billing/topup", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    const rawPayload = ensureJsonObject(await c.req.json().catch(() => ({})), "Request body must be a JSON object.");
    const rawQuantity = typeof rawPayload.quantity === "number" && Number.isFinite(rawPayload.quantity)
      ? rawPayload.quantity
      : 1000;
    const quantity = Math.max(Math.round(rawQuantity / 100) * 100, 1000);

    if (Boolean(profile.billing_hold)) {
      apiError(403, "Billing account requires review before a new purchase can be created.");
    }

    const email = session.email ?? (profile.email == null ? null : String(profile.email));
    if (!email) {
      apiError(400, "Authenticated session is missing an email address.");
    }

    try {
      const checkoutUrl = await createTopupCheckoutSession(config, {
        userId: session.userId,
        email,
        stripeCustomerId: profile.stripe_customer_id == null ? null : String(profile.stripe_customer_id),
        quantity
      });
      return c.json({ checkout_url: checkoutUrl, quantity });
    } catch (error) {
      if (error instanceof StripeServiceError) {
        apiError(503, error.message);
      }
      throw error;
    }
  });

  router.post("/billing/reconcile-checkout", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const payload = ensureJsonObject(await c.req.json().catch(() => ({})), "Request body must be a JSON object.");
    const checkoutSessionId = normalizeString(payload.session_id) ?? normalizeString(payload.sessionId);

    if (!checkoutSessionId) {
      apiError(400, "Stripe checkout session id is required.");
    }

    try {
      const checkoutSession = await retrieveCheckoutSession(config, checkoutSessionId);
      const checkoutUserId = normalizeString(checkoutSession.client_reference_id)
        ?? normalizeString(checkoutSession.metadata?.user_id);

      if (!checkoutUserId || checkoutUserId !== session.userId) {
        apiError(403, "This checkout session does not belong to the authenticated user.");
      }

      const mode = normalizeString(checkoutSession.mode);
      if (!isCheckoutComplete(checkoutSession as unknown as Record<string, unknown>)) {
        apiError(409, "Stripe checkout has not completed yet.");
      }

      if (mode === "payment") {
        if (!isPaymentCheckoutPaid(checkoutSession as unknown as Record<string, unknown>)) {
          apiError(409, "Stripe payment has not settled yet.");
        }
        const credits = Number(checkoutSession.metadata?.quantity) || 1000;
        const notification = await fulfillTopupCheckout(db, {
          userId: session.userId,
          credits,
          stripeCheckoutSessionId: String(checkoutSession.id),
          stripeCustomerId: normalizeExpandableId(checkoutSession.customer),
          stripePaymentIntentId: normalizeExpandableId(checkoutSession.payment_intent),
          currency: normalizeString(checkoutSession.currency),
          grossAmountCents: normalizeInteger(checkoutSession.amount_subtotal ?? checkoutSession.amount_total),
          discountAmountCents: normalizeInteger(
            typeof checkoutSession.total_details === "object" && checkoutSession.total_details != null
              ? (checkoutSession.total_details as { amount_discount?: unknown }).amount_discount
              : 0
          ),
          netAmountCents: normalizeInteger(checkoutSession.amount_total),
          occurredAt: stripeCreatedAt(checkoutSession.created)
        });

        if (notification) {
          void sendBillingNotification(config, notification).catch((error) => {
            console.error("[billing] Failed to send top-up email:", error);
          });
        }

        return c.json({
          status: "ok",
          mode,
          credits_granted: credits
        });
      }

      if (mode === "subscription") {
        if (!isSubscriptionCheckoutReady(checkoutSession as unknown as Record<string, unknown>)) {
          apiError(409, "Stripe subscription checkout is not paid yet.");
        }
        const stripeCustomerId = normalizeExpandableId(checkoutSession.customer);
        const stripeSubscriptionId = normalizeExpandableId(checkoutSession.subscription);
        if (!stripeSubscriptionId) {
          apiError(409, "Stripe subscription is not ready yet.");
        }

        await activateCheckoutSubscription(
          db,
          session.userId,
          stripeCustomerId,
          stripeSubscriptionId
        );
        await db.execute(
          `
            UPDATE user_profiles
            SET
                has_payment_method_on_file = TRUE,
                updated_at = NOW()
            WHERE id = $1
          `,
          session.userId
        );

        let notification = null;
        let invoiceId = normalizeExpandableId(checkoutSession.invoice);
        if (!invoiceId && stripeSubscriptionId) {
          const subscription = await retrieveSubscription(config, stripeSubscriptionId);
          invoiceId = normalizeExpandableId(subscription.latest_invoice);
        }

        if (invoiceId) {
          const invoice = await retrieveInvoice(config, invoiceId) as unknown as Record<string, unknown>;
          const { periodStart, periodEnd } = extractInvoicePeriod(invoice);
          const customerId = normalizeExpandableId(invoice.customer) ?? stripeCustomerId;
          if (customerId) {
            notification = await fulfillSubscriptionInvoice(db, {
              stripeInvoiceId: invoiceId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: normalizeExpandableId(invoice.subscription) ?? stripeSubscriptionId,
              stripePaymentIntentId: normalizeExpandableId(invoice.payment_intent),
              currency: normalizeString(invoice.currency),
              grossAmountCents: normalizeInteger(invoice.subtotal ?? invoice.amount_due ?? invoice.amount_paid),
              discountAmountCents: sumDiscounts(invoice.total_discount_amounts),
              netAmountCents: normalizeInteger(invoice.amount_paid ?? invoice.amount_due),
              periodStart,
              periodEnd,
              occurredAt: stripeCreatedAt(invoice.created),
              metadata: {
                billing_reason: normalizeString(invoice.billing_reason) ?? undefined,
                reconciled_from_checkout: true
              }
            });
          }
        }

        if (notification) {
          void sendBillingNotification(config, notification).catch((error) => {
            console.error("[billing] Failed to send subscription email:", error);
          });
        }

        return c.json({
          status: "ok",
          mode,
          tier: "pro",
          credits_granted: notification?.kind === "subscription_activated" ? notification.includedCredits : 0
        });
      }

      apiError(400, "Unsupported Stripe checkout session mode.");
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

  router.get("/billing/auto-recharge", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    return c.json({
      enabled: Boolean(profile.auto_recharge_enabled),
      threshold: Number(profile.auto_recharge_threshold ?? 100),
      quantity: Number(profile.auto_recharge_quantity ?? 1000)
    });
  });

  router.post("/billing/auto-recharge", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile) {
      apiError(404, "User profile not found.");
    }

    const payload = ensureJsonObject(await c.req.json().catch(() => ({})), "Request body must be a JSON object.");
    const enabled = payload.enabled === true;
    const threshold = typeof payload.threshold === "number" && Number.isFinite(payload.threshold)
      ? Math.max(Math.round(payload.threshold), 0)
      : 100;
    const quantity = typeof payload.quantity === "number" && Number.isFinite(payload.quantity)
      ? Math.max(Math.round(payload.quantity / 100) * 100, 1000)
      : 1000;

    if (enabled && !profile.stripe_customer_id) {
      apiError(409, "A saved Stripe customer is required before auto-recharge can be enabled.");
    }

    await db.execute(
      `
        UPDATE user_profiles
        SET auto_recharge_enabled = $1,
            auto_recharge_threshold = $2,
            auto_recharge_quantity = $3,
            updated_at = NOW()
        WHERE id = $4
      `,
      enabled,
      threshold,
      quantity,
      session.userId
    );

    return c.json({ enabled, threshold, quantity });
  });

  router.get("/billing/catalog", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const state = await fetchBillingCatalogState(db, session.userId);
    return c.json({
      ...state,
      pro: getProProduct(config)
    });
  });

  router.post("/billing/referrals/redeem", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const payload = ensureJsonObject(await c.req.json(), "Request body must be a JSON object.");
    const code = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!code) {
      apiError(422, "Referral code must not be empty.");
    }

    try {
      const result = await redeemReferralCode(db, session.userId, code);
      const state = await fetchBillingCatalogState(db, session.userId);
      return c.json({
        redeemed: true,
        code: result.code,
        status: result.status,
        referral: state.referral
      });
    } catch (error) {
      apiError(409, error instanceof Error ? error.message : "Unable to redeem referral code.");
    }
  });

  // ---- Referral code management ----

  router.post("/billing/referrals/update-code", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const payload = ensureJsonObject(await c.req.json(), "Request body must be a JSON object.");
    const code = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!code) {
      apiError(422, "Code must not be empty.");
    }

    try {
      const updated = await updateReferralCode(db, session.userId, code);
      return c.json({ code: updated.code });
    } catch (error) {
      apiError(409, error instanceof Error ? error.message : "Unable to update referral code.");
    }
  });

  router.get("/billing/referrals/stats", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const stats = await fetchReferralStats(db, session.userId);
    return c.json(stats);
  });

  // ---- Payment methods ----

  router.get("/billing/payment-methods", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config");
    const session = c.get("session") as DashboardSession;
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile?.stripe_customer_id) {
      await db.execute(
        `
          UPDATE user_profiles
          SET
              has_payment_method_on_file = FALSE,
              updated_at = NOW()
          WHERE id = $1
        `,
        session.userId
      );
      return c.json({ methods: [] });
    }
    try {
      const methods = await listPaymentMethods(config, String(profile.stripe_customer_id));
      await db.execute(
        `
          UPDATE user_profiles
          SET
              has_payment_method_on_file = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        session.userId,
        methods.length > 0
      );
      return c.json({ methods });
    } catch (error) {
      if (error instanceof StripeServiceError) {
        apiError(502, error.message);
      }
      throw error;
    }
  });

  router.post("/billing/setup-payment", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const config = c.get("config");
    const session = c.get("session") as DashboardSession;
    const profile = await fetchUserProfile(db, session.userId);
    if (!profile?.stripe_customer_id) {
      apiError(400, "No billing account. Complete a checkout first.");
    }
    try {
      const url = await createSetupSession(config, String(profile.stripe_customer_id));
      return c.json({ url });
    } catch (error) {
      if (error instanceof StripeServiceError) {
        apiError(502, error.message);
      }
      throw error;
    }
  });

  // ---- Avatar upload ----

  const AVATAR_ALLOWED_TYPES: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  };
  const AVATAR_MAX_SIZE = 2 * 1024 * 1024;

  router.post("/user/avatar", sessionAuth(), async (c: any) => {
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const env = c.env;
    const bucket = env.QUERY_IMAGES_BUCKET;

    if (!bucket) {
      apiError(503, "File storage is not configured.");
    }

    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      apiError(400, "Missing file field in upload.");
    }

    if (file.size > AVATAR_MAX_SIZE) {
      apiError(400, `Avatar too large: ${file.size} bytes (max ${AVATAR_MAX_SIZE}).`);
    }

    const mimeType = (file.type || "").split(";")[0].trim().toLowerCase();
    const extension = AVATAR_ALLOWED_TYPES[mimeType];

    if (!extension) {
      apiError(400, `Unsupported image type: ${mimeType || "unknown"}. Use JPEG, PNG, or WebP.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const key = `user-avatars/${session.userId}/${hash}${extension}`;

    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable"
      }
    });

    const publicUrl = config.r2.publicUrl
      ? `${config.r2.publicUrl}/${key}`
      : key;

    return c.json({ url: publicUrl });
  });

  /* ── Playground: search ────────────────────────────── */

  router.post("/playground/search", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const config = c.get("config");
    const rawPayload = ensureJsonObject(await c.req.json(), "Request body must be a JSON object.");

    const query = asString(rawPayload.query);
    if (!query) {
      apiError(400, "query is required.");
    }

    const maxResults = parseInteger(rawPayload.max_results, "max_results", 5);
    const includeAnswer = parseBoolean(rawPayload.include_answer, "include_answer", false);
    const includeSummary = parseBoolean(rawPayload.include_summary, "include_summary", false);
    const requestedApiKeyId = asString(rawPayload.api_key_id);
    const apiKeyId = await resolvePlaygroundApiKeyId(db, session.userId, requestedApiKeyId);

    const rankingModeRaw = asString(rawPayload.ranking_mode);
    const rankingMode = rankingModeRaw === "rerank" ? "rerank" as const : "embedding" as const;

    // Parse optional filters
    const filters = normalizePlaygroundFilters(rawPayload.filters);

    const requestId = `req_${randomHex(24)}`;
    const requestStartedAt = Date.now();

    const payload: SearchRequest = {
      query,
      image: null,
      max_results: Math.min(Math.max(maxResults, 1), 20),
      ranking_mode: rankingMode,
      include_summary: includeSummary,
      include_answer: includeAnswer,
      filters,
    };

    let creditsUsed = 0;
    let usageRecorded = false;
    try {
      creditsUsed = await consumeSearchCredits(
        db,
        session.userId,
        apiKeyId,
        requestId,
        "unified",
        payload.include_answer
      );
      usageRecorded = true;

      const service = new UnifiedSearchService(db, c.env, config);
      const execution = await service.search({
        payload,
        userId: session.userId,
        requestId,
        image: null,
      });

      const latencyMs = Math.max(Date.now() - requestStartedAt, 0);

      // Log the query
      await db.execute(
        `INSERT INTO query_logs (request_id, user_id, api_key_id, search_type, search_surface, client_source, query_text, filters, max_results, include_answer, result_count, latency_ms, results_preview, answer_text)
         VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14)`,
        requestId,
        session.userId,
        apiKeyId,
        "unified",
        "playground",
        "playground",
        query,
        JSON.stringify(payload.filters ?? {}),
        payload.max_results,
        payload.include_answer,
        execution.results.length,
        latencyMs,
        JSON.stringify(execution.result_previews),
        execution.answer ?? null
      );

      const usageSummary = await fetchUserUsageSummary(db, session.userId);

      return c.json({
        results: execution.results,
        answer: execution.answer,
        credits_used: creditsUsed,
        credits_remaining: calculateCreditsRemaining(usageSummary),
        request_id: requestId,
      });
    } catch (error) {
      if (error instanceof BillingHoldError) {
        apiError(403, "Billing account requires review before more requests can be served.");
      }
      if (error instanceof InsufficientCreditsError) {
        apiError(403, "Insufficient credits for this request.");
      }
      if (usageRecorded) {
        try { await refundCredits(db, requestId); } catch { /* best-effort */ }
      }
      throw error;
    }
  });

  /* ── Playground: feedback ──────────────────────────── */

  router.post("/playground/feedback", sessionAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const session = c.get("session") as DashboardSession;
    const rawPayload = ensureJsonObject(await c.req.json(), "Request body must be a JSON object.");

    const requestId = asString(rawPayload.request_id);
    const resultId = asString(rawPayload.result_id);
    const rawRating = rawPayload.rating;

    if (!requestId || !resultId) {
      apiError(400, "request_id and result_id are required.");
    }
    const rating =
      rawRating === null
        ? null
        : typeof rawRating === "number" && Number.isFinite(rawRating)
          ? rawRating
          : Number.NaN;
    if (rating !== null && rating !== 1 && rating !== -1) {
      apiError(400, "rating must be 1 (thumbs up), -1 (thumbs down), or null to clear feedback.");
    }

    await ensurePlaygroundResultOwnership(db, session.userId, requestId, resultId);

    if (rating === null) {
      await db.execute(
        `DELETE FROM playground_feedback
         WHERE user_id = $1 AND request_id = $2 AND result_id = $3`,
        session.userId,
        requestId,
        resultId
      );
    } else {
      await db.execute(
        `INSERT INTO playground_feedback (user_id, request_id, result_id, rating)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, request_id, result_id)
         DO UPDATE SET rating = EXCLUDED.rating`,
        session.userId,
        requestId,
        resultId,
        rating
      );
    }

    return c.json({ ok: true });
  });

  return router;
}
