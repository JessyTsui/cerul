"use client";

import type { ReactNode } from "react";
import { ConsoleFrame } from "@/components/console/console-frame";

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
    <ConsoleFrame
      mode="admin"
      currentPath={currentPath}
      title={title}
      description={description}
      actions={actions}
    >
      {children}
    </ConsoleFrame>
  );
}
