"use client";

import type { ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopBar } from "./admin-top-bar";

type AdminLayoutProps = {
  currentPath: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function AdminLayout({
  currentPath,
  title,
  description,
  actions,
  children,
}: AdminLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0b111e]">
      <AdminSidebar currentPath={currentPath} />
      <div className="flex flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 to-[#0b111e]">
        <AdminTopBar title={title} subtitle={description} />
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
