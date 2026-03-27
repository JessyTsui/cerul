import { Hono } from "hono";

import { apiKeyAuth } from "../middleware/auth";
import { calculateCreditsRemaining, countActiveApiKeys, fetchUsageSummary } from "../services/billing";
import type { DatabaseClient } from "../db/client";

export function createUsageRouter(): any {
  const router = new Hono();

  router.get("/usage", apiKeyAuth(), async (c: any) => {
    const auth = c.get("apiAuth");
    const db = c.get("db") as DatabaseClient;
    const usageSummary = await fetchUsageSummary(db, auth.userId);
    const apiKeysActive = await countActiveApiKeys(db, auth.userId);

    return c.json({
      tier: String(usageSummary.tier ?? ""),
      period_start: String(usageSummary.period_start),
      period_end: String(usageSummary.period_end),
      credits_limit: Number(usageSummary.credits_limit ?? 0),
      credits_used: Number(usageSummary.credits_used ?? 0),
      credits_remaining: calculateCreditsRemaining(usageSummary),
      rate_limit_per_sec: Number(usageSummary.rate_limit_per_sec ?? 0),
      api_keys_active: apiKeysActive
    });
  });

  return router;
}
