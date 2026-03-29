import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Pipelines",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPipelinesPage() {
  redirect("/dashboard/pipelines");
}
