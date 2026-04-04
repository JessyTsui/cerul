import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "../db/client";
import { handleError } from "../middleware/errors";
import { createAdminRouter } from "./admin";
import {
  fetchAdminAnalyticsContent,
  fetchAdminAnalyticsFeedback,
  fetchAdminAnalyticsOverview,
} from "../services/admin-analytics";

vi.mock("../middleware/auth", () => ({
  sessionAuth: () => async (_c: any, next: () => Promise<void>) => {
    await next();
  },
  adminAuth: () => async (_c: any, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../services/admin", () => ({
  createSource: vi.fn(),
  createSourceFromUrl: vi.fn(),
  deleteIndexedVideoData: vi.fn(),
  deleteSource: vi.fn(),
  fetchIndexedVideos: vi.fn(),
  fetchSources: vi.fn(),
  fetchSourcesAnalytics: vi.fn(),
  fetchSourcesRecentVideos: vi.fn(),
  fetchWorkerLive: vi.fn(),
  fetchWorkerNodes: vi.fn(),
  getVideoJobStatus: vi.fn(),
  killJob: vi.fn(),
  retryJob: vi.fn(),
  submitVideo: vi.fn(),
  syncSource: vi.fn(),
  triggerYoutubeSearch: vi.fn(),
  updateSource: vi.fn(),
}));

vi.mock("../services/admin-summary", () => ({
  deleteTarget: vi.fn(),
  fetchAdminSummary: vi.fn(),
  fetchContentSummary: vi.fn(),
  fetchWorkersSummary: vi.fn(),
  fetchRequestsSummary: vi.fn(),
  fetchTargetsSummary: vi.fn(),
  fetchUsersSummary: vi.fn(),
  upsertTargets: vi.fn(),
}));

vi.mock("../services/admin-analytics", () => ({
  fetchAdminAnalyticsOverview: vi.fn(),
  fetchAdminAnalyticsContent: vi.fn(),
  fetchAdminAnalyticsCreators: vi.fn(),
  fetchAdminAnalyticsSearchQuality: vi.fn(),
  fetchAdminAnalyticsFeedback: vi.fn(),
  normalizeAnalyticsSearchSurface: vi.fn((value: string | null | undefined) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized !== "api" && normalized !== "mcp" && normalized !== "playground") {
      throw new Error("search_surface must be one of: api, mcp, playground.");
    }
    return normalized;
  }),
}));

function createTestApp(db: DatabaseClient) {
  const app = new Hono();
  app.use("*", async (c: any, next: () => Promise<void>) => {
    c.set("db", db);
    await next();
  });
  app.route("/admin", createAdminRouter());
  app.onError(handleError);
  return app;
}

describe("createAdminRouter analytics routes", () => {
  const db = {} as DatabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overview analytics and forwards parsed range and surface", async () => {
    vi.mocked(fetchAdminAnalyticsOverview).mockResolvedValueOnce({
      ok: true,
      surface: "api",
    } as Record<string, unknown>);

    const response = await createTestApp(db).fetch(
      new Request("http://cerul.test/admin/analytics/overview?range=7d&surface=api"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      surface: "api",
    });
    expect(fetchAdminAnalyticsOverview).toHaveBeenCalledWith(db, {
      rangeKey: "7d",
      searchSurface: "api",
    });
  });

  it("passes null surface when no analytics surface filter is provided", async () => {
    vi.mocked(fetchAdminAnalyticsContent).mockResolvedValueOnce({
      ok: true,
      surface: null,
    } as Record<string, unknown>);

    const response = await createTestApp(db).fetch(
      new Request("http://cerul.test/admin/analytics/content?range=today"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      surface: null,
    });
    expect(fetchAdminAnalyticsContent).toHaveBeenCalledWith(db, {
      rangeKey: "today",
      searchSurface: null,
    });
  });

  it("keeps playground feedback analytics routable with the playground surface", async () => {
    vi.mocked(fetchAdminAnalyticsFeedback).mockResolvedValueOnce({
      notice: { title: "Playground-only feedback" },
    } as Record<string, unknown>);

    const response = await createTestApp(db).fetch(
      new Request("http://cerul.test/admin/analytics/feedback?range=30d&surface=playground"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      notice: { title: "Playground-only feedback" },
    });
    expect(fetchAdminAnalyticsFeedback).toHaveBeenCalledWith(db, {
      rangeKey: "30d",
      searchSurface: "playground",
    });
  });

  it("rejects unsupported analytics surfaces with a 422 response", async () => {
    const response = await createTestApp(db).fetch(
      new Request("http://cerul.test/admin/analytics/overview?range=7d&surface=mobile"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      detail: "search_surface must be one of: api, mcp, playground",
    });
    expect(fetchAdminAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("rejects unsupported admin ranges before calling the analytics service", async () => {
    const response = await createTestApp(db).fetch(
      new Request("http://cerul.test/admin/analytics/content?range=90d"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      detail: "range must be one of: today, 7d, 30d",
    });
    expect(fetchAdminAnalyticsContent).not.toHaveBeenCalled();
  });
});
