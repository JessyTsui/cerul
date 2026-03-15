import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteHeader } from "@/components/site-header";
import {
  getDocBySlug,
  getDocsPageCanonical,
  getDocsStaticParams,
} from "@/lib/docs";

type DocPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getDocsStaticParams();
}

export async function generateMetadata({
  params,
}: DocPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocBySlug(slug);

  if (!page) {
    return { title: "Docs" };
  }

  return {
    title: page.title,
    description: page.summary,
    alternates: {
      canonical: getDocsPageCanonical(slug),
    },
  };
}

export default async function DocDetailPage({ params }: DocPageProps) {
  const { slug } = await params;
  const page = getDocBySlug(slug);

  if (!page) {
    notFound();
  }

  const tocItems: TocItem[] = [
    { id: "overview", text: "Overview", level: 1 },
    ...page.sections.map((section, index) => ({
      id: `section-${index + 1}`,
      text: section.title,
      level: 1,
    })),
  ];

  return (
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px]">
        <SiteHeader currentPath={`/docs/${slug}`} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
          <DocsSidebar currentSlug={slug} />

          <main
            data-ai-copy-root="true"
            className="min-w-0 rounded-[24px] border border-[var(--border)] bg-[rgba(9,13,21,0.92)] px-6 py-6 shadow-[0_22px_60px_rgba(2,6,18,0.16)] sm:px-8"
          >
            <section id="overview" className="border-b border-[var(--border)] pb-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                {page.kicker}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                <Link href="/docs" className="transition hover:text-white">
                  Documentation
                </Link>
                <span>/</span>
                <span>{page.kicker}</span>
                <span>/</span>
                <span className="text-white">{page.title}</span>
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                {page.title}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-secondary)]">
                <span>Last updated: October 26, 2024</span>
                <span>•</span>
                <span>{page.readingTime}</span>
              </div>
              <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--foreground-secondary)]">
                {page.summary}
              </p>

              <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    What this page covers
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                    Each section below maps to one concrete part of the integration path so you can
                    skim fast and drop into code only where necessary.
                  </p>
                </div>
                <div className="rounded-[20px] border border-[var(--border-brand)] bg-[rgba(34,211,238,0.08)] px-5 py-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Quick action
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Link href="/docs" className="button-secondary">
                      Back to docs
                    </Link>
                    <Link href="/docs/api-reference" className="button-secondary">
                      API Reference
                    </Link>
                    <Link href="/docs/quickstart" className="button-secondary">
                      Quickstart
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <AIToolbar
                  copyRootSelector="[data-ai-copy-root='true']"
                  pageUrl={`/docs/${slug}`}
                  pageTitle={page.title}
                />
              </div>
            </section>

            <div className="space-y-10 pt-8">
              {page.sections.map((section, index) => (
                <section
                  key={section.title}
                  id={`section-${index + 1}`}
                  className="scroll-mt-28 border-b border-[rgba(255,255,255,0.06)] pb-10 last:border-b-0 last:pb-0"
                >
                  <div className="max-w-3xl">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                      Section {String(index + 1).padStart(2, "0")}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold text-white">{section.title}</h2>
                    <p className="mt-4 text-base leading-8 text-[var(--foreground-secondary)]">
                      {section.body}
                    </p>
                  </div>

                  <div className={`mt-6 grid gap-6 ${section.code ? "xl:grid-cols-[minmax(0,1fr)_480px]" : "xl:grid-cols-[minmax(0,1fr)_320px]"}`}>
                    <div>
                      {section.bullets?.length ? (
                        <div className="grid gap-3">
                          {section.bullets.map((bullet) => (
                            <div
                              key={bullet}
                              className="rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-4"
                            >
                              <p className="text-sm leading-7 text-white">{bullet}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-5 py-5">
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                            Implementation note
                          </p>
                          <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                            This section is narrative-only. Use the adjacent example or the API
                            reference for exact payloads and response fields.
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      {section.code ? (
                        <CodeBlock
                          code={section.code}
                          filename={section.filename || "example.sh"}
                          language={section.language || "bash"}
                        />
                      ) : (
                        <div className="rounded-[20px] border border-[var(--border-brand)] bg-[rgba(34,211,238,0.08)] px-5 py-5">
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                            Practical takeaway
                          </p>
                          <p className="mt-3 text-sm leading-7 text-white">
                            If you are implementing this page’s concepts in code, start with the
                            quickstart request shape and then refine with the bullets on the left.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </main>

          <DocsToc items={tocItems} />
        </div>
      </div>
    </div>
  );
}
