import { sql } from "kysely";
import { cache } from "react";
import { getAuthDatabase } from "./auth-db";
import { getServerSession } from "./auth-server";
import { getConfiguredAdminEmails } from "./console-settings";

export type ConsoleViewer = {
  userId: string;
  email: string | null;
  displayName: string | null;
  image: string | null;
  consoleRole: string;
  isAdmin: boolean;
};

type ConsoleProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  console_role: string | null;
};

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

const VIEWER_CACHE_TTL_MS = process.env.NODE_ENV === "development" ? 15_000 : 5_000;
const VIEWER_CACHE_LIMIT = 128;
const viewerCache = new Map<
  string,
  {
    expiresAt: number;
    value: ConsoleViewer;
  }
>();

function pruneViewerCache(now: number) {
  for (const [key, entry] of viewerCache.entries()) {
    if (entry.expiresAt <= now) {
      viewerCache.delete(key);
    }
  }

  if (viewerCache.size <= VIEWER_CACHE_LIMIT) {
    return;
  }

  const overflow = viewerCache.size - VIEWER_CACHE_LIMIT;
  for (const key of viewerCache.keys()) {
    viewerCache.delete(key);
    if (viewerCache.size <= VIEWER_CACHE_LIMIT - overflow) {
      break;
    }
  }
}

export function invalidateConsoleViewer(userId?: string | null) {
  if (userId) {
    viewerCache.delete(userId);
    return;
  }

  viewerCache.clear();
}

export const getConsoleViewer = cache(async function getConsoleViewer(): Promise<ConsoleViewer | null> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return null;
  }

  const now = Date.now();
  const cached = viewerCache.get(session.user.id);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const result = await sql<ConsoleProfileRow>`
    SELECT id, email, display_name, console_role
    FROM user_profiles
    WHERE id = ${session.user.id}
  `.execute(getAuthDatabase());

  const profile = result.rows[0] ?? null;
  const email = normalizeEmail(profile?.email ?? session.user.email ?? null);
  const displayName = profile?.display_name?.trim() || session.user.name?.trim() || null;
  const normalizedRole = String(profile?.console_role ?? "user").trim().toLowerCase() || "user";
  const adminEmails = getConfiguredAdminEmails();
  const isAdmin = normalizedRole === "admin" || (email !== null && adminEmails.has(email));

  const image = typeof session.user.image === "string" && session.user.image.trim()
    ? session.user.image.trim()
    : null;

  const viewer = {
    userId: session.user.id,
    email,
    displayName,
    image,
    consoleRole: isAdmin ? "admin" : "user",
    isAdmin,
  };

  viewerCache.set(session.user.id, {
    expiresAt: now + VIEWER_CACHE_TTL_MS,
    value: viewer,
  });
  pruneViewerCache(now);

  return viewer;
});
