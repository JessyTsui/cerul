import type { Metadata } from "next";
import { AdminSourcesScreen } from "@/components/admin/sources-screen";

export const metadata: Metadata = {
  title: "Admin Sources",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminSourcesPage() {
  return <AdminSourcesScreen />;
}
