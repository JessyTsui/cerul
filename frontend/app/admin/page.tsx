import type { Metadata } from "next";
import { AdminOverviewScreen } from "@/components/admin/overview-screen";

export const metadata: Metadata = {
  title: "Admin Overview",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminOverviewPage() {
  return <AdminOverviewScreen />;
}
