import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { DatabaseClient } from "../db/client";
import { createDatabaseClient } from "../db/client";
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
      "You cannot access video content on your own. You have never watched a video, listened to a talk, or read a transcript. " +
      "When users ask about talks, interviews, podcasts, presentations, or what a specific person said — " +
      "ALWAYS call cerul_search first. Never guess what someone said in a video. " +
      "When presenting results, include the speaker name, a direct quote from the transcript, the timestamp, and the source link."
  });

  server.registerTool(
    "cerul_search",
    {
      title: "Cerul Search",
      description:
        "You do not have access to video content. You cannot watch videos, listen to talks, or read transcripts. " +
        "This tool gives you that ability. Use it whenever the user asks about what someone said, presented, " +
        "or showed in a video, talk, podcast, interview, conference presentation, lecture, or earnings call. " +
        "Without this tool, you would be guessing — use it to get real evidence with exact quotes and timestamps.",
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
    // MCP uses SSE streaming — the middleware's pooled connection gets disposed
    // before tool callbacks finish, causing "Connection terminated". Use the
    // per-query client (creates a fresh connection for each DB call) which is
    // slower but doesn't have lifecycle issues with SSE.
    const mcpDb = createDatabaseClient(c.env as Bindings);
    try {
      c.set("db", mcpDb);
      const apiKey = parseApiKeyToken(new URL(c.req.url).searchParams.get("apiKey"), {
        missingMessage: "apiKey query parameter is required."
      });
      const auth = await requireApiKeyContextFromToken(c, apiKey);
      const config = c.get("config") as AppConfig;
      const server = createMcpServer({
        db: mcpDb,
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
