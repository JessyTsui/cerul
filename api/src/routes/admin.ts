import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { adminAuth, sessionAuth } from "../middleware/auth";
import {
  createSource,
  createSourceFromUrl,
  deleteIndexedVideoData,
  deleteSource,
  fetchIndexedVideos,
  fetchSources,
  fetchSourcesAnalytics,
  fetchSourcesRecentVideos,
  fetchWorkerLive,
  fetchWorkerNodes,
  getVideoJobStatus,
  killJob,
  retryJob,
  submitVideo,
  syncSource,
  triggerYoutubeSearch,
  updateSource
} from "../services/admin";
import {
  deleteTarget,
  fetchAdminSummary,
  fetchContentSummary,
  fetchWorkersSummary,
  fetchRequestsSummary,
  fetchTargetsSummary,
  fetchUsersSummary,
  upsertTargets
} from "../services/admin-summary";
import { apiError, emptyResponse } from "../utils/http";
import { ensureJsonObject, parseInteger } from "../utils/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_RANGE_KEYS = new Set(["today", "7d", "30d"]);
const SOURCE_ANALYTICS_RANGE_KEYS = new Set(["24h", "3d", "7d", "15d", "30d"]);

function parseUuid(value: string, fieldName: string): string {
  if (!UUID_PATTERN.test(value)) {
    apiError(422, `${fieldName} must be a valid UUID.`);
  }
  return value;
}

function parseAdminRange(rangeKey: string | null | undefined): string {
  const normalized = (rangeKey ?? "7d").trim() || "7d";
  if (!ADMIN_RANGE_KEYS.has(normalized)) {
    apiError(422, "range must be one of: today, 7d, 30d.");
  }
  return normalized;
}

function parseSourceAnalyticsRange(rangeKey: string | null | undefined): string {
  const normalized = (rangeKey ?? "7d").trim() || "7d";
  if (!SOURCE_ANALYTICS_RANGE_KEYS.has(normalized)) {
    apiError(422, "range must be one of: 24h, 3d, 7d, 15d, 30d.");
  }
  return normalized;
}

function requireString(value: unknown, fieldName: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    apiError(400, `${fieldName} is required.`);
  }
  return normalized;
}

function parseBoundedInteger(
  value: unknown,
  fieldName: string,
  fallback: number,
  minimum: number,
  maximum?: number
): number {
  const parsed = parseInteger(value, fieldName, fallback);
  if (parsed < minimum || (maximum != null && parsed > maximum)) {
    if (maximum != null) {
      apiError(400, `${fieldName} must be between ${minimum} and ${maximum}.`);
    }
    apiError(400, `${fieldName} must be greater than or equal to ${minimum}.`);
  }
  return parsed;
}

async function parseJsonObjectBody(c: any): Promise<Record<string, unknown>> {
  let rawPayload: unknown;
  try {
    rawPayload = await c.req.json();
  } catch {
    apiError(400, "Request body must be valid JSON.");
  }
  return ensureJsonObject(rawPayload, "Request body must be a JSON object.");
}

export function createAdminRouter(): any {
  const router = new Hono();

  router.use("*", sessionAuth());
  router.use("*", adminAuth());

  router.get("/summary", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchAdminSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.get("/users/summary", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchUsersSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.get("/requests/summary", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchRequestsSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.get("/content/summary", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchContentSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.get("/workers/summary", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchWorkersSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.get("/targets", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchTargetsSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.put("/targets", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const payload = await parseJsonObjectBody(c);
    const rawTargets = payload.targets;
    if (!Array.isArray(rawTargets)) {
      apiError(400, "targets must be an array.");
    }
    if (rawTargets.some((target) => typeof target !== "object" || target == null || Array.isArray(target))) {
      apiError(400, "Each target must be an object.");
    }
    try {
      await upsertTargets(db, rawTargets as Array<Record<string, unknown>>);
    } catch (error) {
      apiError(400, (error as Error).message);
    }
    return c.json(await fetchTargetsSummary(db, parseAdminRange(c.req.query("range"))));
  });

  router.delete("/targets/:targetId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const targetId = parseUuid(c.req.param("targetId"), "target_id");
    const deleted = await deleteTarget(db, targetId);
    if (!deleted) {
      apiError(404, "Admin target not found.");
    }
    return emptyResponse(204);
  });

  router.get("/sources", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchSources(db));
  });

  router.get("/sources/analytics", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchSourcesAnalytics(db, parseSourceAnalyticsRange(c.req.query("range"))));
  });

  router.get("/sources/recent-videos", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const limit = parseBoundedInteger(c.req.query("limit"), "limit", 3, 1, 10);
    return c.json(await fetchSourcesRecentVideos(db, limit));
  });

  router.post("/sources/:sourceId/sync", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const sourceId = parseUuid(c.req.param("sourceId"), "source_id");
    try {
      return c.json(await syncSource(db, c.env, sourceId));
    } catch (error) {
      apiError(400, (error as Error).message);
    }
  });

  router.post("/sources/from-url", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const payload = await parseJsonObjectBody(c);
    try {
      return c.json(await createSourceFromUrl(db, c.env, requireString(payload.url, "url")));
    } catch (error) {
      apiError(400, (error as Error).message);
    }
  });

  router.post("/search/trigger", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const payload = await parseJsonObjectBody(c);
    try {
      return c.json(
        await triggerYoutubeSearch(db, c.env, {
          query: requireString(payload.query, "query"),
          max_results: parseBoundedInteger(payload.max_results, "max_results", 20, 1, 100),
          min_view_count: parseBoundedInteger(payload.min_view_count, "min_view_count", 5000, 0),
          min_duration_seconds: parseBoundedInteger(payload.min_duration_seconds, "min_duration_seconds", 180, 0)
        })
      );
    } catch (error) {
      apiError(400, (error as Error).message);
    }
  });

  router.post("/videos/submit", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const payload = await parseJsonObjectBody(c);
    try {
      return c.json(await submitVideo(db, c.env, requireString(payload.url, "url")));
    } catch (error) {
      apiError(400, (error as Error).message);
    }
  });

  router.get("/videos/job-status/:videoId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await getVideoJobStatus(db, requireString(c.req.param("videoId"), "video_id")));
  });

  router.post("/sources", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const payload = await parseJsonObjectBody(c);
    try {
      return c.json(await createSource(db, payload), 201);
    } catch (error) {
      apiError(400, (error as Error).message);
    }
  });

  router.patch("/sources/:sourceId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const sourceId = parseUuid(c.req.param("sourceId"), "source_id");
    const payload = await parseJsonObjectBody(c);
    let source: Record<string, unknown> | null;
    try {
      source = await updateSource(db, sourceId, payload);
    } catch (error) {
      apiError(400, (error as Error).message);
    }
    if (!source) {
      apiError(404, "Content source not found.");
    }
    return c.json(source);
  });

  router.delete("/sources/:sourceId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const sourceId = parseUuid(c.req.param("sourceId"), "source_id");
    const deleted = await deleteSource(db, sourceId);
    if (!deleted) {
      apiError(404, "Content source not found.");
    }
    return emptyResponse(204);
  });

  router.get("/worker/live", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const failedLimit = parseBoundedInteger(c.req.query("failed_limit"), "failed_limit", 10, 1, 100);
    const failedOffset = parseBoundedInteger(c.req.query("failed_offset"), "failed_offset", 0, 0);
    return c.json(await fetchWorkerLive(db, failedLimit, failedOffset));
  });

  router.get("/workers", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    return c.json(await fetchWorkerNodes(db));
  });

  router.get("/videos", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const query = c.req.query("query") ?? null;
    const limit = parseBoundedInteger(c.req.query("limit"), "limit", 10, 1, 100);
    const offset = parseBoundedInteger(c.req.query("offset"), "offset", 0, 0);
    return c.json(await fetchIndexedVideos(db, query, limit, offset));
  });

  router.delete("/videos/:videoId", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const videoId = parseUuid(c.req.param("videoId"), "video_id");
    const result = await deleteIndexedVideoData(db, videoId);
    if (!result) {
      apiError(404, "Indexed video not found.");
    }
    return c.json(result);
  });

  router.post("/jobs/:jobId/retry", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const jobId = parseUuid(c.req.param("jobId"), "job_id");
    const result = await retryJob(db, jobId);
    if (!result) {
      apiError(404, "Job not found or not in failed state.");
    }
    return c.json({ ok: true, job_id: jobId });
  });

  router.post("/jobs/:jobId/kill", async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const jobId = parseUuid(c.req.param("jobId"), "job_id");
    const result = await killJob(db, jobId);
    if (!result) {
      apiError(404, "Job not found or not in failed state.");
    }
    return c.json({ ok: true, job_id: jobId });
  });

  return router;
}
