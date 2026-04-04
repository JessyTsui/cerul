import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { apiKeyAuth } from "../middleware/auth";
import { executePublicSearch } from "../services/public-api";
import { resolveImageToBytes, uploadQueryImageToR2 } from "../services/query-image";
import type { SearchRequest, UnifiedFilters } from "../types";
import { resolveClientSource } from "../utils/client-source";
import { apiError } from "../utils/http";
import { asString, ensureJsonObject, isPlainObject, parseBoolean, parseDateString, parseInteger } from "../utils/validation";

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
  if (query && query.length > 400) {
    apiError(400, "query must be 400 characters or fewer.");
  }
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


export function createSearchRouter(): any {
  const router = new Hono();

  router.post("/search", apiKeyAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    const config = c.get("config");
    const { payload, image } = await buildSearchRequestFromHttpRequest(c.req.raw);

    const response = await executePublicSearch({
      db,
      env: c.env,
      config,
      auth,
      payload,
      image,
      clientSource: resolveClientSource(c.req.raw)
    });

    if (image) {
      c.executionCtx?.waitUntil(uploadQueryImageToR2(c.env, config, image, response.request_id));
    }

    return c.json(response);
  });

  return router;
}
