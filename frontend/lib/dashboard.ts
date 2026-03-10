import type { DashboardApiKey, DashboardMonthlyUsage } from "./api";

export type UsageChartPoint = {
  date: string;
  shortLabel: string;
  fullLabel: string;
  creditsUsed: number;
  requestCount: number;
};

type UsageTimelineOptions = {
  referenceDate?: Date | string;
};

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const SHORT_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function toValidDate(value: string): Date | null {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function toUtcDateKey(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = toValidDate(value);

  if (!date) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function enumerateUtcDays(startDate: string, endDate: string): string[] {
  const normalizedStart = toUtcDateKey(startDate);
  const normalizedEnd = toUtcDateKey(endDate);

  if (!normalizedStart || !normalizedEnd) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(`${normalizedStart}T00:00:00.000Z`);
  const end = new Date(`${normalizedEnd}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getReferenceDateKey(referenceDate?: Date | string): string | null {
  if (!referenceDate) {
    return new Date().toISOString().slice(0, 10);
  }

  if (referenceDate instanceof Date) {
    if (Number.isNaN(referenceDate.getTime())) {
      return null;
    }

    return referenceDate.toISOString().slice(0, 10);
  }

  return toUtcDateKey(referenceDate);
}

function getEffectivePeriodEnd(
  periodEnd: string,
  options?: UsageTimelineOptions,
): string | null {
  const normalizedPeriodEnd = toUtcDateKey(periodEnd);

  if (!normalizedPeriodEnd) {
    return null;
  }

  const referenceDateKey = getReferenceDateKey(options?.referenceDate);

  if (!referenceDateKey) {
    return normalizedPeriodEnd;
  }

  return normalizedPeriodEnd < referenceDateKey
    ? normalizedPeriodEnd
    : referenceDateKey;
}

export function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

export function formatDashboardDate(value: string): string {
  const date = toValidDate(value);

  return date ? DAY_LABEL_FORMATTER.format(date) : value;
}

export function formatDashboardDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never used";
  }

  const date = toValidDate(value);

  return date ? DATE_TIME_FORMATTER.format(date) : value;
}

export function formatBillingPeriod(
  periodStart: string,
  periodEnd: string,
): string {
  return `${formatDashboardDate(periodStart)} - ${formatDashboardDate(periodEnd)}`;
}

export function getTierLabel(tier: string): string {
  const normalizedTier = tier.toLowerCase();

  if (normalizedTier === "pro") {
    return "Pro";
  }

  if (normalizedTier === "enterprise") {
    return "Enterprise";
  }

  return "Free";
}

export function getCreditsPercent(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export function buildUsageChartData(
  usage: Pick<DashboardMonthlyUsage, "periodStart" | "periodEnd" | "dailyBreakdown">,
  options?: UsageTimelineOptions,
): UsageChartPoint[] {
  const effectivePeriodEnd = getEffectivePeriodEnd(usage.periodEnd, options);

  if (!effectivePeriodEnd) {
    return [];
  }

  const usageByDate = new Map(
    usage.dailyBreakdown
      .map((entry) => {
        const dateKey = toUtcDateKey(entry.date);

        if (!dateKey) {
          return null;
        }

        return [
          dateKey,
          {
            creditsUsed: entry.creditsUsed,
            requestCount: entry.requestCount,
          },
        ] as const;
      })
      .filter((entry): entry is readonly [string, { creditsUsed: number; requestCount: number }] => entry !== null),
  );

  return enumerateUtcDays(usage.periodStart, effectivePeriodEnd).map((date) => {
    const values = usageByDate.get(date) ?? {
      creditsUsed: 0,
      requestCount: 0,
    };

    return {
      date,
      shortLabel: SHORT_DAY_LABEL_FORMATTER.format(new Date(`${date}T00:00:00.000Z`)),
      fullLabel: DAY_LABEL_FORMATTER.format(new Date(`${date}T00:00:00.000Z`)),
      creditsUsed: values.creditsUsed,
      requestCount: values.requestCount,
    };
  });
}

export function getRecentUsageChartData(
  usage: Pick<DashboardMonthlyUsage, "periodStart" | "periodEnd" | "dailyBreakdown">,
  days: number,
  options?: UsageTimelineOptions,
): UsageChartPoint[] {
  return buildUsageChartData(usage, options).slice(-days);
}

export function getAverageDailyCredits(
  usage: Pick<DashboardMonthlyUsage, "periodStart" | "periodEnd" | "dailyBreakdown">,
  options?: UsageTimelineOptions,
): number {
  const points = buildUsageChartData(usage, options);

  if (points.length === 0) {
    return 0;
  }

  const total = points.reduce((sum, point) => sum + point.creditsUsed, 0);
  return Math.round(total / points.length);
}

export function getApiKeyStatusLabel(apiKey: DashboardApiKey): string {
  return apiKey.isActive ? "Active" : "Revoked";
}
