import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { normalizeAuthRedirectPath } from "@/lib/auth-shared";
import { getServerSession } from "@/lib/auth-server";
import { authValueProps } from "@/lib/site";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign In",
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
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
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
      <SiteHeader currentPath="/login" />
      <main className="grid flex-1 gap-6 pb-8 pt-10 lg:grid-cols-2">
        <section className="surface-elevated px-6 py-6 lg:px-8">
          <p className="eyebrow">Operator access</p>
          <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
            Sign in to manage keys and usage.
          </h1>
          <div className="mt-6 space-y-3">
            {authValueProps.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
              >
                <h2 className="font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-sm text-[var(--foreground-tertiary)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-elevated px-6 py-6 lg:px-8">
          <LoginForm nextPath={nextPath} />
        </section>
      </main>
    </div>
  );
}
