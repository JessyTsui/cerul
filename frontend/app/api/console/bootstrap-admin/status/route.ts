import { NextResponse } from "next/server";
import { sql } from "kysely";
import { getAuthDatabase, withAuthDatabaseRecovery } from "@/lib/auth-db";
import { getServerSessionUncached } from "@/lib/auth-server";
import {
  getConfiguredAdminEmails,
  getConfiguredBootstrapAdminSecret,
} from "@/lib/console-settings";
import { getConsoleViewer } from "@/lib/console-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapReason =
  | "available"
  | "already_admin"
  | "disabled"
  | "managed_by_emails"
  | "admin_exists";

async function countStoredAdmins(): Promise<number> {
  const result = await withAuthDatabaseRecovery(() =>
    sql<{ count: number }>`
      SELECT COUNT(*)::int AS count
      FROM user_profiles
      WHERE console_role = 'admin'
    `.execute(getAuthDatabase()),
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function GET() {
  const session = await getServerSessionUncached();

  if (!session?.user?.id) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const viewer = await getConsoleViewer();

  if (viewer?.isAdmin) {
    return NextResponse.json({
      authenticated: true,
      eligible: false,
      reason: "already_admin" satisfies BootstrapReason,
    });
  }

  if (!getConfiguredBootstrapAdminSecret()) {
    return NextResponse.json({
      authenticated: true,
      eligible: false,
      reason: "disabled" satisfies BootstrapReason,
    });
  }

  if (getConfiguredAdminEmails().size > 0) {
    return NextResponse.json({
      authenticated: true,
      eligible: false,
      reason: "managed_by_emails" satisfies BootstrapReason,
    });
  }

  if (await countStoredAdmins()) {
    return NextResponse.json({
      authenticated: true,
      eligible: false,
      reason: "admin_exists" satisfies BootstrapReason,
    });
  }

  return NextResponse.json({
    authenticated: true,
    eligible: true,
    reason: "available" satisfies BootstrapReason,
  });
}
