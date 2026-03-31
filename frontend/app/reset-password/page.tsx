import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthCallbackErrorMessage } from "@/lib/auth-shared";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/reset-password",
  },
};

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const resolvedSearchParams = await searchParams;
  const tokenValue = Array.isArray(resolvedSearchParams.token)
    ? resolvedSearchParams.token[0]
    : resolvedSearchParams.token;
  const errorValue = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;

  return (
    <AuthShell
      heroTitle="Choose a new password"
      heroDescription="Use a fresh Cerul password to get back into your account."
    >
      <ResetPasswordForm
        token={tokenValue ?? null}
        initialError={getAuthCallbackErrorMessage(errorValue)}
      />
    </AuthShell>
  );
}
