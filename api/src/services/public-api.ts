import type { DatabaseClient } from "../db/client";
import type {
  AppConfig,
  AuthContext,
  Bindings,
  ResolvedQueryImage,
  SearchRequest,
  SearchResponse,
  SearchSurface,
  UsageResponse
} from "../types";
import { randomHex } from "../utils/crypto";
import { apiError } from "../utils/http";
import {
  BillingHoldError,
  calculateCreditsRemaining,
  consumeSearchCredits,
  countActiveApiKeys,
  fetchDailySearchAllowance,
  fetchUsageSummary,
  InsufficientCreditsError,
  maybeAutoRecharge,
  refundCredits
} from "./billing";
import { UnifiedSearchService } from "./search";

function buildRequestId(): string {
  return `req_${randomHex(24)}`;
}

async function appendQueryLog(
  db: DatabaseClient,
  requestId: string,
  auth: AuthContext,
  searchSurface: SearchSurface,
  clientSource: string | null,
  payload: SearchRequest,
  resultsCount: number,
  latencyMs: number,
  resultPreviews: unknown[],
  answerText?: string | null
): Promise<void> {
  await db.execute(
    `
      INSERT INTO query_logs (
          request_id,
          user_id,
          api_key_id,
          search_type,
          search_surface,
          client_source,
          query_text,
          filters,
          max_results,
          include_answer,
          result_count,
          latency_ms,
          results_preview,
          answer_text
      )
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14)
    `,
    requestId,
    auth.userId,
    auth.apiKeyId,
    "unified",
    searchSurface,
    clientSource,
    payload.query ?? "",
    JSON.stringify(payload.filters ?? {}),
    payload.max_results,
    payload.include_answer,
    resultsCount,
    latencyMs,
    JSON.stringify(resultPreviews),
    answerText ?? null
  );
}

export async function executePublicSearch(input: {
  db: DatabaseClient;
  env: Bindings;
  config: AppConfig;
  auth: AuthContext;
  payload: SearchRequest;
  image?: ResolvedQueryImage | null;
  requestId?: string;
  searchSurface?: SearchSurface;
  clientSource?: string | null;
}): Promise<SearchResponse> {
  const requestStartedAt = Date.now();
  const requestId = input.requestId ?? buildRequestId();
  const searchSurface = input.searchSurface ?? "api";
  const clientSource = input.clientSource ?? null;
  const service = new UnifiedSearchService(input.db, input.env, input.config);

  let creditsUsed = 0;
  let usageRecorded = false;

  try {
    const chargeRequest = async () =>
      consumeSearchCredits(
        input.db,
        input.auth.userId,
        input.auth.apiKeyId,
        requestId,
        "unified",
        input.payload.include_answer
      );

    try {
      creditsUsed = await chargeRequest();
    } catch (error) {
      if (!(error instanceof InsufficientCreditsError)) {
        throw error;
      }

      const recharge = await maybeAutoRecharge(input.db, input.config, input.auth.userId);
      if (!recharge.triggered) {
        throw error;
      }

      creditsUsed = await chargeRequest();
    }
    usageRecorded = true;

    const execution = await service.search({
      payload: input.payload,
      userId: input.auth.userId,
      requestId,
      image: input.image ?? null
    });

    const latencyMs = Math.max(Date.now() - requestStartedAt, 0);
    const usageSummary = await input.db.transaction(async (tx) => {
      await appendQueryLog(
        tx,
        requestId,
        input.auth,
        searchSurface,
        clientSource,
        input.payload,
        execution.results.length,
        latencyMs,
        execution.result_previews,
        execution.answer
      );
      return fetchUsageSummary(tx, input.auth.userId);
    });

    if (creditsUsed > 0) {
      void maybeAutoRecharge(input.db, input.config, input.auth.userId).catch((error) =>
        console.error("[billing] auto-recharge error:", error)
      );
    }

    const response: SearchResponse = {
      results: execution.results,
      credits_used: creditsUsed,
      credits_remaining: calculateCreditsRemaining(usageSummary),
      request_id: requestId
    };

    if (input.payload.include_answer) {
      response.answer = execution.answer;
    }

    return response;
  } catch (error) {
    if (error instanceof BillingHoldError) {
      apiError(403, "Billing account requires review before more requests can be served.");
    }
    if (error instanceof InsufficientCreditsError) {
      apiError(403, "Insufficient credits for this request.");
    }
    if (usageRecorded) {
      try {
        await refundCredits(input.db, requestId);
      } catch {
        // Best-effort refund only.
      }
    }
    throw error;
  }
}

export async function buildPublicUsageResponse(
  db: DatabaseClient,
  auth: AuthContext
): Promise<UsageResponse> {
  const usageSummary = await fetchUsageSummary(db, auth.userId);
  const apiKeysActive = await countActiveApiKeys(db, auth.userId);
  const dailyFree = await fetchDailySearchAllowance(db, auth.userId);
  const creditBreakdown =
    usageSummary.credit_breakdown && typeof usageSummary.credit_breakdown === "object"
      ? (usageSummary.credit_breakdown as {
          included_remaining?: unknown;
          bonus_remaining?: unknown;
          paid_remaining?: unknown;
        })
      : null;

  return {
    tier: String(usageSummary.tier ?? ""),
    plan_code: String(usageSummary.plan_code ?? usageSummary.tier ?? ""),
    period_start: String(usageSummary.period_start),
    period_end: String(usageSummary.period_end),
    credits_limit: Number(usageSummary.credits_limit ?? 0),
    credits_used: Number(usageSummary.credits_used ?? 0),
    credits_remaining: calculateCreditsRemaining(usageSummary),
    wallet_balance: Number(usageSummary.wallet_balance ?? calculateCreditsRemaining(usageSummary)),
    credit_breakdown: {
      included_remaining: Number(creditBreakdown?.included_remaining ?? 0),
      bonus_remaining: Number(creditBreakdown?.bonus_remaining ?? 0),
      paid_remaining: Number(creditBreakdown?.paid_remaining ?? 0)
    },
    expiring_credits: Array.isArray(usageSummary.expiring_credits) ? usageSummary.expiring_credits : [],
    rate_limit_per_sec: Number(usageSummary.rate_limit_per_sec ?? 0),
    api_keys_active: apiKeysActive,
    billing_hold: Boolean(usageSummary.billing_hold),
    daily_free_remaining: dailyFree.remaining,
    daily_free_limit: dailyFree.limit
  };
}
