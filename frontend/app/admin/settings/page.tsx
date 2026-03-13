import type { Metadata } from "next";
import { AdminSettingsScreen } from "@/components/admin/settings-screen";

export const metadata: Metadata = {
  title: "Admin Targets",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminSettingsPage() {
  return <AdminSettingsScreen />;
}
