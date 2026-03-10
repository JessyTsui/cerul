import type { Metadata } from "next";
import { DashboardUsageScreen } from "@/components/dashboard/usage-screen";

export const metadata: Metadata = {
  title: "Dashboard Usage",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardUsagePage() {
  return <DashboardUsageScreen />;
}
