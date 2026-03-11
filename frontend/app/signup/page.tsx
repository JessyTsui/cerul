import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
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
  const session = await getServerSession();

  if (session?.user?.id) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const nextValue = Array.isArray(resolvedSearchParams.next)
    ? resolvedSearchParams.next[0]
    : resolvedSearchParams.next;
  const nextPath = normalizeAuthRedirectPath(nextValue);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath="/signup" />
      <main className="grid flex-1 gap-6 pb-8 pt-10 lg:grid-cols-2">
        <section className="surface-elevated px-6 py-6 lg:px-8">
          <p className="eyebrow">Get started</p>
          <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
            Create a workspace for search, usage, and ingestion visibility.
          </h1>
          <p className="mt-5 max-w-xl text-[var(--foreground-secondary)]">
            The first phase keeps the setup intentionally small: create a workspace,
            mint an API key, inspect usage, and wire one demo surface into the API.
          </p>
          <div className="mt-6 grid gap-2">
            {[
              "Start with the free sandbox tier",
              "Use the same public API shape shown in the docs",
              "Access the dashboard immediately after email/password signup",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground-secondary)]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {item}
              </div>
            ))}
          </div>
        </section>
        <section className="surface-elevated px-6 py-6 lg:px-8">
          <SignupForm nextPath={nextPath} />
        </section>
      </main>
    </div>
  );
}
