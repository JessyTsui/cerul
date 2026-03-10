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
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath="/signup" />
      <main className="grid flex-1 gap-6 pb-8 pt-10 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="surface px-6 py-6 sm:px-8">
          <p className="eyebrow">Get started</p>
          <h1 className="display-title mt-3 text-5xl sm:text-6xl">
            Create a workspace for search, usage, and ingestion visibility.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
            The first phase keeps the setup intentionally small: create a workspace,
            mint an API key, inspect usage, and wire one demo surface into the API.
          </p>
          <div className="mt-6 grid gap-3">
            {[
              "Start with the free sandbox tier",
              "Use the same public API shape shown in the docs",
              "Expand into operators, billing, and private ingestion later",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4 text-sm leading-6"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
        <section className="surface px-6 py-6 sm:px-8">
          <form className="rounded-[24px] border border-[var(--line)] bg-white/82 p-5">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Mock signup
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">First name</span>
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]"
                  type="text"
                  placeholder="Jessy"
                  autoComplete="given-name"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Last name</span>
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]"
                  type="text"
                  placeholder="Tsui"
                  autoComplete="family-name"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-medium">Work email</span>
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-medium">Team goal</span>
                <select className="h-12 w-full rounded-[18px] border border-[var(--line)] bg-transparent px-4 outline-none focus:border-[rgba(10,142,216,0.24)]">
                  <option>Evaluate b-roll demo search</option>
                  <option>Prototype knowledge retrieval</option>
                  <option>Prepare enterprise pilot</option>
                </select>
              </label>
            </div>
            <button type="submit" className="button-primary mt-6 w-full">
              Create workspace
            </button>
            <p className="mt-4 text-sm text-[var(--muted)]">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-[var(--brand-deep)]">
                Sign in
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
