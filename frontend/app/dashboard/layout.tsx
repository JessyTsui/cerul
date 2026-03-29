import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ConsoleViewerProvider } from "@/components/console/console-viewer-context";
import { DashboardAppShell } from "@/components/dashboard/dashboard-app-shell";
import { DashboardUsageProvider } from "@/components/dashboard/dashboard-usage-context";
import { getConsoleViewer } from "@/lib/console-viewer";

type DashboardAppLayoutProps = {
  children: ReactNode;
};

export default async function DashboardAppLayout({
  children,
}: DashboardAppLayoutProps) {
  const viewer = await getConsoleViewer();

  if (!viewer) {
    redirect("/login");
  }

  return (
    <ConsoleViewerProvider viewer={viewer}>
      <DashboardUsageProvider>
        <DashboardAppShell>{children}</DashboardAppShell>
      </DashboardUsageProvider>
    </ConsoleViewerProvider>
  );
}
