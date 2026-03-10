import type { Metadata } from "next";
import { DashboardSettingsScreen } from "@/components/dashboard/settings-screen";

export const metadata: Metadata = {
  title: "Dashboard Settings",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardSettingsPage() {
  return <DashboardSettingsScreen />;
}
