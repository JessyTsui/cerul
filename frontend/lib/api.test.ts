import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiKeys,
  billing,
  fetchWithAuth,
  usage,
} from "./api";

describe("fetchWithAuth", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("adds credentials and JSON headers for object bodies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await fetchWithAuth<{ ok: boolean }>("/dashboard/api-keys", {
      method: "POST",
      body: {
        name: "primary",
      },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:9104/dashboard/api-keys",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ name: "primary" }),
      }),
    );
  });

  it("parses structured API errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "not_authenticated",
            message: "Session expired.",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(fetchWithAuth("/dashboard/usage/monthly")).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        status: 401,
        code: "not_authenticated",
        message: "Session expired.",
      }),
    );
  });
});

describe("dashboard API client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("normalizes wrapped API key list payloads", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          api_keys: [
            {
              id: "key_1",
              name: "Primary key",
              prefix: "cerul_sk_abcd",
              created_at: "2026-03-01T10:00:00Z",
              last_used_at: null,
              is_active: true,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(apiKeys.list()).resolves.toEqual([
      {
        id: "key_1",
        name: "Primary key",
        prefix: "cerul_sk_abcd",
        createdAt: "2026-03-01T10:00:00Z",
        lastUsedAt: null,
        isActive: true,
      },
    ]);
  });

  it("normalizes monthly usage envelopes", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          usage: {
            tier: "pro",
            period_start: "2026-03-01",
            period_end: "2026-03-07",
            credits_limit: 10000,
            credits_used: 2450,
            credits_remaining: 7550,
            request_count: 812,
            api_keys_active: 3,
            daily_breakdown: [
              {
                date: "2026-03-01",
                credits_used: 120,
                request_count: 44,
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(usage.getMonthly()).resolves.toEqual({
      tier: "pro",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-07",
      creditsLimit: 10000,
      creditsUsed: 2450,
      creditsRemaining: 7550,
      requestCount: 812,
      apiKeysActive: 3,
      rateLimitPerSec: null,
      dailyBreakdown: [
        {
          date: "2026-03-01",
          creditsUsed: 120,
          requestCount: 44,
        },
      ],
    });
  });

  it("normalizes billing redirect urls", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          checkout_url: "https://billing.example/checkout",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(billing.createCheckout()).resolves.toEqual({
      url: "https://billing.example/checkout",
    });
  });
});
