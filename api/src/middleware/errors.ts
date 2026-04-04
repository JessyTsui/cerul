import type { Context } from "hono";

import {
  ApiError,
  buildJsonRpcErrorResponse,
  buildPublicErrorPayload,
  isMcpPath,
  isPublicApiPath,
  jsonResponse,
  normalizeErrorMessage
} from "../utils/http";

export async function handleError(error: unknown, c: Context): Promise<Response> {
  const pathname = new URL(c.req.url).pathname;

  if (error instanceof ApiError) {
    const headers = new Headers(error.headers);
    if (isMcpPath(pathname)) {
      return buildJsonRpcErrorResponse(error.status, error.message, -32000, headers);
    }
    if (isPublicApiPath(pathname)) {
      return jsonResponse(buildPublicErrorPayload(error.status, error.message, error.code), {
        status: error.status,
        headers
      });
    }

    return jsonResponse(
      { detail: normalizeErrorMessage(error.message) },
      { status: error.status, headers }
    );
  }

  console.error("[api] Unhandled error:", {
    pathname,
    error
  });

  if (isMcpPath(pathname)) {
    return buildJsonRpcErrorResponse(500, "Internal server error");
  }

  if (isPublicApiPath(pathname)) {
    return jsonResponse(buildPublicErrorPayload(500, "Internal server error"), {
      status: 500
    });
  }

  return jsonResponse({ detail: "Internal server error" }, { status: 500 });
}

export function handleNotFound(c: Context): Response {
  const pathname = new URL(c.req.url).pathname;
  if (isMcpPath(pathname)) {
    return buildJsonRpcErrorResponse(404, "Not found");
  }
  if (isPublicApiPath(pathname)) {
    return jsonResponse(buildPublicErrorPayload(404, "Not found"), { status: 404 });
  }
  return jsonResponse({ detail: "Not Found" }, { status: 404 });
}
