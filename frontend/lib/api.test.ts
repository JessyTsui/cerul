import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiKeys,
  billing,
  fetchWithAuth,
  getApiErrorMessage,
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

  it("parses FastAPI detail errors for dashboard endpoints", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "Stripe customer not found for this user.",
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(fetchWithAuth("/dashboard/billing/portal")).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        status: 404,
        message: "Stripe customer not found for this user.",
      }),
    );
  });

  it("returns actionable guidance for network failures", () => {
    expect(getApiErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "NEXT_PUBLIC_API_BASE_URL",
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
            rate_limit_per_sec: 12,
            has_stripe_customer: true,
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
      rateLimitPerSec: 12,
      hasStripeCustomer: true,
      dailyBreakdown: [
        {
          date: "2026-03-01",
          creditsUsed: 120,
          requestCount: 44,
        },
      ],
    });
  });

  it("filters malformed daily usage entries instead of crashing", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          usage: {
            tier: "free",
            period_start: "2026-03-01",
            period_end: "2026-03-07",
            credits_limit: 1000,
            credits_used: 120,
            credits_remaining: 880,
            daily_breakdown: [
              {
                date: "2026-03-01",
                credits_used: 20,
                request_count: 5,
              },
              {
                date: 42,
                credits_used: "oops",
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

    await expect(usage.getMonthly()).resolves.toEqual(
      expect.objectContaining({
        hasStripeCustomer: false,
        dailyBreakdown: [
          {
            date: "2026-03-01",
            creditsUsed: 20,
            requestCount: 5,
          },
        ],
      }),
    );
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

  it("normalizes portal redirect urls", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          portal_url: "https://billing.example/portal",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(billing.createPortal()).resolves.toEqual({
      url: "https://billing.example/portal",
    });
  });
});
