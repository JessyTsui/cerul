import type { DatabaseClient } from "../db/client";

export class InsufficientCreditsError extends Error {
  constructor(message = "Monthly credit limit exhausted.") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export const DEFAULT_MONTHLY_CREDIT_LIMITS: Record<string, number> = {
  free: 1_000,
  pro: 10_000,
  builder: 10_000,
  enterprise: 100_000
};

export const TIER_KEY_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  builder: 5,
  enterprise: 25
};

const PAID_TIERS = new Set(["pro", "builder", "enterprise"]);

export function keyLimitForTier(tier: string | null | undefined): number {
  const normalized = (tier ?? "free").trim().toLowerCase();
  return TIER_KEY_LIMITS[normalized] ?? TIER_KEY_LIMITS.free;
}

export function monthlyCreditLimitForTier(tier: string | null | undefined): number {
  const normalized = (tier ?? "free").trim().toLowerCase();
  return DEFAULT_MONTHLY_CREDIT_LIMITS[normalized] ?? DEFAULT_MONTHLY_CREDIT_LIMITS.free;
}

export function isPaidTier(tier: string | null | undefined): boolean {
  return PAID_TIERS.has((tier ?? "free").trim().toLowerCase());
}

export function calculateCreditCost(searchType: string | null | undefined, includeAnswer: boolean): number {
  const normalized = (searchType ?? "unified").trim().toLowerCase();
  if (["broll", "knowledge", "unified"].includes(normalized)) {
    return includeAnswer ? 2 : 1;
  }
  throw new Error(`Unsupported search_type: ${searchType}`);
}

export function currentBillingPeriod(referenceDate?: Date): [string, string] {
  const today = referenceDate ?? new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0));
  return [periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)];
}

export async function deductCredits(
  db: DatabaseClient,
  userId: string,
  apiKeyId: string,
  requestId: string,
  searchType: string,
  includeAnswer: boolean
): Promise<number> {
  return db.transaction(async (tx) => {
    const creditsUsed = calculateCreditCost(searchType, includeAnswer);
    const [periodStart, periodEnd] = currentBillingPeriod();

    const existingUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        SELECT credits_used
        FROM usage_events
        WHERE request_id = $1
      `,
      requestId
    );
    if (existingUsage) {
      return Number(existingUsage.credits_used ?? 0);
    }

    const insertedUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        INSERT INTO usage_events (
            request_id,
            user_id,
            api_key_id,
            search_type,
            include_answer,
            credits_used
        )
        VALUES ($1, $2, $3::uuid, $4, $5, $6)
        ON CONFLICT (request_id) DO NOTHING
        RETURNING credits_used
      `,
      requestId,
      userId,
      apiKeyId,
      searchType,
      includeAnswer,
      creditsUsed
    );

    if (insertedUsage == null) {
      const usageRow = await tx.fetchrow<{ credits_used: number }>(
        `
          SELECT credits_used
          FROM usage_events
          WHERE request_id = $1
        `,
        requestId
      );
      return Number(usageRow?.credits_used ?? 0);
    }

    const monthlyUsage = await tx.fetchrow<{ credits_used: number }>(
      `
        INSERT INTO usage_monthly (
            user_id,
            period_start,
            period_end,
            credits_limit,
            credits_used,
            request_count
        )
        SELECT
            up.id,
            $2,
            $3,
            up.monthly_credit_limit,
            $4,
            1
        FROM user_profiles AS up
        WHERE up.id = $1
          AND up.monthly_credit_limit >= $4
        ON CONFLICT (user_id, period_start)
        DO UPDATE SET
            period_end = EXCLUDED.period_end,
            credits_limit = EXCLUDED.credits_limit,
            credits_used = usage_monthly.credits_used + EXCLUDED.credits_used,
            request_count = usage_monthly.request_count + EXCLUDED.request_count,
            updated_at = NOW()
        WHERE usage_monthly.credits_used + EXCLUDED.credits_used
            <= EXCLUDED.credits_limit
        RETURNING credits_used
      `,
      userId,
      periodStart,
      periodEnd,
      creditsUsed
    );

    if (monthlyUsage == null) {
      const profile = await tx.fetchrow(
        `
          SELECT monthly_credit_limit
          FROM user_profiles
          WHERE id = $1
        `,
        userId
      );
      if (profile == null) {
        throw new Error(`Unknown user profile for ${userId}`);
      }
      throw new InsufficientCreditsError();
    }

    return Number(insertedUsage.credits_used ?? 0);
  });
}

export async function refundCredits(db: DatabaseClient, requestId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const deletedUsage = await tx.fetchrow<{
      user_id: string;
      credits_used: number;
      occurred_at: string;
    }>(
      `
        DELETE FROM usage_events
        WHERE request_id = $1
        RETURNING user_id, credits_used, occurred_at
      `,
      requestId
    );
    if (deletedUsage == null) {
      return 0;
    }

    const occurredAt = new Date(String(deletedUsage.occurred_at));
    const [periodStart, periodEnd] = currentBillingPeriod(occurredAt);
    await tx.execute(
      `
        UPDATE usage_monthly
        SET
            credits_used = GREATEST(usage_monthly.credits_used - $4, 0),
            request_count = GREATEST(usage_monthly.request_count - 1, 0),
            updated_at = NOW()
        WHERE user_id = $1
          AND period_start = $2
          AND period_end = $3
      `,
      deletedUsage.user_id,
      periodStart,
      periodEnd,
      Number(deletedUsage.credits_used ?? 0)
    );
    return Number(deletedUsage.credits_used ?? 0);
  });
}

export async function fetchUsageSummary(db: DatabaseClient, userId: string): Promise<Record<string, unknown>> {
  const [periodStart, periodEnd] = currentBillingPeriod();
  const row = await db.fetchrow(
    `
      SELECT
          up.tier,
          up.monthly_credit_limit AS credits_limit,
          up.rate_limit_per_sec,
          COALESCE(um.credits_used, 0) AS credits_used
      FROM user_profiles AS up
      LEFT JOIN usage_monthly AS um
          ON um.user_id = up.id
          AND um.period_start = $2
          AND um.period_end = $3
      WHERE up.id = $1
    `,
    userId,
    periodStart,
    periodEnd
  );

  if (row == null) {
    throw new Error(`Unknown user profile for ${userId}`);
  }

  return {
    tier: row.tier,
    credits_limit: Number(row.credits_limit ?? 0),
    credits_used: Number(row.credits_used ?? 0),
    rate_limit_per_sec: Number(row.rate_limit_per_sec ?? 0),
    period_start: periodStart,
    period_end: periodEnd
  };
}

export function calculateCreditsRemaining(usageSummary: Record<string, unknown>): number {
  return Math.max(Number(usageSummary.credits_limit ?? 0) - Number(usageSummary.credits_used ?? 0), 0);
}

export async function countActiveApiKeys(db: DatabaseClient, userId: string): Promise<number> {
  const row = await db.fetchrow<{ active_count: number }>(
    `
      SELECT COUNT(*) AS active_count
      FROM api_keys
      WHERE user_id = $1 AND is_active = TRUE
    `,
    userId
  );
  return Number(row?.active_count ?? 0);
}
