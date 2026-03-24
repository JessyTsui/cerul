import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSessionUncached } from "@/lib/auth-server";
import {
  getBackendApiBaseUrl,
  isConsolePath,
} from "@/lib/console-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DEV_AUTH_SECRET =
  "cerul-local-better-auth-secret-for-development-only";
const SESSION_PROXY_USER_ID_HEADER = "x-cerul-session-user-id";
const SESSION_PROXY_EMAIL_HEADER = "x-cerul-session-user-email";
const SESSION_PROXY_TIMESTAMP_HEADER = "x-cerul-session-timestamp";
const SESSION_PROXY_SIGNATURE_HEADER = "x-cerul-session-signature";

type RouteContext = {
  params?: Promise<{
    path?: string[];
  }>;
};

function buildForwardPath(pathSegments: string[] | undefined): string {
  return `/${(pathSegments ?? []).join("/")}`.replace(/\/{2,}/g, "/");
}

function buildUpstreamUrl(input: {
  backendApiBaseUrl: string;
  forwardPath: string;
  search: string;
}): URL {
  const normalizedBaseUrl = input.backendApiBaseUrl.endsWith("/")
    ? input.backendApiBaseUrl
    : `${input.backendApiBaseUrl}/`;
  const relativePath = input.forwardPath.replace(/^\/+/, "");

  return new URL(`${relativePath}${input.search}`, normalizedBaseUrl);
}

function canIncludeBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function readRequestBody(request: NextRequest): Promise<ArrayBuffer | undefined> {
  const body = await request.arrayBuffer();
  return body.byteLength > 0 ? body : undefined;
}

function isProductionRuntime(): boolean {
  const currentEnvironment =
    process.env.CERUL_ENV?.trim().toLowerCase() ??
    process.env.NODE_ENV?.trim().toLowerCase() ??
    "";
  return currentEnvironment === "production";
}

function getAuthProxySecret(): string | null {
  const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (isProductionRuntime()) {
    return null;
  }

  return DEFAULT_DEV_AUTH_SECRET;
}

function buildSessionSignature(input: {
  userId: string;
  email: string | null | undefined;
  timestamp: string;
  method: string;
  path: string;
  secret: string;
}): string {
  const payload = [
    input.userId,
    input.email ?? "",
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
  ].join("\n");

  return createHmac("sha256", input.secret)
    .update(payload)
    .digest("hex");
}

async function proxyConsoleRequest(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const params = await context.params;
  const forwardPath = buildForwardPath(params?.path);

  if (!isConsolePath(forwardPath)) {
    return NextResponse.json(
      { detail: "Unsupported console API path." },
      { status: 404 },
    );
  }

  const upstreamUrl = buildUpstreamUrl({
    backendApiBaseUrl: getBackendApiBaseUrl(),
    forwardPath,
    search: request.nextUrl.search,
  });
  const session = await getServerSessionUncached();

  if (!session?.user?.id) {
    return NextResponse.json(
      { detail: "Missing authenticated session." },
      { status: 401 },
    );
  }

  const authProxySecret = getAuthProxySecret();

  if (!authProxySecret) {
    return NextResponse.json(
      { detail: "Console auth proxy is not configured." },
      { status: 503 },
    );
  }

  const headers = new Headers();

  for (const headerName of ["accept", "authorization", "content-type"]) {
    const headerValue = request.headers.get(headerName);
    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  headers.set(SESSION_PROXY_USER_ID_HEADER, session.user.id);

  if (session.user.email) {
    headers.set(SESSION_PROXY_EMAIL_HEADER, session.user.email);
  }

  headers.set(SESSION_PROXY_TIMESTAMP_HEADER, timestamp);
  headers.set(
    SESSION_PROXY_SIGNATURE_HEADER,
    buildSessionSignature({
      userId: session.user.id,
      email: session.user.email,
      timestamp,
      method: request.method,
      path: upstreamUrl.pathname,
      secret: authProxySecret,
    }),
  );

  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: canIncludeBody(request.method)
        ? await readRequestBody(request)
        : undefined,
      cache: "no-store",
      redirect: "manual",
    });

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");

    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }

    responseHeaders.set("cache-control", "no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { detail: "Console API proxy could not reach the backend." },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyConsoleRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyConsoleRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyConsoleRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyConsoleRequest(request, context);
}
