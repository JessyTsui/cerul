import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthCallbackErrorMessage } from "@/lib/auth-shared";
import { getServerSession } from "@/lib/auth-server";
import { ResendVerificationForm } from "./resend-verification-form";

export const metadata: Metadata = {
  title: "Verify Email",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/verify-email",
  },
};

type VerifyEmailPageProps = {
  searchParams: Promise<{
    email?: string | string[];
    error?: string | string[];
  }>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession();

  if (session?.user?.emailVerified) {
    redirect("/dashboard");
  }

  const emailValue = Array.isArray(resolvedSearchParams.email)
    ? resolvedSearchParams.email[0]
    : resolvedSearchParams.email;
  const errorValue = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;

  const fallbackEmail = session?.user?.email?.trim().toLowerCase() || null;
  const email = emailValue?.trim().toLowerCase() || fallbackEmail;

  return (
    <AuthShell
      heroTitle="Verify your email"
      heroDescription="Confirm your Cerul email address to unlock dashboard access and API key management."
    >
      <ResendVerificationForm
        email={email}
        initialError={getAuthCallbackErrorMessage(errorValue)}
      />
    </AuthShell>
  );
}
