import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const {
  getServerSessionUncachedMock,
  getBackendApiBaseUrlMock,
  isConsolePathMock,
} = vi.hoisted(() => ({
  getServerSessionUncachedMock: vi.fn(),
  getBackendApiBaseUrlMock: vi.fn(),
  isConsolePathMock: vi.fn(),
}));

vi.mock("@/lib/auth-server", () => ({
  getServerSessionUncached: getServerSessionUncachedMock,
}));

vi.mock("@/lib/console-api", () => ({
  getBackendApiBaseUrl: getBackendApiBaseUrlMock,
  isConsolePath: isConsolePathMock,
}));

import { NextRequest } from "next/server";
import { PUT } from "./route";

describe("console proxy route", () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      ),
    );

    getServerSessionUncachedMock.mockResolvedValue({
      user: {
        id: "user_123",
        email: "owner@example.com",
      },
    });
    getBackendApiBaseUrlMock.mockReturnValue("http://127.0.0.1:8000");
    isConsolePathMock.mockReturnValue(true);
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = originalSecret;
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("forwards PUT requests to backend console endpoints", async () => {
    const request = new NextRequest(
      "http://127.0.0.1:3000/api/console/admin/targets?range=7d",
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          cookie: "better-auth.session_token=test-session; theme=dark",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          maxRequestLatencyMs: 3000,
        }),
      },
    );

    const response = await PUT(request, {
      params: Promise.resolve({
        path: ["admin", "targets"],
      }),
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [target, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(target).toBeInstanceOf(URL);
    expect(String(target)).toBe("http://127.0.0.1:8000/admin/targets?range=7d");
    expect(init).toEqual(
      expect.objectContaining({
        method: "PUT",
        cache: "no-store",
        redirect: "manual",
        body: expect.any(ArrayBuffer),
        headers: expect.any(Headers),
      }),
    );

    const headers = init?.headers as Headers;
    expect(headers.get("cookie")).toBe(
      "better-auth.session_token=test-session; theme=dark",
    );
    expect(headers.get("x-cerul-session-user-id")).toBe("user_123");
    expect(headers.get("x-cerul-session-user-email")).toBe("owner@example.com");
    expect(headers.get("x-cerul-session-timestamp")).toBeTruthy();
    expect(headers.get("x-cerul-session-signature")).toBeTruthy();
  });

  it("preserves a backend API base path prefix", async () => {
    getBackendApiBaseUrlMock.mockReturnValue("http://127.0.0.1:8000/backend");

    const request = new NextRequest(
      "http://127.0.0.1:3000/api/console/admin/targets?range=7d",
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          maxRequestLatencyMs: 3000,
        }),
      },
    );

    const response = await PUT(request, {
      params: Promise.resolve({
        path: ["admin", "targets"],
      }),
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [target] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(target).toBeInstanceOf(URL);
    expect(String(target)).toBe(
      "http://127.0.0.1:8000/backend/admin/targets?range=7d",
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    const timestamp = headers.get("x-cerul-session-timestamp");

    expect(headers.get("x-cerul-session-signature")).toBe(
      createHmac("sha256", "test-secret")
        .update(
          [
            "user_123",
            "owner@example.com",
            timestamp,
            "PUT",
            "/backend/admin/targets",
          ].join("\n"),
        )
        .digest("hex"),
    );
  });
});
