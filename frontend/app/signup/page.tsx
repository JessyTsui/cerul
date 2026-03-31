import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthUiConfig } from "@/lib/auth-providers";
import {
  getAuthCallbackErrorMessage,
  normalizeAuthRedirectPath,
} from "@/lib/auth-shared";
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
    error?: string | string[];
    error_description?: string | string[];
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextValue = Array.isArray(resolvedSearchParams.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams.next;
  const errorValue = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;
  const errorDescriptionValue = Array.isArray(resolvedSearchParams.error_description)
    ? resolvedSearchParams.error_description[0]
    : resolvedSearchParams.error_description;
  const nextPath = normalizeAuthRedirectPath(nextValue);
  const initialError = getAuthCallbackErrorMessage(
    errorValue,
    errorDescriptionValue,
  );
  const authUiConfig = getAuthUiConfig();
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect(nextPath as Route);
  }

  return (
    <AuthShell
      heroTitle="Give your agent eyes on every video."
      heroDescription="Cerul indexes video by meaning — so your agent can find the exact scene it needs across thousands of hours."
    >
      <SignupForm
        nextPath={nextPath}
        enabledProviders={authUiConfig.enabledProviders}
        googleOneTapClientId={authUiConfig.googleOneTapClientId}
        initialError={initialError}
      />
    </AuthShell>
  );
}
