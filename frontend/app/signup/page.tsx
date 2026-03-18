import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { normalizeAuthRedirectPath } from "@/lib/auth-shared";
import { getServerSession } from "@/lib/auth-server";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign Up",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/signup",
  },
};

type SignupPageProps = {
  searchParams: Promise<{
    next?: string | string[];
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextValue = Array.isArray(resolvedSearchParams.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams.next;
  const nextPath = normalizeAuthRedirectPath(nextValue);
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect(nextPath as Route);
  }

  return (
    <AuthShell
      heroEyebrow="Create workspace"
      heroTitle="One account for the console, separate keys for every app."
      heroDescription="Create your Cerul workspace, land in the dashboard immediately, and issue API keys per environment instead of routing everything through one long-lived secret."
      highlights={["Sandbox first", "Separate web auth", "Production-ready keys"]}
    >
      <SignupForm nextPath={nextPath} />
    </AuthShell>
  );
}
