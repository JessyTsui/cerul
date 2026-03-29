import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Targets",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminSettingsPage() {
  redirect("/admin");
}
