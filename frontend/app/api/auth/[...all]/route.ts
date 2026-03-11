import { getAuthRouteHandlers } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getAuthRouteHandlers().GET(request);
}

export async function POST(request: Request) {
  return getAuthRouteHandlers().POST(request);
}
