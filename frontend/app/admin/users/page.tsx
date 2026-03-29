import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Users",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminUsersPage() {
  redirect("/admin");
}
