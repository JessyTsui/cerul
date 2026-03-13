import type { Metadata } from "next";
import { AdminContentScreen } from "@/components/admin/content-screen";

export const metadata: Metadata = {
  title: "Admin Content",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminContentPage() {
  return <AdminContentScreen />;
}
