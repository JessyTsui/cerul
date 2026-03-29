import type { Metadata } from "next";
import { AdminWorkersScreen } from "@/components/admin/workers-screen";

export const metadata: Metadata = {
  title: "Admin Workers",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminWorkersPage() {
  return <AdminWorkersScreen />;
}
