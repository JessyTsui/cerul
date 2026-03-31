import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteFooter } from "@/components/site-footer";
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
    <div className="soft-theme min-h-screen pb-10">
      <DocsHeader currentPath={`/docs/${slug}`} />

      <div className="mx-auto max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="mt-8 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
          <DocsSidebar currentSlug={slug} />

          <main data-ai-copy-root="true" className="min-w-0">
            <article className="rounded-[28px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] px-6 py-8 shadow-[0_18px_48px_rgba(36,29,21,0.08)] backdrop-blur-xl sm:px-8">
              <section id="overview" className="max-w-4xl border-b border-[var(--border)] pb-10">
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                  <Link href="/docs" className="transition hover:text-[var(--foreground)]">
                    Documentation
                  </Link>
                  <span>/</span>
                  <span>{page.kicker}</span>
                </div>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                  {page.kicker}
                </p>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
                  {page.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--foreground-secondary)]">
                  <span>{page.readingTime}</span>
                  <span>Public integration guide</span>
                </div>
                <p className="mt-5 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                  {page.summary}
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/docs" className="button-secondary">
                    Quickstart
                  </Link>
                  <Link href="/docs/api-reference" className="button-secondary">
                    API Reference
                  </Link>
                </div>

                <div className="mt-7" data-docs-ai-anchor="true">
                  <AIToolbar
                    copyRootSelector="[data-ai-copy-root='true']"
                    pageUrl={`/docs/${slug}`}
                    pageTitle={page.title}
                  />
                </div>
              </section>

              <div className="divide-y divide-[var(--border)]">
                {page.sections.map((section, index) => (
                  <section
                    key={section.title}
                    id={`section-${index + 1}`}
                    className="scroll-mt-28 py-10"
                  >
                    <div className={section.code ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]" : ""}>
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                          Section {String(index + 1).padStart(2, "0")}
                        </p>
                        <h2 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                          {section.title}
                        </h2>
                        <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                          {section.body}
                        </p>

                        {section.bullets?.length ? (
                          <ul className="mt-5 space-y-3">
                            {section.bullets.map((bullet) => (
                              <li
                                key={bullet}
                                className="relative rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4 pl-11 text-sm leading-7 text-[var(--foreground)]"
                              >
                                <span className="absolute left-4 top-5 h-2 w-2 rounded-full bg-[var(--brand-bright)]" />
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>

                      {section.code ? (
                        <div className="xl:pt-1">
                          <CodeBlock
                            code={section.code}
                            filename={section.filename || "example.sh"}
                            language={section.language || "bash"}
                          />
                        </div>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          </main>

          <DocsToc
            items={tocItems}
            subtitle="Jump to the part of the guide you need."
            actions={[
              { label: "Get API key", href: "/login?mode=signup" },
              { label: "Quickstart", href: "/docs" },
            ]}
          />
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
