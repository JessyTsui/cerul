import { NextResponse, type NextRequest } from "next/server";
import { sql } from "kysely";
import { getAuthDatabase } from "@/lib/auth-db";
import { getServerSession } from "@/lib/auth-server";
import { getConsoleViewer } from "@/lib/console-viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapPayload = {
  secret?: string;
};

function getBootstrapAdminSecret(): string | null {
  const secret = process.env.BOOTSTRAP_ADMIN_SECRET?.trim();
  return secret || null;
}

function getConfiguredAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_CONSOLE_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function countOtherStoredAdmins(userId: string): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM user_profiles
    WHERE console_role = 'admin' AND id <> ${userId}
  `.execute(getAuthDatabase());

  return Number(result.rows[0]?.count ?? 0);
}

async function promoteCurrentUserToAdmin(input: {
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<void> {
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const displayName = input.name?.trim() || null;

  await sql`
    INSERT INTO user_profiles (id, email, display_name, console_role)
    VALUES (${input.userId}, ${normalizedEmail}, ${displayName}, 'admin')
    ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, user_profiles.email),
        display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
        console_role = 'admin',
        updated_at = NOW()
  `.execute(getAuthDatabase());
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json(
      { detail: "Missing authenticated session." },
      { status: 401 },
    );
  }

  const configuredSecret = getBootstrapAdminSecret();

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
      { detail: "Administrator access is managed through ADMIN_CONSOLE_EMAILS." },
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

  const otherAdminCount = await countOtherStoredAdmins(session.user.id);

  if (otherAdminCount > 0) {
    return NextResponse.json(
      { detail: "An administrator already exists for this workspace." },
      { status: 409 },
    );
  }

  await promoteCurrentUserToAdmin({
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  });

  return NextResponse.json({ promoted: true });
}
