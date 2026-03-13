import type { Metadata } from "next";
import { AdminRequestsScreen } from "@/components/admin/requests-screen";

export const metadata: Metadata = {
  title: "Admin Requests",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminRequestsPage() {
  return <AdminRequestsScreen />;
}
