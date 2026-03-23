import { NextResponse, type NextRequest } from "next/server";
import { getBackendApiBaseUrl } from "@/lib/console-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params?: Promise<{
    shortId?: string;
    path?: string[];
  }>;
};

function buildUpstreamUrl(input: {
  backendApiBaseUrl: string;
  shortId: string;
  suffix: string;
  search: string;
}): URL {
  const normalizedBaseUrl = input.backendApiBaseUrl.endsWith("/")
    ? input.backendApiBaseUrl
    : `${input.backendApiBaseUrl}/`;
  const relativePath = `v/${input.shortId}${input.suffix}`.replace(/^\/+/, "");

  return new URL(`${relativePath}${input.search}`, normalizedBaseUrl);
}

function resolveSuffix(pathSegments: string[] | undefined): string | null {
  if (!pathSegments || pathSegments.length === 0) {
    return "";
  }

  if (pathSegments.length !== 1) {
    return null;
  }

  const [segment] = pathSegments;
  if (segment !== "detail" && segment !== "go") {
    return null;
  }

  return `/${segment}`;
}

async function proxyTrackingRequest(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const params = await context.params;
  const shortId = params?.shortId?.trim();
  const suffix = resolveSuffix(params?.path);

  if (!shortId || suffix === null) {
    return NextResponse.json(
      { detail: "Tracking link not found." },
      { status: 404 },
    );
  }

  const upstreamUrl = buildUpstreamUrl({
    backendApiBaseUrl: getBackendApiBaseUrl(),
    shortId,
    suffix,
    search: request.nextUrl.search,
  });

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        accept: request.headers.get("accept") ?? "*/*",
      },
      cache: "no-store",
      redirect: "manual",
    });

    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    const location = response.headers.get("location");

    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }

    if (location) {
      responseHeaders.set("location", location);
    }

    responseHeaders.set("cache-control", "no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { detail: "Tracking proxy could not reach the backend." },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyTrackingRequest(request, context);
}
