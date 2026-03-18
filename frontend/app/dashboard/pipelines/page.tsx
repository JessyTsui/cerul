import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard Pipelines",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardPipelinesPage() {
  redirect("/admin/pipelines");
}
