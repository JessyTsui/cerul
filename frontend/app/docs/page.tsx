import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { DocsSidebar } from "@/components/docs-sidebar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  docsLandingSections,
  docsNavigation,
  getDocsIndexCards,
} from "@/lib/docs";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Docs",
  description: "Cerul API and platform documentation.",
  alternates: {
    canonical: "/docs",
  },
};

export default function DocsPage() {
  const guides = getDocsIndexCards();

  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath="/docs" />
      <main className="flex-1 pb-12 pt-10">
        <section className="surface px-6 py-7 sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
            <div className="space-y-4">
              <span className="label">Documentation</span>
              <h1 className="display-title text-5xl sm:text-6xl">
                One public API surface, no extra protocol maze.
              </h1>
            </div>
            <div className="space-y-5">
              <p className="text-lg leading-8 text-[var(--muted)]">
                Cerul starts with the smallest stable public contract: search and
                usage. Heavy processing stays in workers, authentication stays thin,
                and agent integrations can call the same API surface directly.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/" className="button-secondary">
                  Back to home
                </Link>
                <Link href="/dashboard" className="button-primary">
                  See console
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="pt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Guide library</p>
              <h2 className="display-title mt-2 text-4xl sm:text-5xl">
                Read the contract before you build around it.
              </h2>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            {guides.map((guide) => (
              <Link
                key={guide.slug}
                href={guide.href as Route}
                className="surface-strong grid-lines px-5 py-5"
              >
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-deep)]">
                  {guide.kicker}
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">
                  {guide.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {guide.summary}
                </p>
                <p className="mt-5 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  {guide.readingTime}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-6 pt-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          <DocsSidebar anchors={docsNavigation.map((item) => ({ ...item }))} />

          <div className="space-y-6">
            {docsLandingSections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="surface scroll-mt-28 px-6 py-6 sm:px-8"
              >
                <p className="eyebrow">{section.kicker}</p>
                <h2 className="display-title mt-3 text-4xl sm:text-5xl">
                  {section.title}
                </h2>
                <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted)]">
                  {section.description}
                </p>
                {section.list.length > 0 ? (
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {section.list.map((item) => (
                      <li
                        key={item}
                        className="rounded-[22px] border border-[var(--line)] bg-white/72 px-4 py-3 text-sm leading-6"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.code ? (
                  <div className="code-window mt-7 px-5 py-5 sm:px-6">
                    <pre>{section.code}</pre>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
