import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminTrendChart } from "./admin-trend-chart";
import { SceneRouteSummary } from "./scene-route-summary";

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

describe("SceneRouteSummary", () => {
  it("renders compact scene route pills for running frame analysis", () => {
    const html = renderToStaticMarkup(
      <SceneRouteSummary
        artifacts={{
          current_route: "annotate",
          route_counts: {
            text_only: 3,
            embed_only: 1,
            annotate: 2,
          },
          total_annotation_frame_count: 4,
          extraction_time_ms: 4200,
          annotation_time_ms: 8100,
        }}
        status="running"
      />,
    );

    expect(html).toContain("Current route");
    expect(html).toContain("Annotate");
    expect(html).toContain("Text only 3");
    expect(html).toContain("Embed only 1");
    expect(html).toContain("Annotated frames 4");
    expect(html).toContain("Extract 4.2s");
    expect(html).toContain("Annotate 8.1s");
  });

  it("renders detailed route totals for completed steps", () => {
    const html = renderToStaticMarkup(
      <SceneRouteSummary
        artifacts={{
          current_route: "embed_only",
          route_counts: {
            text_only: 5,
            embed_only: 8,
            annotate: 2,
          },
          total_annotation_frame_count: 2,
          total_extraction_time_ms: 12200,
          total_dedup_time_ms: 900,
          total_filter_time_ms: 500,
          total_ocr_time_ms: 400,
          total_prepare_time_ms: 14000,
          total_annotation_time_ms: 61000,
        }}
        status="completed"
        variant="detail"
      />,
    );

    expect(html).toContain("Scene routing");
    expect(html).toContain("Last route");
    expect(html).toContain("Text only");
    expect(html).toContain("Embed only");
    expect(html).toContain("Annotated frames");
    expect(html).toContain("Extract");
    expect(html).toContain("12s");
    expect(html).toContain("Annotate");
    expect(html).toContain("1m 1s");
  });
});
