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
      plan_code: String(usageSummary.plan_code ?? usageSummary.tier ?? ""),
      period_start: String(usageSummary.period_start),
      period_end: String(usageSummary.period_end),
      credits_limit: Number(usageSummary.credits_limit ?? 0),
      credits_used: Number(usageSummary.credits_used ?? 0),
      credits_remaining: calculateCreditsRemaining(usageSummary),
      wallet_balance: Number(usageSummary.wallet_balance ?? calculateCreditsRemaining(usageSummary)),
      credit_breakdown: usageSummary.credit_breakdown ?? {
        included_remaining: 0,
        topup_remaining: 0,
        bonus_remaining: 0
      },
      expiring_credits: Array.isArray(usageSummary.expiring_credits) ? usageSummary.expiring_credits : [],
      rate_limit_per_sec: Number(usageSummary.rate_limit_per_sec ?? 0),
      api_keys_active: apiKeysActive,
      billing_hold: Boolean(usageSummary.billing_hold)
    });
  });

  return router;
}
