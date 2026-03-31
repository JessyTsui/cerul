import { sql } from "kysely";
import { getAuthDatabase, withAuthDatabaseRecovery } from "@/lib/auth-db";

export const runtime = "nodejs";

type PasswordResetStatus = "credential" | "social" | "unknown";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const email = normalizeEmail(payload && typeof payload === "object" ? payload.email : null);

  if (!email) {
    return Response.json(
      {
        status: "unknown" satisfies PasswordResetStatus,
      },
      { status: 400 },
    );
  }

  try {
    const result = await withAuthDatabaseRecovery(() =>
      sql<{
        hasCredential: boolean;
        hasAnyAccount: boolean;
      }>`
        SELECT
          EXISTS (
            SELECT 1
            FROM "account" account
            INNER JOIN "user" "user" ON "user"."id" = account."userId"
            WHERE LOWER("user"."email") = ${email}
              AND account."providerId" = 'credential'
          ) AS "hasCredential",
          EXISTS (
            SELECT 1
            FROM "account" account
            INNER JOIN "user" "user" ON "user"."id" = account."userId"
            WHERE LOWER("user"."email") = ${email}
          ) AS "hasAnyAccount"
      `.execute(getAuthDatabase()),
    );

    const row = result.rows[0];

    if (!row?.hasAnyAccount) {
      return Response.json({
        status: "unknown" satisfies PasswordResetStatus,
      });
    }

    return Response.json({
      status: row.hasCredential
        ? ("credential" satisfies PasswordResetStatus)
        : ("social" satisfies PasswordResetStatus),
    });
  } catch (error) {
    console.error("[auth] Failed to inspect password reset account status:", error);

    return Response.json({
      status: "unknown" satisfies PasswordResetStatus,
    });
  }
}
