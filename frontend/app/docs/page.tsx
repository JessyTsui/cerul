import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { DocsSidebar } from "@/components/docs-sidebar";
import { SiteHeader } from "@/components/site-header";
import { docsFeatureCards, docsPopularTopics, getDocsIndexCards } from "@/lib/docs";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Documentation",
  description: "Cerul API and platform documentation.",
  alternates: {
    canonical: "/docs",
  },
};

const docsIndexCards = getDocsIndexCards();

export default function DocsPage() {
  return (
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px]">
        <SiteHeader currentPath="/docs" />

        <div className="mt-8 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
          <DocsSidebar currentPath="/docs" />

          <main className="min-w-0 space-y-6">
            <section className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8">
              <div className="max-w-4xl">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                  Developer docs
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-secondary)]">
                  <span className="rounded-full border border-[var(--border)] px-3 py-1">
                    Base URL: https://api.cerul.ai
                  </span>
                  <span>Guides, endpoint references, and integration notes.</span>
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                  Build against Cerul without reverse-engineering the product.
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--foreground-secondary)]">
                  Start from the index, search, and usage APIs, learn the request and response
                  shapes quickly, and move into implementation details only when you actually need
                  them.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/docs/quickstart" className="button-primary">
                  Open quickstart
                </Link>
                <Link href="/docs/api-reference" className="button-secondary">
                  Browse API reference
                </Link>
              </div>

              <div className="mt-6 rounded-[20px] border border-[var(--border)] bg-[#0b111b]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    quickstart.sh
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                    curl
                  </span>
                </div>
                <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#d7f7ff]">
                  <code>{`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 3,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'`}</code>
                </pre>
              </div>

              <div className="mt-6">
                <AIToolbar
                  copyRootSelector="[data-ai-copy-root='true']"
                  pageUrl="/docs"
                  pageTitle="Cerul Documentation"
                />
              </div>
            </section>

            <section
              data-ai-copy-root="true"
              className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    Core guides
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Read in the order most integrations actually happen
                  </h2>
                </div>
                <Link href="/docs/api-reference" className="text-sm font-medium text-[var(--brand-bright)] transition hover:text-white">
                  Full endpoint index →
                </Link>
              </div>

              <div className="mt-6 grid gap-4">
                {docsIndexCards.map((card, index) => (
                  <Link
                    key={card.slug}
                    href={card.href as Route}
                    className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5 transition hover:border-[var(--border-strong)] hover:bg-[rgba(255,255,255,0.04)]"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]">
                            {card.kicker}
                          </span>
                          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--foreground-secondary)]">
                            {card.readingTime}
                          </span>
                        </div>
                        <h3 className="mt-3 text-xl font-semibold text-white">{card.title}</h3>
                        <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)]">
                          {card.summary}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-[var(--brand-bright)]">Open</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                Quick reference
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Common integration surfaces</h2>

              <div className="mt-6 overflow-hidden rounded-[20px] border border-[var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[rgba(255,255,255,0.03)] text-[var(--foreground-secondary)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Surface</th>
                      <th className="px-4 py-3 font-medium">What it covers</th>
                      <th className="px-4 py-3 font-medium">Primary route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docsFeatureCards.map((card) => (
                      <tr key={card.title} className="border-t border-[var(--border)]">
                        <td className="px-4 py-4 text-white">{card.title}</td>
                        <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                          {card.description}
                        </td>
                        <td className="px-4 py-4">
                          <Link
                            href={card.href as Route}
                            className="font-mono text-[var(--brand-bright)] transition hover:text-white"
                          >
                            {card.snippet}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </main>

          <aside className="space-y-6">
            <section className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-5 shadow-[0_22px_60px_rgba(2,6,18,0.16)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                Popular topics
              </p>
              <div className="mt-4 space-y-3">
                {docsPopularTopics.map((item) => (
                  <Link
                    key={item.title}
                    href={item.href as Route}
                    className="block rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                  >
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.description}
                    </p>
                    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      {item.href}
                    </p>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] p-5 shadow-[0_22px_60px_rgba(2,6,18,0.16)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                Fast path
              </p>
              <div className="mt-4 space-y-4">
                {[
                  "Create a key from the dashboard.",
                  "Submit a video to POST /v1/index or search the shared library directly.",
                  "Check GET /v1/usage before you automate heavy traffic.",
                ].map((item, index) => (
                  <div
                    key={item}
                    className="rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Step {index + 1}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
