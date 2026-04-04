import { Hono } from "hono";

import { apiKeyAuth } from "../middleware/auth";
import { buildPublicUsageResponse } from "../services/public-api";
import type { DatabaseClient } from "../db/client";

export function createUsageRouter(): any {
  const router = new Hono();

  router.get("/usage", apiKeyAuth(), async (c: any) => {
    const auth = c.get("apiAuth");
    const db = c.get("db") as DatabaseClient;
    return c.json(await buildPublicUsageResponse(db, auth));
  });

  return router;
}
