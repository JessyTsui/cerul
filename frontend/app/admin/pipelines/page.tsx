import type { Metadata } from "next";
import { DashboardPipelinesScreen } from "@/components/dashboard/pipelines-screen";

export const metadata: Metadata = {
  title: "Admin Pipelines",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPipelinesPage() {
  return <DashboardPipelinesScreen />;
}
