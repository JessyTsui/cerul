import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminAppShell } from "@/components/admin/admin-app-shell";
import { ConsoleViewerProvider } from "@/components/console/console-viewer-context";
import { getConsoleViewer } from "@/lib/console-viewer";

type AdminAppLayoutProps = {
  children: ReactNode;
};

export default async function AdminAppLayout({
  children,
}: AdminAppLayoutProps) {
  const viewer = await getConsoleViewer();

  if (!viewer) {
    redirect("/login");
  }

  if (!viewer.isAdmin) {
    redirect("/dashboard");
  }

  return (
    <ConsoleViewerProvider viewer={viewer}>
      <AdminAppShell>{children}</AdminAppShell>
    </ConsoleViewerProvider>
  );
}
