import { Hono } from "hono";

import type { DatabaseClient } from "../db/client";
import { apiKeyAuth } from "../middleware/auth";
import { UnifiedIndexService } from "../services/indexing";
import { apiError } from "../utils/http";
import { ensureJsonObject, parseBoolean, parseInteger } from "../utils/validation";

export function createIndexRouter(): any {
  const router = new Hono();

  router.post("/index", apiKeyAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      apiError(400, "Request body must be valid JSON.");
    }
    const payload = ensureJsonObject(rawPayload, "Request body must be a JSON object.");
    const url = String(payload.url ?? "").trim();
    if (!url) {
      apiError(400, "url is required.");
    }
    const force = parseBoolean(payload.force, "force", false);
    const service = new UnifiedIndexService(db, c.env);
    const response = await service.submit(url, force, auth);
    return c.json(response, 202);
  });

  router.get("/index", apiKeyAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    const page = parseInteger(c.req.query("page"), "page", 1);
    const perPage = parseInteger(c.req.query("per_page"), "per_page", 20);
    if (page < 1) {
      apiError(400, "page must be greater than or equal to 1.");
    }
    if (perPage < 1 || perPage > 100) {
      apiError(400, "per_page must be between 1 and 100.");
    }
    const service = new UnifiedIndexService(db, c.env);
    return c.json(await service.listVideos(auth, page, perPage));
  });

  router.get("/index/:videoId", apiKeyAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    const service = new UnifiedIndexService(db, c.env);
    return c.json(await service.getStatus(c.req.param("videoId"), auth));
  });

  router.delete("/index/:videoId", apiKeyAuth(), async (c: any) => {
    const db = c.get("db") as DatabaseClient;
    const auth = c.get("apiAuth");
    const service = new UnifiedIndexService(db, c.env);
    return c.json(await service.delete(c.req.param("videoId"), auth));
  });

  return router;
}
