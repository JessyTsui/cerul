import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteFooter } from "@/components/site-footer";
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
const docsTocItems: TocItem[] = [
  { id: "overview", text: "Introduction", level: 1 },
  { id: "getting-started", text: "Getting started", level: 1 },
  { id: "api-surface", text: "API surface", level: 1 },
  { id: "resources", text: "Common paths", level: 1 },
];

const fastStartSteps = [
  "Create an API key in the dashboard and keep it server-side.",
  "Send one authenticated request to POST /v1/search.",
  "Read GET /v1/usage before you automate higher traffic.",
];

export default function DocsPage() {
  return (
    <div className="soft-theme min-h-screen pb-10">
      <DocsHeader currentPath="/docs" />

      <div className="mx-auto max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
          <DocsSidebar currentPath="/docs" />

          <main data-ai-copy-root="true" className="min-w-0">
            <article className="rounded-[28px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] px-6 py-8 shadow-[0_18px_48px_rgba(36,29,21,0.08)] backdrop-blur-xl sm:px-8">
              <section id="overview" className="max-w-4xl border-b border-[var(--border)] pb-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                  Documentation
                </p>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
                  Cerul API docs
                </h1>
                <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                  Public guides and endpoint references for building against Cerul&apos;s
                  video-search platform. Start with one authenticated request, understand the
                  response envelope, and only move deeper when your integration needs it.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                  {[
                    "Base URL: https://api.cerul.ai",
                    "Bearer authentication",
                    "JSON request + response",
                  ].map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
                  <div>
                    <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
                      The fastest path is still simple: create one key, test search once, then wire
                      usage checks before you scale traffic.
                    </p>
                    <div className="mt-5 grid gap-3">
                      {fastStartSteps.map((step, index) => (
                        <div
                          key={step}
                          className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                        >
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                            Step {index + 1}
                          </p>
                          <p className="mt-2 text-sm leading-7 text-[var(--foreground)]">{step}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <CodeBlock
                    code={`curl "https://api.cerul.ai/v1/search" \\
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
  }'`}
                    filename="quickstart.sh"
                    language="bash"
                  />
                </div>

                <div className="mt-7" data-docs-ai-anchor="true">
                  <AIToolbar
                    copyRootSelector="[data-ai-copy-root='true']"
                    pageUrl="/docs"
                    pageTitle="Cerul Documentation"
                  />
                </div>
              </section>

              <section id="getting-started" className="border-b border-[var(--border)] py-10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                      Getting started
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                      Read in the order most integrations happen
                    </h2>
                  </div>
                  <Link
                    href="/docs/api-reference"
                    className="text-sm font-medium text-[var(--brand-bright)] transition hover:text-[var(--foreground)]"
                  >
                    Full endpoint index →
                  </Link>
                </div>

                <div className="mt-5 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)]">
                  {docsIndexCards.map((card, index) => (
                    <Link
                      key={card.slug}
                      href={card.href as Route}
                      className="group block border-b border-[var(--border)] px-5 py-5 transition hover:bg-white/80 last:border-b-0"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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
                          <h3 className="mt-3 text-xl font-semibold text-[var(--foreground)]">
                            {card.title}
                          </h3>
                          <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)]">
                            {card.summary}
                          </p>
                        </div>
                        <span className="text-sm font-medium text-[var(--brand-bright)] transition group-hover:text-[var(--foreground)]">
                          Open
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section id="api-surface" className="border-b border-[var(--border)] py-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  API surface
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  Stable public routes
                </h2>

                <div className="mt-5 overflow-hidden rounded-[20px] border border-[var(--border)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--background-elevated)] text-[var(--foreground-secondary)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">Surface</th>
                        <th className="px-4 py-3 font-medium">What it covers</th>
                        <th className="px-4 py-3 font-medium">Primary route</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white/65">
                      {docsFeatureCards.map((card) => (
                        <tr key={card.title} className="border-t border-[var(--border)]">
                          <td className="px-4 py-4 text-[var(--foreground)]">{card.title}</td>
                          <td className="px-4 py-4 text-[var(--foreground-secondary)]">
                            {card.description}
                          </td>
                          <td className="px-4 py-4">
                            <Link
                              href={card.href as Route}
                              className="font-mono text-[var(--brand-bright)] transition hover:text-[var(--foreground)]"
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

              <section id="resources" className="pt-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Common paths
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  What developers usually need next
                </h2>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {docsPopularTopics.map((item) => (
                    <Link
                      key={item.title}
                      href={item.href as Route}
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-5 py-5 transition hover:border-[var(--border-brand)] hover:bg-white"
                    >
                      <p className="text-base font-semibold text-[var(--foreground)]">
                        {item.title}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--foreground-secondary)]">
                        {item.description}
                      </p>
                      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        {item.href}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            </article>
          </main>

          <DocsToc
            items={docsTocItems}
            subtitle="Use this page as the map for the rest of the docs."
            actions={[
              { label: "Get API key", href: "/signup" },
              { label: "Open playground", href: "/search" },
            ]}
          />
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
