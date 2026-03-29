import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { CodeBlock } from "@/components/code-block";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc, type TocItem } from "@/components/docs-toc";
import { SiteFooter } from "@/components/site-footer";
import { FadeIn, BlurFade } from "@/components/animations";
import { docsFeatureCards } from "@/lib/docs";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Documentation",
  description: "Cerul API documentation. Search videos by meaning with one API call.",
  alternates: {
    canonical: "/docs",
  },
};

const tocItems: TocItem[] = [
  { id: "overview", text: "Introduction", level: 1 },
  { id: "get-api-key", text: "Get your API key", level: 1 },
  { id: "first-request", text: "First request", level: 1 },
  { id: "response", text: "Response", level: 1 },
  { id: "check-usage", text: "Check usage", level: 1 },
  { id: "endpoints", text: "Endpoints", level: 1 },
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
              {/* Hero */}
              <section id="overview" className="max-w-4xl border-b border-[var(--border)] pb-10">
                <BlurFade>
                  <h1 className="text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
                    Build with Cerul
                  </h1>
                </BlurFade>
                <BlurFade delay={100}>
                  <p className="mt-4 max-w-3xl text-[16px] leading-8 text-[var(--foreground-secondary)]">
                    Add video understanding to your AI agents with one API call.
                    Search across visual scenes, speech, and on-screen text — get back
                    timestamped results with relevance scores and source links.
                  </p>
                </BlurFade>

                <FadeIn delay={200}>
                  <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                    {[
                      "Base URL: https://api.cerul.ai",
                      "Bearer authentication",
                      "JSON responses",
                    ].map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-[var(--border)] bg-white/70 px-3 py-1.5 font-mono text-xs"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </FadeIn>

                <div className="mt-7" data-docs-ai-anchor="true">
                  <AIToolbar
                    copyRootSelector="[data-ai-copy-root='true']"
                    pageUrl="/docs"
                    pageTitle="Cerul Documentation"
                  />
                </div>
              </section>

              {/* Step 1: Get API key */}
              <section id="get-api-key" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <FadeIn>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Step 1
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                    Get your API key
                  </h2>
                  <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                    Sign up at cerul.ai and create an API key from the dashboard.
                    The free tier gives you 1,000 requests per month — no credit card required.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/signup" className="button-primary">
                      Get free API key
                    </Link>
                    <Link href="/pricing" className="button-secondary">
                      View pricing
                    </Link>
                  </div>
                </FadeIn>
              </section>

              {/* Step 2: First request */}
              <section id="first-request" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_480px]">
                  <FadeIn>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Step 2
                      </p>
                      <h2 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                        Make your first search
                      </h2>
                      <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                        Replace YOUR_CERUL_API_KEY with your actual key.
                        This searches across visual scenes, speech, and on-screen text in one call.
                      </p>
                      <div className="mt-6 space-y-3">
                        {[
                          { name: "query", desc: "Natural-language search (required)" },
                          { name: "max_results", desc: "1–50, default 10" },
                          { name: "include_answer", desc: "AI summary from matched evidence" },
                        ].map((param) => (
                          <div
                            key={param.name}
                            className="rounded-[14px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3"
                          >
                            <span className="font-mono text-sm text-[var(--foreground)]">{param.name}</span>
                            <span className="ml-3 text-sm text-[var(--foreground-secondary)]">{param.desc}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 text-sm text-[var(--foreground-secondary)]">
                        <Link href="/docs/search-api" className="font-medium text-[var(--brand-bright)] transition hover:text-[var(--foreground)]">
                          Full search reference →
                        </Link>
                      </p>
                    </div>
                  </FadeIn>

                  <FadeIn delay={100}>
                    <CodeBlock
                      code={`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -d '{
    "query": "Sam Altman views on AI video generation",
    "include_answer": true
  }'`}
                      filename="search.sh"
                      language="bash"
                    />
                  </FadeIn>
                </div>
              </section>

              {/* Step 3: Response */}
              <section id="response" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_480px]">
                  <FadeIn>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Step 3
                      </p>
                      <h2 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                        Understand the response
                      </h2>
                      <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                        Each result includes a relevance score, timestamps, source metadata,
                        and a tracking URL that redirects to the original video.
                      </p>
                      <div className="mt-6 space-y-3">
                        {[
                          { name: "score", desc: "Relevance from 0.0 to 1.0" },
                          { name: "url", desc: "Tracking link → redirects to source video" },
                          { name: "unit_type", desc: "summary, speech, or visual" },
                          { name: "answer", desc: "AI summary (when include_answer is true)" },
                        ].map((field) => (
                          <div
                            key={field.name}
                            className="rounded-[14px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3"
                          >
                            <span className="font-mono text-sm text-[var(--foreground)]">{field.name}</span>
                            <span className="ml-3 text-sm text-[var(--foreground-secondary)]">{field.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </FadeIn>

                  <FadeIn delay={100}>
                    <CodeBlock
                      code={`{
  "results": [
    {
      "id": "unit_hmtuvNfytjM_1223",
      "score": 0.92,
      "url": "https://cerul.ai/v/a8f3k2x",
      "title": "Sam Altman on AGI Timeline",
      "snippet": "AGI is coming sooner than most people expect.",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223.0,
      "timestamp_end": 1345.0,
      "unit_type": "speech"
    }
  ],
  "answer": "Summary grounded in matched evidence.",
  "credits_used": 1,
  "credits_remaining": 999,
  "request_id": "req_abc123xyz"
}`}
                      filename="response.json"
                      language="json"
                    />
                  </FadeIn>
                </div>
              </section>

              {/* Step 4: Check usage */}
              <section id="check-usage" className="scroll-mt-28 border-b border-[var(--border)] py-10">
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_480px]">
                  <FadeIn>
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        Step 4
                      </p>
                      <h2 className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
                        Check your usage
                      </h2>
                      <p className="mt-4 max-w-3xl text-[15px] leading-8 text-[var(--foreground-secondary)]">
                        Monitor your request count and remaining quota before scaling traffic.
                      </p>
                      <p className="mt-4 text-sm text-[var(--foreground-secondary)]">
                        <Link href="/docs/usage-api" className="font-medium text-[var(--brand-bright)] transition hover:text-[var(--foreground)]">
                          Full usage reference →
                        </Link>
                      </p>
                    </div>
                  </FadeIn>

                  <FadeIn delay={100}>
                    <CodeBlock
                      code={`curl "https://api.cerul.ai/v1/usage" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY"

# Response:
# {
#   "tier": "free",
#   "credits_used": 128,
#   "credits_remaining": 872,
#   "rate_limit_per_sec": 1,
#   "api_keys_active": 1
# }`}
                      filename="usage.sh"
                      language="bash"
                    />
                  </FadeIn>
                </div>
              </section>

              {/* Endpoints */}
              <section id="endpoints" className="scroll-mt-28 pt-10">
                <FadeIn>
                  <h2 className="text-2xl font-bold text-[var(--foreground)]">
                    Endpoints
                  </h2>
                </FadeIn>

                <FadeIn delay={100}>
                  <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {docsFeatureCards.map((card) => (
                      <Link
                        key={card.title}
                        href={card.href as Route}
                        className="group rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] p-6 transition-all hover:border-[var(--border-brand)] hover:bg-white hover:shadow-sm"
                      >
                        <p className="font-mono text-sm font-semibold text-[var(--foreground)]">
                          {card.snippet}
                        </p>
                        <p className="mt-2 text-[15px] leading-relaxed text-[var(--foreground-secondary)]">
                          {card.description}
                        </p>
                        <p className="mt-4 text-sm font-medium text-[var(--brand-bright)] transition group-hover:text-[var(--foreground)]">
                          Reference →
                        </p>
                      </Link>
                    ))}
                  </div>
                </FadeIn>
              </section>
            </article>
          </main>

          <DocsToc
            items={tocItems}
            actions={[
              { label: "Get API key", href: "/signup" },
              { label: "API reference", href: "/docs/api-reference" },
            ]}
          />
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
