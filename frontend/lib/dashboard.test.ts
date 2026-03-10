import { describe, expect, it } from "vitest";
import {
  buildUsageChartData,
  formatBillingPeriod,
  getAverageDailyCredits,
  getCreditsPercent,
  getTierLabel,
} from "./dashboard";

describe("buildUsageChartData", () => {
  it("fills missing days inside the billing period", () => {
    const points = buildUsageChartData({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-04",
      dailyBreakdown: [
        {
          date: "2026-03-01",
          creditsUsed: 12,
          requestCount: 4,
        },
        {
          date: "2026-03-03",
          creditsUsed: 7,
          requestCount: 2,
        },
      ],
    });

    expect(points).toEqual([
      {
        date: "2026-03-01",
        shortLabel: "3/1",
        fullLabel: "Mar 1",
        creditsUsed: 12,
        requestCount: 4,
      },
      {
        date: "2026-03-02",
        shortLabel: "3/2",
        fullLabel: "Mar 2",
        creditsUsed: 0,
        requestCount: 0,
      },
      {
        date: "2026-03-03",
        shortLabel: "3/3",
        fullLabel: "Mar 3",
        creditsUsed: 7,
        requestCount: 2,
      },
      {
        date: "2026-03-04",
        shortLabel: "3/4",
        fullLabel: "Mar 4",
        creditsUsed: 0,
        requestCount: 0,
      },
    ]);
  });
});

describe("dashboard helpers", () => {
  it("computes a bounded credit percentage", () => {
    expect(getCreditsPercent(75, 100)).toBe(75);
    expect(getCreditsPercent(220, 100)).toBe(100);
    expect(getCreditsPercent(10, 0)).toBe(0);
  });

  it("formats billing periods for dashboard copy", () => {
    expect(formatBillingPeriod("2026-03-01", "2026-03-31")).toBe(
      "Mar 1 - Mar 31",
    );
  });

  it("maps known plan labels", () => {
    expect(getTierLabel("free")).toBe("Free");
    expect(getTierLabel("pro")).toBe("Pro");
    expect(getTierLabel("enterprise")).toBe("Enterprise");
  });

  it("averages credits across the entire period", () => {
    expect(
      getAverageDailyCredits({
        periodStart: "2026-03-01",
        periodEnd: "2026-03-03",
        dailyBreakdown: [
          {
            date: "2026-03-01",
            creditsUsed: 12,
            requestCount: 4,
          },
          {
            date: "2026-03-03",
            creditsUsed: 6,
            requestCount: 2,
          },
        ],
      }),
    ).toBe(6);
  });
});
