import type { Metadata } from "next";
import { DashboardKeysScreen } from "@/components/dashboard/keys-screen";

export const metadata: Metadata = {
  title: "Dashboard Keys",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardKeysPage() {
  return <DashboardKeysScreen />;
}
