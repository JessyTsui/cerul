import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getAuthUiConfig } from "@/lib/auth-providers";
import {
  getAuthCallbackErrorMessage,
  normalizeAuthRedirectPath,
} from "@/lib/auth-shared";
import { getServerSession } from "@/lib/auth-server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log In",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/login",
  },
};

type LoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
    mode?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
    ref?: string | string[];
  }>;
};

function appendQueryParam(path: string, key: string, value: string | null): string {
  if (!value) {
    return path;
  }

  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(key, value);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
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
  const referralValue = Array.isArray(resolvedSearchParams.ref)
    ? resolvedSearchParams.ref[0]
    : resolvedSearchParams.ref;
  const modeValue = Array.isArray(resolvedSearchParams.mode)
    ? resolvedSearchParams.mode[0]
    : resolvedSearchParams.mode;
  const nextPath = normalizeAuthRedirectPath(nextValue);
  const nextPathWithReferral = appendQueryParam(nextPath, "ref", referralValue ?? null);
  const initialMode = modeValue === "signup" ? "signup" : "login";
  const initialError = getAuthCallbackErrorMessage(
    errorValue,
    errorDescriptionValue,
  );
  const authUiConfig = getAuthUiConfig();
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect(nextPathWithReferral as Route);
  }

  return (
    <AuthShell
      heroTitle="Give your agent eyes on every video."
      heroDescription="Cerul indexes video by meaning — so your agent can find the exact scene it needs across thousands of hours."
    >
      <LoginForm
        nextPath={nextPath}
        initialMode={initialMode}
        enabledProviders={authUiConfig.enabledProviders}
        googleOneTapClientId={authUiConfig.googleOneTapClientId}
        initialError={initialError}
        referralCode={referralValue ?? null}
      />
    </AuthShell>
  );
}
