import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBackendApiBaseUrlMock } = vi.hoisted(() => ({
  getBackendApiBaseUrlMock: vi.fn(),
}));

vi.mock("@/lib/console-api", () => ({
  getBackendApiBaseUrl: getBackendApiBaseUrlMock,
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

describe("tracking proxy route", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    getBackendApiBaseUrlMock.mockReturnValue("http://127.0.0.1:8787");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("forwards tracking redirects to the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.youtube.com/watch?v=demo123&t=42",
          },
        }),
      ),
    );

    const request = new NextRequest("http://127.0.0.1:3001/v/abc123xy");
    const response = await GET(request, {
      params: Promise.resolve({
        shortId: "abc123xy",
      }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://www.youtube.com/watch?v=demo123&t=42",
    );

    const [target, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(target).toBeInstanceOf(URL);
    expect(String(target)).toBe("http://127.0.0.1:8787/v/abc123xy");
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "manual",
      }),
    );
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get("accept")).toBe("*/*");
  });

  it("forwards detail pages and preserves HTML bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>detail</html>", {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        }),
      ),
    );

    const request = new NextRequest("http://127.0.0.1:3001/v/abc123xy/detail");
    const response = await GET(request, {
      params: Promise.resolve({
        shortId: "abc123xy",
        path: ["detail"],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toBe("<html>detail</html>");

    const [target] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(target).toBeInstanceOf(URL);
    expect(String(target)).toBe("http://127.0.0.1:8787/v/abc123xy/detail");
  });

  it("rejects unsupported tracking suffixes", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const request = new NextRequest("http://127.0.0.1:3001/v/abc123xy/unknown");
    const response = await GET(request, {
      params: Promise.resolve({
        shortId: "abc123xy",
        path: ["unknown"],
      }),
    });

    expect(response.status).toBe(404);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("forwards browser context headers to the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://www.youtube.com/watch?v=demo123&t=42",
          },
        }),
      ),
    );

    const request = new NextRequest("http://127.0.0.1:3001/v/abc123xy", {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 test",
        referer: "http://127.0.0.1:3001/docs",
        "x-forwarded-for": "203.0.113.7",
      },
    });

    await GET(request, {
      params: Promise.resolve({
        shortId: "abc123xy",
      }),
    });

    const [, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect((init?.headers as Headers).get("accept")).toBe("text/html");
    expect((init?.headers as Headers).get("user-agent")).toBe("Mozilla/5.0 test");
    expect((init?.headers as Headers).get("referer")).toBe(
      "http://127.0.0.1:3001/docs",
    );
    expect((init?.headers as Headers).get("x-forwarded-for")).toBe("203.0.113.7");
  });
});
