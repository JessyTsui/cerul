import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AIToolbar } from "@/components/ai-toolbar";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { CodeBlock } from "@/components/code-block";
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
    return {
      title: "Docs",
    };
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
    { id: "intro", text: page.title, level: 1 },
    ...page.sections.map((section, index) => ({
      id: `section-${index + 1}`,
      text: section.title,
      level: 1,
    })),
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath={`/docs/${slug}`} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr_200px]">
        {/* Left sidebar */}
        <DocsSidebar currentSlug={slug} />

        {/* Main content */}
        <main className="min-w-0" data-ai-copy-root="true">
          {/* Header */}
          <div id="intro" className="mb-10 scroll-mt-24">
            <section className="surface-elevated relative overflow-hidden px-6 py-7 sm:px-8">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent opacity-80" />
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px]">
                <div>
                  <p className="eyebrow">{page.kicker}</p>
                  <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                    {page.title}
                  </h1>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--foreground-secondary)]">
                    {page.summary}
                  </p>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-xs text-[var(--foreground-tertiary)]">
                      {page.readingTime}
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-xs text-[var(--foreground-tertiary)]">
                      {page.sections.length} sections
                    </span>
                    <Link href="/docs" className="text-sm text-[var(--brand-bright)] hover:underline">
                      ← Back to docs
                    </Link>
                  </div>

                  <div className="mt-6">
                    <AIToolbar
                      copyRootSelector="[data-ai-copy-root='true']"
                      pageUrl={`/docs/${slug}`}
                      pageTitle={page.title}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Guide
                    </p>
                    <p className="mt-3 text-xl font-semibold text-white">{page.kicker}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      Built to be operator-readable before you wire in automation.
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Read time
                    </p>
                    <p className="mt-3 text-xl font-semibold text-white">{page.readingTime}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      Quick enough for onboarding, specific enough for implementation.
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Focus
                    </p>
                    <p className="mt-3 text-xl font-semibold text-white">Practical API use</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      Examples, request shape, and the minimum context needed to ship.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Sections */}
          <div className="space-y-12">
            {page.sections.map((section, index) => (
              <section
                key={section.title}
                id={`section-${index + 1}`}
                className="scroll-mt-24 rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 sm:p-8"
              >
                <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)] mb-2">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="text-2xl font-bold text-white">{section.title}</h2>
                <p className="mt-3 max-w-3xl text-[var(--foreground-secondary)]">{section.body}</p>

                {section.bullets?.length ? (
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {section.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="flex items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground-secondary)]"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {section.code ? (
                  <div className="mt-6">
                    <CodeBlock
                      code={section.code}
                      filename={section.filename || "example.sh"}
                      language={section.language || "bash"}
                    />
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          {/* Next steps */}
          <div className="surface-gradient mt-12 p-6">
            <h3 className="text-lg font-semibold text-white">Continue Reading</h3>
            <p className="mt-2 text-[var(--foreground-secondary)]">
              Explore more guides or try the API in the dashboard.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/docs" className="button-secondary">
                All Guides
              </Link>
              <Link href="/dashboard" className="button-primary">
                Open Dashboard
              </Link>
            </div>
          </div>
        </main>

        {/* Right TOC */}
        <div className="hidden lg:block">
          <DocsToc items={tocItems} />
        </div>
      </div>
    </div>
  );
}
