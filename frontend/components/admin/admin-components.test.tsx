import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminTrendChart } from "./admin-trend-chart";

describe("AdminMetricCard", () => {
  it("renders labels, values, and target context", () => {
    const html = renderToStaticMarkup(
      <AdminMetricCard
        label="Requests"
        metric={{
          current: 320,
          previous: 280,
          delta: 40,
          deltaRatio: 0.14,
          target: 300,
          targetGap: 20,
          attainmentRatio: 1.06,
          comparisonMode: "at_least",
        }}
        note="Successful API requests recorded in usage events."
      />,
    );

    expect(html).toContain("Requests");
    expect(html).toContain("320");
    expect(html).toContain("target 300");
  });
});

describe("AdminTrendChart", () => {
  it("renders trend headers and values", () => {
    const html = renderToStaticMarkup(
      <AdminTrendChart
        title="Request volume"
        description="Track daily request traffic."
        data={[
          {
            date: "2026-03-14",
            shortLabel: "Mar 14",
            fullLabel: "Mar 14",
            primaryValue: 32,
            secondaryValue: 70,
          },
        ]}
        metricLabel="Requests"
        secondaryLabel="Credits"
      />,
    );

    expect(html).toContain("Request volume");
    expect(html).toContain("Requests");
    expect(html).toContain("Credits");
  });
});
