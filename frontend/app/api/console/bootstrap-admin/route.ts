import { NextResponse, type NextRequest } from "next/server";
import { sql } from "kysely";
import { getAuthDatabase, withAuthDatabaseRecovery } from "@/lib/auth-db";
import { getServerSessionUncached } from "@/lib/auth-server";
import {
  getConfiguredAdminEmails,
  getConfiguredBootstrapAdminSecret,
} from "@/lib/console-settings";
import { getConsoleViewer, invalidateConsoleViewer } from "@/lib/console-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapPayload = {
  secret?: string;
};

const BOOTSTRAP_ADMIN_LOCK_KEY = 873_311_407;

async function promoteCurrentUserToAdminIfEligible(input: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<"promoted" | "admin_exists"> {
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const displayName = input.name?.trim() || null;

  return withAuthDatabaseRecovery(() =>
    getAuthDatabase().transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADMIN_LOCK_KEY})`.execute(trx);

      const adminCount = await sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM user_profiles
        WHERE console_role = 'admin' AND id <> ${input.userId}
      `.execute(trx);

      if (Number(adminCount.rows[0]?.count ?? 0) > 0) {
        return "admin_exists";
      }

      await sql`
        INSERT INTO user_profiles (id, email, display_name, console_role)
        VALUES (${input.userId}, ${normalizedEmail}, ${displayName}, 'admin')
        ON CONFLICT (id) DO UPDATE
        SET email = COALESCE(EXCLUDED.email, user_profiles.email),
            display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
            console_role = 'admin',
            updated_at = NOW()
      `.execute(trx);

      return "promoted";
    }),
  );
}

export async function POST(request: NextRequest) {
  const session = await getServerSessionUncached();

  if (!session?.user?.id) {
    return NextResponse.json(
      { detail: "Missing authenticated session." },
      { status: 401 },
    );
  }

  const configuredSecret = getConfiguredBootstrapAdminSecret();

  if (!configuredSecret) {
    return NextResponse.json(
      { detail: "Bootstrap admin flow is not enabled." },
      { status: 404 },
    );
  }

  const viewer = await getConsoleViewer();

  if (viewer?.isAdmin) {
    return NextResponse.json({ promoted: true, alreadyAdmin: true });
  }

  if (getConfiguredAdminEmails().size > 0) {
    return NextResponse.json(
      { detail: "Administrator access is managed through dashboard admin email settings." },
      { status: 409 },
    );
  }

  const payload = await request.json().catch(() => null) as BootstrapPayload | null;
  const submittedSecret = payload?.secret?.trim();

  if (!submittedSecret || submittedSecret !== configuredSecret) {
    return NextResponse.json(
      { detail: "Bootstrap admin secret is invalid." },
      { status: 403 },
    );
  }

  const promotionResult = await promoteCurrentUserToAdminIfEligible({
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  });

  if (promotionResult === "admin_exists") {
    return NextResponse.json(
      { detail: "An administrator already exists for this workspace." },
      { status: 409 },
    );
  }
  invalidateConsoleViewer(session.user.id);

  return NextResponse.json({ promoted: true });
}
