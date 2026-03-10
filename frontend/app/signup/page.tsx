import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

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

export default function SignupPage() {
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
              "Expand into operators, billing, and private ingestion later",
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
          <form className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Create account
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">First name</span>
                <input
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  type="text"
                  placeholder="Jessy"
                  autoComplete="given-name"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">Last name</span>
                <input
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  type="text"
                  placeholder="Tsui"
                  autoComplete="family-name"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">Work email</span>
                <input
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-medium text-[var(--foreground-secondary)]">Team goal</span>
                <select className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 text-white outline-none transition-all focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]">
                  <option>Evaluate b-roll demo search</option>
                  <option>Prototype knowledge retrieval</option>
                  <option>Prepare enterprise pilot</option>
                </select>
              </label>
            </div>
            <button type="submit" className="button-accent mt-6 w-full">
              Create workspace
            </button>
            <p className="mt-4 text-sm text-[var(--foreground-tertiary)]">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-[var(--brand-bright)] hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
