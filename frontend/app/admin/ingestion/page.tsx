import type { Metadata } from "next";
import { AdminIngestionScreen } from "@/components/admin/ingestion-screen";

export const metadata: Metadata = {
  title: "Admin Ingestion",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminIngestionPage() {
  return <AdminIngestionScreen />;
}
