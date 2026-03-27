import type { ErrorResponse } from "../types";

export class ApiError extends Error {
  status: number;
  code?: string;
  headers?: Record<string, string>;

  constructor(status: number, message: string, options?: { code?: string; headers?: Record<string, string> }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options?.code;
    this.headers = options?.headers;
  }
}

export function apiError(status: number, message: string, options?: { code?: string; headers?: Record<string, string> }): never {
  throw new ApiError(status, message, options);
}

export function isPublicApiPath(pathname: string): boolean {
  return pathname.startsWith("/v1");
}

export function normalizeErrorCode(status: number): string {
  return {
    400: "invalid_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    422: "invalid_request",
    429: "rate_limited"
  }[status] ?? "api_error";
}

export function normalizeErrorMessage(message: unknown): string {
  const normalized = String(message ?? "Unknown error").trim();
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

export function buildPublicErrorPayload(status: number, message: unknown, explicitCode?: string): ErrorResponse {
  return {
    error: {
      code: explicitCode ?? normalizeErrorCode(status),
      message: normalizeErrorMessage(message)
    }
  };
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function emptyResponse(status = 204, init?: ResponseInit): Response {
  return new Response(null, { ...init, status });
}
