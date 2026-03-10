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
          <form className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Sign in
            </p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">Work email</span>
                <input
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">Password</span>
                <input
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </label>
            </div>
            <button type="submit" className="button-primary mt-6 w-full">
              Continue to console
            </button>
            <p className="mt-4 text-sm text-[var(--foreground-tertiary)]">
              Need an account?{" "}
              <Link href="/signup" className="font-medium text-[var(--brand-bright)] hover:underline">
                Create one
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
