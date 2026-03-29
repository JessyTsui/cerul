"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardTopNav } from "./dashboard-top-nav";

type DashboardAppShellProps = {
  children: ReactNode;
};

export function DashboardAppShell({ children }: DashboardAppShellProps) {
  const pathname = usePathname() ?? "/dashboard";

  return (
    <div className="soft-theme flex min-h-screen">
      <DashboardSidebar currentPath={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopNav currentPath={pathname} />
        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
