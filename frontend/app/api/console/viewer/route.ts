import { NextResponse } from "next/server";
import { getConsoleViewer } from "@/lib/console-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getConsoleViewer();

  if (!viewer) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    isAdmin: viewer.isAdmin,
  });
}
