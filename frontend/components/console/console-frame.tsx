"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-shared";
import {
  adminRoutes,
  dashboardRoutes,
  isAdminRouteActive,
  isDashboardRouteActive,
} from "@/lib/site";
import { useConsoleViewer } from "./console-viewer-context";

type ConsoleFrameMode = "dashboard" | "admin";

type ConsoleFrameProps = {
  mode: ConsoleFrameMode;
  currentPath: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

function getRoleLabel(viewer: ReturnType<typeof useConsoleViewer>): string {
  if (viewer.isAdmin) {
    return "Administrator";
  }

  return "Member";
}

export function ConsoleFrame({
  mode,
  currentPath,
  title,
  description,
  actions,
  children,
}: ConsoleFrameProps) {
  const router = useRouter();
  const viewer = useConsoleViewer();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const sectionLinks = useMemo(
    () => ([
      {
        label: "Workspace",
        href: "/dashboard",
        active: currentPath.startsWith("/dashboard"),
      },
      ...(viewer.isAdmin
        ? [{
            label: "Admin",
            href: "/admin",
            active: currentPath.startsWith("/admin"),
          }]
        : []),
    ]),
    [currentPath, viewer.isAdmin],
  );

  const routeItems = mode === "dashboard" ? dashboardRoutes : adminRoutes;
  const isRouteActive = mode === "dashboard" ? isDashboardRouteActive : isAdminRouteActive;

  async function handleSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setSignOutError(
          getAuthErrorMessage(result.error, "Unable to sign out right now."),
        );
        return;
      }

      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } catch (nextError) {
      setSignOutError(
        getAuthErrorMessage(nextError, "Unable to sign out right now."),
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1580px] flex-col px-4 pb-12 pt-4 sm:px-6 xl:px-8">
      <header className="surface-elevated sticky top-4 z-40 overflow-hidden rounded-[32px] px-4 py-4 sm:px-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(249,115,22,0.12),transparent_26%)]" />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <BrandMark />
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    Control plane
                  </p>
                  <p className="mt-1 truncate text-sm text-[var(--foreground-secondary)]">
                    {viewer.displayName ?? viewer.email ?? "Authenticated workspace"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sectionLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition ${
                      item.active
                        ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                        : "border-[var(--border)] bg-[rgba(8,12,20,0.66)] text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <nav>
                <div className="flex flex-wrap gap-2">
                  {routeItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href as Route}
                      className={`inline-flex min-h-10 items-center rounded-full border px-3.5 py-2 text-sm transition ${
                        isRouteActive(currentPath, item.href)
                          ? "border-[var(--border-brand)] bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(14,165,233,0.12))] text-white shadow-[0_0_0_1px_rgba(34,211,238,0.14)_inset]"
                          : "border-[var(--border)] bg-[rgba(255,255,255,0.02)] text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:text-white"
                      }`}
                    >
                      <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)] 2xl:inline">
                        {item.meta}
                      </span>
                      <span className={item.meta ? "2xl:ml-2" : ""}>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </nav>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {actions}
              <button
                type="button"
                className="button-secondary"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>

          {signOutError ? (
            <p className="text-sm text-[rgb(254,202,202)]">{signOutError}</p>
          ) : null}
        </div>
      </header>

      <main className="flex-1 pt-7">
        <section className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(9,13,22,0.94),rgba(7,10,17,0.9))] px-5 py-5 shadow-[0_26px_80px_rgba(0,0,0,0.32)] sm:px-7 sm:py-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.12),transparent_36%),radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.08),transparent_24%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow">{mode === "dashboard" ? "Workspace Console" : "Admin Console"}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-white sm:text-4xl lg:text-5xl">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)] sm:text-base">
                {description}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {viewer.isAdmin ? "Admin visibility" : "Member visibility"}
              </span>
            </div>
          </div>
        </section>

        <div className="mt-6 space-y-6">{children}</div>
      </main>
    </div>
  );
}
