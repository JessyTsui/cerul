import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Content",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminContentPage() {
  redirect("/admin/sources");
}
