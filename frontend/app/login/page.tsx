import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { authValueProps } from "@/lib/site";

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

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath="/login" />
      <main className="grid flex-1 gap-6 pb-8 pt-10 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="surface px-6 py-6 sm:px-8">
          <p className="eyebrow">Operator access</p>
          <h1 className="display-title mt-3 text-5xl sm:text-6xl">
            Sign in to manage keys and usage.
          </h1>
          <div className="mt-6 space-y-4">
            {authValueProps.map((item) => (
              <div
                key={item.title}
                className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4"
              >
                <h2 className="text-lg font-semibold tracking-tight">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="surface px-6 py-6 sm:px-8">
          <form className="rounded-[24px] border border-[var(--line)] bg-white/82 p-5">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Mock sign-in
            </p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Work email</span>
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Password</span>
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </label>
            </div>
            <button type="submit" className="button-primary mt-6 w-full">
              Continue to console
            </button>
            <p className="mt-4 text-sm text-[var(--muted)]">
              Need an account?{" "}
              <Link href="/signup" className="font-semibold text-[var(--brand-deep)]">
                Create one
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
