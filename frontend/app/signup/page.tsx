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
      heroTitle="Give your agent eyes on every video."
      heroDescription="Cerul indexes video by meaning — so your agent can find the exact scene it needs across thousands of hours."
    >
      <SignupForm nextPath={nextPath} />
    </AuthShell>
  );
}
