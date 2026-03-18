"use client";

import type { ReactNode } from "react";
import { ConsoleFrame } from "@/components/console/console-frame";

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
    <ConsoleFrame
      mode="dashboard"
      currentPath={currentPath}
      title={title}
      description={description}
      actions={actions}
    >
      {children}
    </ConsoleFrame>
  );
}
