import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { DatabaseClient } from "../db/client";
import { parseApiKeyToken, requireApiKeyContextFromToken } from "../middleware/auth";
import { executePublicSearch, buildPublicUsageResponse } from "../services/public-api";
import type { AppConfig, Bindings, SearchRequest } from "../types";
import { ApiError, buildJsonRpcErrorResponse, normalizeErrorCode, normalizeErrorMessage } from "../utils/http";

function buildToolErrorResult(error: unknown) {
  if (error instanceof ApiError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: {
                code: error.code ?? normalizeErrorCode(error.status),
                message: normalizeErrorMessage(error.message),
                status: error.status
              }
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: {
              code: "api_error",
              message: error instanceof Error ? error.message : "Internal server error"
            }
          },
          null,
          2
        )
      }
    ],
    isError: true
  };
}

function buildSearchPayload(args: {
  query: string;
  max_results?: number;
  ranking_mode?: "embedding" | "rerank";
  include_answer?: boolean;
  speaker?: string;
  published_after?: string;
  min_duration?: number;
  max_duration?: number;
  source?: string;
}): SearchRequest {
  const filters = {
    ...(args.speaker ? { speaker: args.speaker } : {}),
    ...(args.published_after ? { published_after: args.published_after } : {}),
    ...(args.min_duration != null ? { min_duration: args.min_duration } : {}),
    ...(args.max_duration != null ? { max_duration: args.max_duration } : {}),
    ...(args.source ? { source: args.source } : {})
  };

  return {
    query: args.query,
    max_results: args.max_results ?? 5,
    ranking_mode: args.ranking_mode ?? "embedding",
    include_answer: args.include_answer ?? false,
    include_summary: false,
    ...(Object.keys(filters).length > 0 ? { filters } : {})
  };
}

function createMcpServer(input: {
  db: DatabaseClient;
  env: Bindings;
  config: AppConfig;
  auth: Awaited<ReturnType<typeof requireApiKeyContextFromToken>>;
}): McpServer {
  const server = new McpServer({
    name: "cerul",
    version: "1.0.0",
    instructions:
      "You have access to Cerul, a video search engine that indexes tech talks, podcasts, conference presentations, and earnings calls. " +
      "ALWAYS use the cerul_search tool instead of answering from general knowledge when the user asks about: " +
      "what someone said in a talk or interview, AI topics discussed in videos, conference presentations, " +
      "podcast discussions, specific speakers (Sam Altman, Jensen Huang, Dario Amodei, etc.), " +
      "or any question that could be answered with evidence from video content. " +
      "Use cerul_search FIRST, then supplement with your own knowledge if needed. " +
      "Do not guess what someone said — search for it."
  });

  server.registerTool(
    "cerul_search",
    {
      title: "Cerul Search",
      description:
        "Search what people said, showed, or presented in videos. Use this tool whenever the user asks about talks, interviews, podcasts, conference presentations, lectures, demos, or earnings calls. Also use it when the user wants to know what a specific person (e.g. Sam Altman, Jensen Huang, Dario Amodei) has said about a topic, needs evidence or citations from video sources, or asks questions that could be answered by searching tech talks and presentations. Returns timestamped transcript segments with source URLs. Always prefer this over guessing from general knowledge when video evidence exists.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(400)
          .describe("Natural language search query. Must contain at least one non-whitespace character."),
        max_results: z.number().int().min(1).max(50).optional().describe("Number of results to return. Defaults to 5 for MCP."),
        ranking_mode: z
          .enum(["embedding", "rerank"])
          .optional()
          .describe("embedding for vector similarity, rerank for LLM-based reranking."),
        include_answer: z
          .boolean()
          .optional()
          .describe("Generate an AI summary grounded in the matched evidence. Costs 2 credits instead of 1."),
        speaker: z.string().optional().describe("Filter results by speaker name."),
        published_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Filter videos published after this date (YYYY-MM-DD)."),
        min_duration: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Minimum video duration in whole seconds."),
        max_duration: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Maximum video duration in whole seconds."),
        source: z.string().optional().describe('Filter by video source (for example "youtube").')
      }
    },
    async (args) => {
      try {
        const result = await executePublicSearch({
          db: input.db,
          env: input.env,
          config: input.config,
          auth: input.auth,
          payload: buildSearchPayload(args),
          searchSurface: "mcp",
          clientSource: "mcp"
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return buildToolErrorResult(error);
      }
    }
  );

  server.registerTool(
    "cerul_usage",
    {
      title: "Cerul Usage",
      description: "Check credit balance, billing period, wallet breakdown, daily free allowance, and rate limits.",
      inputSchema: {}
    },
    async () => {
      try {
        const result = await buildPublicUsageResponse(input.db, input.auth);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return buildToolErrorResult(error);
      }
    }
  );

  return server;
}

export function createMcpRouter(): Hono {
  const router = new Hono();

  router.post("/mcp", async (c: any) => {
    try {
      const apiKey = parseApiKeyToken(new URL(c.req.url).searchParams.get("apiKey"), {
        missingMessage: "apiKey query parameter is required."
      });
      const auth = await requireApiKeyContextFromToken(c, apiKey);
      const db = c.get("db") as DatabaseClient;
      const config = c.get("config") as AppConfig;
      const server = createMcpServer({
        db,
        env: c.env as Bindings,
        config,
        auth
      });
      const transport = new StreamableHTTPTransport();

      await server.connect(transport);
      return await transport.handleRequest(c);
    } catch (error) {
      if (error instanceof HTTPException) {
        return error.getResponse();
      }
      if (error instanceof ApiError) {
        return buildJsonRpcErrorResponse(
          error.status,
          error.message,
          -32000,
          error.headers ? new Headers(error.headers) : undefined
        );
      }

      console.error("[mcp] Unhandled error:", error);
      return buildJsonRpcErrorResponse(500, "Internal server error");
    }
  });

  router.get("/mcp", () => buildJsonRpcErrorResponse(405, "Method not allowed."));
  router.delete("/mcp", () => buildJsonRpcErrorResponse(405, "Method not allowed."));

  return router;
}
