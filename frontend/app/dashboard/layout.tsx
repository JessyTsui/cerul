import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { getServerSession } from "@/lib/auth-server";

type DashboardAppLayoutProps = {
  children: ReactNode;
};

export default async function DashboardAppLayout({
  children,
}: DashboardAppLayoutProps) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-24 z-50 sm:right-6">
        <SignOutButton email={session.user.email ?? null} />
      </div>
      {children}
    </>
  );
}
