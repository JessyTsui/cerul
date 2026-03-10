import type { Metadata } from "next";
import { DashboardPipelinesScreen } from "@/components/dashboard/pipelines-screen";

export const metadata: Metadata = {
  title: "Dashboard Pipelines",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardPipelinesPage() {
  return <DashboardPipelinesScreen />;
}
