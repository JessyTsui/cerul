import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { apiKeyAuth } from "../middleware/auth";
import { calculateCreditsRemaining, deductCredits, fetchUsageSummary, InsufficientCreditsError, refundCredits } from "../services/billing";
import { resolveImageToBytes, uploadQueryImageToR2 } from "../services/query-image";
import { UnifiedSearchService } from "../services/search";
import type { SearchRequest, UnifiedFilters } from "../types";
import { randomHex } from "../utils/crypto";
import { apiError } from "../utils/http";
import { asString, ensureJsonObject, isPlainObject, parseBoolean, parseDateString, parseInteger } from "../utils/validation";

function generateRequestId(): string {
  return `req_${randomHex(24)}`;
}

function normalizeFilters(filters: unknown): UnifiedFilters | null {
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
    source: asString(filters.source)
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

function validateSearchRequest(payload: Record<string, unknown>): SearchRequest {
  const query = asString(payload.query);
  const imageValue = payload.image;
  let image: SearchRequest["image"] = null;

  if (imageValue != null) {
    if (!isPlainObject(imageValue)) {
      apiError(400, "image must be an object.");
    }
    const url = asString(imageValue.url);
    const base64 = asString(imageValue.base64);
    if (url && base64) {
      apiError(400, "Provide either 'url' or 'base64', not both.");
    }
    if (!url && !base64) {
      apiError(400, "Provide 'url' or 'base64'.");
    }
    image = { url, base64 };
  }

  const maxResults = parseInteger(payload.max_results, "max_results", 10);
  if (maxResults < 1 || maxResults > 50) {
    apiError(400, "max_results must be between 1 and 50.");
  }

  const rankingModeRaw = asString(payload.ranking_mode) ?? "embedding";
  const rankingMode = rankingModeRaw === "rerank" ? "rerank" : rankingModeRaw === "embedding" ? "embedding" : null;
  if (!rankingMode) {
    apiError(400, "ranking_mode must be 'embedding' or 'rerank'.");
  }

  if (!query && !image) {
    apiError(400, "At least one of 'query' or 'image' must be provided.");
  }

  return {
    query,
    image,
    max_results: maxResults,
    ranking_mode: rankingMode,
    include_summary: parseBoolean(payload.include_summary, "include_summary", false),
    include_answer: parseBoolean(payload.include_answer, "include_answer", false),
    filters: normalizeFilters(payload.filters)
  };
}

async function buildSearchRequestFromHttpRequest(request: Request): Promise<{ payload: SearchRequest; image: Awaited<ReturnType<typeof resolveImageToBytes>> | null }> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    let image = null;
    const imageFile = form.get("image_file");
    if (imageFile instanceof File) {
      try {
        image = await resolveImageToBytes({
          fileBytes: new Uint8Array(await imageFile.arrayBuffer()),
          fileContentType: imageFile.type
        });
      } catch (err) {
        apiError(422, err instanceof Error ? err.message : "Invalid image file.");
      }
    }

    const payload: Record<string, unknown> = {
      query: form.get("query"),
      max_results: form.get("max_results"),
      include_answer: form.get("include_answer"),
      ranking_mode: form.get("ranking_mode"),
      include_summary: form.get("include_summary")
    };

    const rawFilters = form.get("filters");
    if (rawFilters != null && String(rawFilters).trim()) {
      try {
        payload.filters = JSON.parse(String(rawFilters));
      } catch {
        apiError(400, "filters must be valid JSON.");
      }
    }
    if (image) {
      payload.image = { base64: "multipart-upload" };
    }

    return { payload: validateSearchRequest(payload), image };
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    apiError(400, "Request body must be valid JSON.");
  }
  const payload = ensureJsonObject(rawPayload, "Request body must be a JSON object.");
  const validatedPayload = validateSearchRequest(payload);
  let image: Awaited<ReturnType<typeof resolveImageToBytes>> | null = null;
  if (validatedPayload.image) {
    try {
      image = await resolveImageToBytes({
        url: validatedPayload.image.url ?? null,
        base64: validatedPayload.image.base64 ?? null
      });
    } catch (err) {
      apiError(422, err instanceof Error ? err.message : "Invalid image input.");
    }
  }
  return { payload: validatedPayload, image };
}

async function appendQueryLog(
  db: DatabaseClient,
  requestId: string,
  auth: any,
  payload: SearchRequest,
  resultsCount: number,
  latencyMs: number
): Promise<void> {
  await db.execute(
    `
      INSERT INTO query_logs (
          request_id,
          user_id,
          api_key_id,
          search_type,
          query_text,
          filters,
          max_results,
          include_answer,
          result_count,
          latency_ms
      )
      VALUES ($1, $2, $3::uuid, $4, $5, $6::jsonb, $7, $8, $9, $10)
    `,
    requestId,
    auth.userId,
    auth.apiKeyId,
    "unified",
    payload.query ?? "",
    JSON.stringify(payload.filters ?? {}),
    payload.max_results,
    payload.include_answer,
    resultsCount,
    latencyMs
  );
}

async function appendTrackingLinks(db: DatabaseClient, trackingLinks: any[]): Promise<void> {
  for (const trackingLink of trackingLinks) {
    await db.execute(
      `
        INSERT INTO tracking_links (
            short_id,
            request_id,
            result_rank,
            unit_id,
            video_id,
            target_url,
            title,
            thumbnail_url,
            source,
            speaker,
            unit_type,
            timestamp_start,
            timestamp_end,
            transcript,
            visual_desc,
            keyframe_url
        )
        VALUES (
            $1,
            $2,
            $3,
            $4::uuid,
            $5::uuid,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16
        )
        ON CONFLICT (short_id) DO NOTHING
      `,
      trackingLink.short_id,
      trackingLink.request_id,
      trackingLink.result_rank,
      trackingLink.unit_id,
      trackingLink.video_id,
      trackingLink.target_url,
      trackingLink.title,
      trackingLink.thumbnail_url,
      trackingLink.source,
      trackingLink.speaker,
      trackingLink.unit_type,
      trackingLink.timestamp_start,
      trackingLink.timestamp_end,
      trackingLink.transcript,
      trackingLink.visual_desc,
      trackingLink.keyframe_url
    );
  }
}

export function createSearchRouter(): any {
  const router = new Hono();

  router.post("/search", apiKeyAuth(), async (c: any) => {
    const requestStartedAt = Date.now();
    const requestId = generateRequestId();
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    const config = c.get("config");
    const { payload, image } = await buildSearchRequestFromHttpRequest(c.req.raw);
    const service = new UnifiedSearchService(db, c.env, config);

    let creditsUsed = 0;
    try {
      creditsUsed = await deductCredits(
        db,
        auth.userId,
        auth.apiKeyId,
        requestId,
        "unified",
        payload.include_answer
      );
      const execution = await service.search({
        payload,
        userId: auth.userId,
        requestId,
        image
      });

      const latencyMs = Math.max(Date.now() - requestStartedAt, 0);
      const usageSummary = await db.transaction(async (tx) => {
        await appendQueryLog(tx, requestId, auth, payload, execution.results.length, latencyMs);
        await appendTrackingLinks(tx, execution.tracking_links);
        return fetchUsageSummary(tx, auth.userId);
      });

      if (image) {
        c.executionCtx?.waitUntil(uploadQueryImageToR2(c.env, config, image, requestId));
      }

      return c.json({
        results: execution.results,
        answer: execution.answer,
        credits_used: creditsUsed,
        credits_remaining: calculateCreditsRemaining(usageSummary),
        request_id: requestId
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        apiError(403, "Insufficient credits for this request.");
      }
      if (creditsUsed > 0) {
        try {
          await refundCredits(db, requestId);
        } catch {
          // Best-effort refund only.
        }
      }
      throw error;
    }
  });

  return router;
}
