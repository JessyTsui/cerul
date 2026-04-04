import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { handleError } from "../middleware/errors";
import { ApiError } from "../utils/http";
import { createMcpRouter } from "./mcp";

const mocks = vi.hoisted(() => ({
  requireApiKeyContextFromToken: vi.fn(async () => ({
    userId: "user_test",
    apiKeyId: "key_test",
    tier: "free",
    creditsRemaining: 10,
    rateLimitPerSec: 1
  })),
  executePublicSearch: vi.fn(async ({ payload }: { payload: Record<string, unknown> }) => ({
    results: [
      {
        id: "unit_test_1",
        score: 0.92,
        rerank_score: payload.ranking_mode === "rerank" ? 0.97 : null,
        url: "https://cerul.ai/v/test123",
        title: "Sam Altman on AI video generation",
        snippet: "Current AI video generation tools are improving quickly.",
        transcript: "Current AI video generation tools are improving quickly.",
        thumbnail_url: "https://cdn.cerul.ai/thumbs/test123.jpg",
        keyframe_url: "https://cdn.cerul.ai/frames/test123.jpg",
        duration: 7200,
        source: "youtube",
        speaker: payload.filters && typeof payload.filters === "object" && "speaker" in payload.filters
          ? String(payload.filters.speaker ?? "")
          : null,
        timestamp_start: 1223,
        timestamp_end: 1345
      }
    ],
    answer: payload.include_answer ? "A grounded answer from Cerul." : null,
    credits_used: payload.include_answer ? 2 : 1,
    credits_remaining: 998,
    request_id: "req_9f8c1d5b2a9f7d1a8c4e6b02"
  })),
  buildPublicUsageResponse: vi.fn(async () => ({
    tier: "free",
    plan_code: "free",
    period_start: "2026-04-01",
    period_end: "2026-04-30",
    credits_limit: 0,
    credits_used: 2,
    credits_remaining: 8,
    wallet_balance: 8,
    credit_breakdown: {
      included_remaining: 0,
      bonus_remaining: 8,
      paid_remaining: 0
    },
    expiring_credits: [],
    rate_limit_per_sec: 1,
    api_keys_active: 1,
    billing_hold: false,
    daily_free_remaining: 8,
    daily_free_limit: 10
  }))
}));

vi.mock("../middleware/auth", async () => {
  const actual = await vi.importActual<typeof import("../middleware/auth")>("../middleware/auth");
  return {
    ...actual,
    requireApiKeyContextFromToken: mocks.requireApiKeyContextFromToken
  };
});

vi.mock("../services/public-api", () => ({
  executePublicSearch: mocks.executePublicSearch,
  buildPublicUsageResponse: mocks.buildPublicUsageResponse
}));

function createTestApp() {
  const app = new Hono();
  app.use("*", async (c: any, next: () => Promise<void>) => {
    c.set("db", {});
    c.set("config", {
      public: {
        webBaseUrl: "https://cerul.ai"
      }
    });
    await next();
  });
  app.route("/", createMcpRouter());
  app.onError(handleError);
  return app;
}

function createAppFetch(app: Hono) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.toString() : String(input), init);
    return app.fetch(request);
  };
}

function extractTextToolPayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("MCP call result did not contain content.");
  }

  const textBlock = result.content.find(
    (item: unknown): item is { type: "text"; text: string } =>
      !!item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
  );

  if (!textBlock) {
    throw new Error("MCP call result did not contain a text block.");
  }

  return JSON.parse(textBlock.text) as Record<string, unknown>;
}

describe("createMcpRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 405 for GET /mcp", async () => {
    const response = await createTestApp().fetch(new Request("http://cerul.test/mcp"));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed"
      },
      id: null
    });
  });

  it("returns 405 for DELETE /mcp", async () => {
    const response = await createTestApp().fetch(
      new Request("http://cerul.test/mcp", { method: "DELETE" })
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed"
      },
      id: null
    });
  });

  it("returns a JSON-RPC auth error when apiKey is missing", async () => {
    const response = await createTestApp().fetch(
      new Request("http://cerul.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "apiKey query parameter is required"
      },
      id: null
    });
    expect(mocks.requireApiKeyContextFromToken).not.toHaveBeenCalled();
  });

  it("handles MCP initialize over POST when a valid apiKey query param is provided", async () => {
    const response = await createTestApp().fetch(
      new Request("http://cerul.test/mcp?apiKey=cerul_abcdefghijklmnopqrstuvwxyz123456", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "vitest",
              version: "1.0.0"
            }
          }
        })
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.text();
    expect(payload).toContain("cerul");
    expect(payload).toContain("serverInfo");
    expect(mocks.requireApiKeyContextFromToken).toHaveBeenCalledTimes(1);
  });

  it("keeps JSON-RPC error formatting when middleware fails before the MCP route", async () => {
    const app = new Hono();
    app.use("*", async () => {
      throw new ApiError(503, "Database unavailable.");
    });
    app.route("/", createMcpRouter());
    app.onError(handleError);

    const response = await app.fetch(
      new Request("http://cerul.test/mcp?apiKey=cerul_abcdefghijklmnopqrstuvwxyz123456", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Database unavailable"
      },
      id: null
    });
  });

  it("lists tools through a real MCP client connection", async () => {
    const app = createTestApp();
    const transport = new StreamableHTTPClientTransport(
      new URL("http://cerul.test/mcp?apiKey=cerul_abcdefghijklmnopqrstuvwxyz123456"),
      { fetch: createAppFetch(app) }
    );
    const client = new Client({
      name: "vitest-client",
      version: "1.0.0"
    });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name).sort();

      expect(toolNames).toEqual(["cerul_search", "cerul_usage"]);
      expect(result.tools.find((tool) => tool.name === "cerul_search")?.description).toContain("Search indexed videos");
    } finally {
      await transport.close();
    }
  });

  it("calls cerul_usage through the MCP client", async () => {
    const app = createTestApp();
    const transport = new StreamableHTTPClientTransport(
      new URL("http://cerul.test/mcp?apiKey=cerul_abcdefghijklmnopqrstuvwxyz123456"),
      { fetch: createAppFetch(app) }
    );
    const client = new Client({
      name: "vitest-client",
      version: "1.0.0"
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "cerul_usage",
        arguments: {}
      });

      const payload = extractTextToolPayload(result);

      expect(payload.credits_remaining).toBe(8);
      expect(payload.api_keys_active).toBe(1);
      expect(mocks.buildPublicUsageResponse).toHaveBeenCalledTimes(1);
    } finally {
      await transport.close();
    }
  });

  it("calls cerul_search through the MCP client with flattened tool args", async () => {
    const app = createTestApp();
    const transport = new StreamableHTTPClientTransport(
      new URL("http://cerul.test/mcp?apiKey=cerul_abcdefghijklmnopqrstuvwxyz123456"),
      { fetch: createAppFetch(app) }
    );
    const client = new Client({
      name: "vitest-client",
      version: "1.0.0"
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "cerul_search",
        arguments: {
          query: "Sam Altman on AI video tools",
          max_results: 3,
          ranking_mode: "rerank",
          include_answer: true,
          speaker: "Sam Altman",
          published_after: "2024-01-01",
          min_duration: 60,
          max_duration: 7200,
          source: "youtube"
        }
      });

      const payload = extractTextToolPayload(result);

      expect(payload.results).toHaveLength(1);
      expect(payload.answer).toBe("A grounded answer from Cerul.");
      expect(payload.credits_used).toBe(2);
      expect(mocks.executePublicSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          searchSurface: "mcp",
          clientSource: "mcp",
          payload: {
            query: "Sam Altman on AI video tools",
            max_results: 3,
            ranking_mode: "rerank",
            include_answer: true,
            include_summary: false,
            filters: {
              speaker: "Sam Altman",
              published_after: "2024-01-01",
              min_duration: 60,
              max_duration: 7200,
              source: "youtube"
            }
          }
        })
      );
    } finally {
      await transport.close();
    }
  });
});
