import type { Metadata } from "next";
import { DashboardOverviewScreen } from "@/components/dashboard/overview-screen";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/dashboard",
  },
};

export default function DashboardPage() {
  return <DashboardOverviewScreen />;
}
