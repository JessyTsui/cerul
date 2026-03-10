import type { DashboardApiKey, DashboardMonthlyUsage } from "./api";

export type UsageChartPoint = {
  date: string;
  shortLabel: string;
  fullLabel: string;
  creditsUsed: number;
  requestCount: number;
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

function toUtcDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date(value).toISOString().slice(0, 10);
}

function enumerateUtcDays(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${toUtcDateKey(startDate)}T00:00:00.000Z`);
  const end = new Date(`${toUtcDateKey(endDate)}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

export function formatDashboardDate(value: string): string {
  return DAY_LABEL_FORMATTER.format(new Date(value));
}

export function formatDashboardDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never used";
  }

  return DATE_TIME_FORMATTER.format(new Date(value));
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
): UsageChartPoint[] {
  const usageByDate = new Map(
    usage.dailyBreakdown.map((entry) => [
      toUtcDateKey(entry.date),
      {
        creditsUsed: entry.creditsUsed,
        requestCount: entry.requestCount,
      },
    ]),
  );

  return enumerateUtcDays(usage.periodStart, usage.periodEnd).map((date) => {
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
): UsageChartPoint[] {
  return buildUsageChartData(usage).slice(-days);
}

export function getAverageDailyCredits(
  usage: Pick<DashboardMonthlyUsage, "periodStart" | "periodEnd" | "dailyBreakdown">,
): number {
  const points = buildUsageChartData(usage);

  if (points.length === 0) {
    return 0;
  }

  const total = points.reduce((sum, point) => sum + point.creditsUsed, 0);
  return Math.round(total / points.length);
}

export function getApiKeyStatusLabel(apiKey: DashboardApiKey): string {
  return apiKey.isActive ? "Active" : "Revoked";
}
