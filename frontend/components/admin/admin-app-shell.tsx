"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopBar } from "./admin-top-bar";

type AdminAppShellProps = {
  children: ReactNode;
};

export function AdminAppShell({ children }: AdminAppShellProps) {
  const pathname = usePathname() ?? "/admin";

  return (
    <div className="soft-theme flex min-h-screen">
      <AdminSidebar currentPath={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar currentPath={pathname} />
        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
