import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admin,
  normalizeAdminIndexedVideos,
  normalizeAdminWorkerLive,
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

describe("normalizeAdminWorkerLive", () => {
  it("normalizes worker step durations, guidance, and logs", () => {
    const normalized = normalizeAdminWorkerLive({
      generated_at: "2026-03-22T15:30:00Z",
      queue: {
        pending: 0,
        running: 1,
        retrying: 0,
        completed: 2,
        failed: 0,
      },
      active_jobs: [
        {
          job_id: "job_1",
          track: "knowledge",
          status: "running",
          source: "youtube",
          video_id: "vid_1",
          title: "Demo run",
          started_at: "2026-03-22T15:20:00Z",
          created_at: "2026-03-22T15:19:00Z",
          last_activity_at: "2026-03-22T15:29:00Z",
          attempts: 1,
          max_attempts: 3,
          total_duration_ms: 540000,
          error_message: null,
          steps: [
            {
              step_name: "AnalyzeKnowledgeFramesStep",
              status: "running",
              artifacts: {
                scene_analysis_count: 1,
              },
              started_at: "2026-03-22T15:25:00Z",
              completed_at: null,
              updated_at: "2026-03-22T15:29:00Z",
              duration_ms: 240000,
              guidance: "Frame analysis may be waiting on Gemini.",
              logs: [
                {
                  at: "2026-03-22T15:25:30Z",
                  level: "info",
                  message: "Analyzing scene 1/4.",
                  details: {
                    scene_index: 0,
                  },
                },
              ],
              error_message: null,
            },
          ],
        },
      ],
      recent_completed: [
        {
          job_id: "job_done",
          video_id: "vid_done",
          title: "Completed demo",
          segment_count: 12,
          completed_at: "2026-03-22T15:28:00Z",
          total_duration_ms: 183000,
        },
      ],
      failed_jobs: [
        {
          job_id: "job_failed",
          track: "unified",
          status: "failed",
          source: "youtube",
          video_id: "vid_failed",
          title: "Failed demo",
          started_at: "2026-03-22T15:00:00Z",
          created_at: "2026-03-22T14:59:00Z",
          last_activity_at: "2026-03-22T15:10:00Z",
          attempts: 2,
          max_attempts: 3,
          total_duration_ms: 600000,
          error_message: "Gemini timeout",
          steps: [],
        },
      ],
      failed_jobs_total: 14,
      failed_jobs_limit: 5,
      failed_jobs_offset: 10,
    });

    expect(normalized.activeJobs[0].steps[0]).toEqual(
      expect.objectContaining({
        durationMs: 240000,
        guidance: "Frame analysis may be waiting on Gemini.",
        logs: [
          expect.objectContaining({
            level: "info",
            message: "Analyzing scene 1/4.",
          }),
        ],
      }),
    );
    expect(normalized.activeJobs[0].totalDurationMs).toBe(540000);
    expect(normalized.recentCompleted[0].totalDurationMs).toBe(183000);
    expect(normalized.failedJobs[0]).toEqual(
      expect.objectContaining({
        jobId: "job_failed",
        totalDurationMs: 600000,
        errorMessage: "Gemini timeout",
      }),
    );
    expect(normalized.failedJobsTotal).toBe(14);
    expect(normalized.failedJobsLimit).toBe(5);
    expect(normalized.failedJobsOffset).toBe(10);
  });

  it("builds failed job pagination params for worker live", async () => {
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generated_at: "2026-03-22T15:30:00Z",
          queue: { pending: 0, running: 0, retrying: 0, completed: 0, failed: 0 },
          active_jobs: [],
          recent_completed: [],
          failed_jobs: [],
          failed_jobs_total: 0,
          failed_jobs_limit: 5,
          failed_jobs_offset: 10,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ));

    await admin.getWorkerLive({ failedLimit: 5, failedOffset: 10 });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/console/admin/worker/live?failed_limit=5&failed_offset=10",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );

    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("calls the kill job endpoint", async () => {
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          job_id: "job_failed",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ));

    const result = await admin.killJob("job_failed");

    expect(result).toEqual({ ok: true, jobId: "job_failed" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/console/admin/jobs/job_failed/kill",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );

    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("normalizes indexed video admin payloads", () => {
    const normalized = normalizeAdminIndexedVideos({
      generated_at: "2026-03-23T10:00:00Z",
      videos: [
        {
          video_id: "vid_1",
          source: "youtube",
          source_video_id: "LCEmiRjPEtQ",
          title: "Andrej Karpathy: Software Is Changing (Again)",
          source_url: "https://www.youtube.com/watch?v=LCEmiRjPEtQ",
          video_url: "https://www.youtube.com/watch?v=LCEmiRjPEtQ",
          speaker: "Y Combinator",
          created_at: "2026-03-22T10:00:00Z",
          updated_at: "2026-03-23T10:00:00Z",
          units_created: 60,
          last_job_status: "completed",
          last_job_at: "2026-03-23T09:55:00Z",
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
      query: "Karpathy",
    });

    expect(normalized.total).toBe(1);
    expect(normalized.query).toBe("Karpathy");
    expect(normalized.videos[0]).toEqual(
      expect.objectContaining({
        videoId: "vid_1",
        sourceVideoId: "LCEmiRjPEtQ",
        unitsCreated: 60,
        lastJobStatus: "completed",
      }),
    );
  });

  it("calls the indexed videos endpoint with query and pagination", async () => {
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          generated_at: "2026-03-23T10:00:00Z",
          videos: [],
          total: 0,
          limit: 8,
          offset: 8,
          query: "Karpathy",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ));

    await admin.getIndexedVideos({ query: "Karpathy", limit: 8, offset: 8 });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/console/admin/videos?query=Karpathy&limit=8&offset=8",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );

    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("calls the delete indexed video endpoint", async () => {
    const originalFetch = global.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          video_id: "vid_1",
          title: "Delete Me Demo",
          units_deleted: 12,
          processing_jobs_deleted: 2,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ));

    const result = await admin.deleteIndexedVideo("vid_1");

    expect(result).toEqual({
      ok: true,
      videoId: "vid_1",
      title: "Delete Me Demo",
      unitsDeleted: 12,
      processingJobsDeleted: 2,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/console/admin/videos/vid_1",
      expect.objectContaining({
        credentials: "include",
        method: "DELETE",
      }),
    );

    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });
});
