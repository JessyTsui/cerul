import type { Context } from "hono";

import { ApiError, buildPublicErrorPayload, isPublicApiPath, jsonResponse, normalizeErrorMessage } from "../utils/http";

export async function handleError(error: unknown, c: Context): Promise<Response> {
  const pathname = new URL(c.req.url).pathname;

  if (error instanceof ApiError) {
    const headers = new Headers(error.headers);
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

  if (isPublicApiPath(pathname)) {
    return jsonResponse(buildPublicErrorPayload(500, "Internal server error"), {
      status: 500
    });
  }

  return jsonResponse({ detail: "Internal server error" }, { status: 500 });
}

export function handleNotFound(c: Context): Response {
  const pathname = new URL(c.req.url).pathname;
  if (isPublicApiPath(pathname)) {
    return jsonResponse(buildPublicErrorPayload(404, "Not found"), { status: 404 });
  }
  return jsonResponse({ detail: "Not Found" }, { status: 404 });
}
