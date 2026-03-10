import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsSidebar } from "@/components/docs-sidebar";
import { SiteFooter } from "@/components/site-footer";
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

  const anchors = page.sections.map((section, index) => ({
    href: `#section-${index + 1}`,
    label: section.title,
    index: `${index + 1}`.padStart(2, "0"),
  }));

  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath={`/docs/${slug}`} />
      <main className="flex-1 pb-12 pt-10">
        <section className="surface px-6 py-7 sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
            <div>
              <span className="label">{page.kicker}</span>
              <h1 className="display-title mt-5 text-5xl sm:text-6xl">{page.title}</h1>
            </div>
            <div>
              <p className="text-lg leading-8 text-[var(--muted)]">{page.summary}</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <span className="rounded-full border border-[var(--line)] bg-white/72 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  {page.readingTime}
                </span>
                <Link href="/docs" className="button-secondary">
                  Back to docs
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 pt-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          <DocsSidebar currentSlug={slug} anchors={anchors} />
          <div className="space-y-6">
            {page.sections.map((section, index) => (
              <section
                key={section.title}
                id={`section-${index + 1}`}
                className="surface scroll-mt-28 px-6 py-6 sm:px-8"
              >
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--brand-deep)]">
                  {`${index + 1}`.padStart(2, "0")}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                  {section.title}
                </h2>
                <p className="mt-4 text-base leading-7 text-[var(--muted)]">
                  {section.body}
                </p>
                {section.bullets?.length ? (
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {section.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="rounded-[22px] border border-[var(--line)] bg-white/72 px-4 py-3 text-sm leading-6"
                      >
                        {bullet}
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

            <section className="surface-strong px-6 py-6 sm:px-8">
              <p className="eyebrow">Next surface</p>
              <h2 className="display-title mt-3 text-4xl sm:text-5xl">
                Inspect how the same contract shows up in the operator console.
              </h2>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard" className="button-primary">
                  Open dashboard
                </Link>
                <Link href="/pricing" className="button-secondary">
                  Review pricing
                </Link>
              </div>
            </section>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
