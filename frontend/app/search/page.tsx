import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UnifiedSearchDemo } from "@/components/search/unified-search-demo";
import { BlurFade } from "@/components/animations";

export const metadata = {
  title: "Playground",
  description: "Try the Cerul API in real-time. Test search, indexing, and usage endpoints.",
};

export default function SearchPage() {
  return (
    <div className="soft-theme min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1480px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/search" />

        {/* Header Section */}
        <div className="py-12 text-center lg:py-16">
          <BlurFade>
            <span className="eyebrow inline-flex items-center gap-2 rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--brand-bright)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              Interactive Demo
            </span>
          </BlurFade>
          <BlurFade delay={100}>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
              API Playground
            </h1>
          </BlurFade>
          <BlurFade delay={200}>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-[var(--foreground-secondary)]">
              Try the Cerul API in real-time. Test search queries, explore responses,
              and see how the video search layer works.
            </p>
          </BlurFade>
        </div>

        <main className="flex-1">
          <UnifiedSearchDemo />
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
