import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { dashboardRoutes, isDashboardRouteActive } from "@/lib/site";

type DashboardLayoutProps = {
  currentPath: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function DashboardLayout({
  currentPath,
  title,
  description,
  actions,
  children,
}: DashboardLayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
      <header className="surface-elevated sticky top-4 z-40 overflow-hidden rounded-[28px] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <BrandMark />
            <nav className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max items-center gap-8">
                {dashboardRoutes.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`console-tab ${
                      isDashboardRouteActive(currentPath, item.href)
                        ? "console-tab-active"
                        : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>
          </div>

          {actions ? (
            <div className="flex flex-wrap gap-3">{actions}</div>
          ) : null}
        </div>
      </header>

      <main className="flex-1 pt-8">
        <div className="mb-8 max-w-3xl">
          <h1 className="text-5xl font-bold tracking-[-0.05em] text-white sm:text-6xl">
            {title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-[var(--foreground-secondary)]">
            {description}
          </p>
        </div>
        <div className="space-y-6">{children}</div>
      </main>
    </div>
  );
}
