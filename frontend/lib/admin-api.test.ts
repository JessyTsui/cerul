import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admin,
  normalizeAdminSummary,
  normalizeAdminTargetsResponse,
} from "./admin-api";

describe("normalizeAdminSummary", () => {
  it("normalizes nested admin summary payloads", () => {
    const normalized = normalizeAdminSummary({
      generated_at: "2026-03-14T10:00:00Z",
      window: {
        range_key: "7d",
        current_start: "2026-03-08T00:00:00Z",
        current_end: "2026-03-14T10:00:00Z",
        previous_start: "2026-03-01T14:00:00Z",
        previous_end: "2026-03-08T00:00:00Z",
      },
      metrics: {
        total_users: { current: 12, previous: 10, delta: 2 },
        new_users: { current: 4, previous: 3, delta: 1 },
        active_users: { current: 8, previous: 6, delta: 2 },
        requests: { current: 320, previous: 280, delta: 40, target: 300 },
        credits_used: { current: 810, previous: 700, delta: 110 },
        zero_result_rate: { current: 0.08, previous: 0.1, delta: -0.02 },
        indexed_assets: { current: 1200, previous: 1180, delta: 20 },
        indexed_segments: { current: 4500, previous: 4300, delta: 200 },
        pending_jobs: { current: 4, previous: 2, delta: 2 },
        failed_jobs: { current: 1, previous: 0, delta: 1 },
      },
      request_series: [
        {
          date: "2026-03-14",
          requests: 32,
          credits_used: 70,
          zero_result_queries: 3,
          broll_assets_added: 4,
          knowledge_videos_added: 1,
          knowledge_segments_added: 12,
          jobs_completed: 5,
          jobs_failed: 1,
          latency_p95_ms: 620,
        },
      ],
      content_series: [],
      ingestion_series: [],
      notices: [
        {
          tone: "warning",
          title: "Zero-result rate is elevated",
          description: "Review indexing freshness.",
        },
      ],
    });

    expect(normalized.window.rangeKey).toBe("7d");
    expect(normalized.metrics.requests.target).toBe(300);
    expect(normalized.requestSeries[0].latencyP95Ms).toBe(620);
    expect(normalized.notices[0].tone).toBe("warning");
  });
});

describe("admin targets client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("normalizes target responses and preserves actuals", () => {
    const normalized = normalizeAdminTargetsResponse({
      generated_at: "2026-03-14T10:00:00Z",
      window: {
        range_key: "7d",
        current_start: "2026-03-08T00:00:00Z",
        current_end: "2026-03-14T10:00:00Z",
        previous_start: "2026-03-01T14:00:00Z",
        previous_end: "2026-03-08T00:00:00Z",
      },
      targets: [
        {
          id: "target_1",
          metric_name: "requests_total",
          scope_type: "global",
          scope_key: "",
          range_key: "7d",
          comparison_mode: "at_least",
          target_value: 300,
          note: "Keep demand moving",
          updated_at: "2026-03-14T10:00:00Z",
          actual_value: 320,
          attainment_ratio: 1.06,
          target_gap: 20,
        },
      ],
    });

    expect(normalized.targets[0]).toEqual(
      expect.objectContaining({
        metricName: "requests_total",
        targetValue: 300,
        actualValue: 320,
      }),
    );
  });

  it("calls the admin summary endpoint with the selected range", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generated_at: "2026-03-14T10:00:00Z",
          window: {
            range_key: "today",
            current_start: "2026-03-14T00:00:00Z",
            current_end: "2026-03-14T10:00:00Z",
            previous_start: "2026-03-13T14:00:00Z",
            previous_end: "2026-03-14T00:00:00Z",
          },
          metrics: {
            total_users: { current: 12, previous: 10, delta: 2 },
            new_users: { current: 2, previous: 1, delta: 1 },
            active_users: { current: 6, previous: 4, delta: 2 },
            requests: { current: 32, previous: 24, delta: 8 },
            credits_used: { current: 70, previous: 56, delta: 14 },
            zero_result_rate: { current: 0.05, previous: 0.08, delta: -0.03 },
            indexed_assets: { current: 1200, previous: 1190, delta: 10 },
            indexed_segments: { current: 4500, previous: 4450, delta: 50 },
            pending_jobs: { current: 4, previous: 3, delta: 1 },
            failed_jobs: { current: 1, previous: 0, delta: 1 },
          },
          request_series: [],
          content_series: [],
          ingestion_series: [],
          notices: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await admin.getSummary("today");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/console/admin/summary?range=today",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });
});
