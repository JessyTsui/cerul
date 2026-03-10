import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { AIToolbar } from "@/components/ai-toolbar";
import { DocsCard, DocsCards } from "@/components/docs-card";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsToc } from "@/components/docs-toc";
import { CodeBlock } from "@/components/code-block";
import { DocsTabs } from "@/components/docs-tabs";
import { SiteHeader } from "@/components/site-header";
import { docsLandingSections, getDocsIndexCards } from "@/lib/docs";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Documentation",
  description: "Cerul API and platform documentation.",
  alternates: {
    canonical: "/docs",
  },
};

const docsQuickFacts = [
  {
    label: "Setup",
    value: "5 min",
    caption: "From API key to first search request.",
  },
  {
    label: "Tracks",
    value: "2",
    caption: "Knowledge retrieval and b-roll search on one API.",
  },
  {
    label: "Path",
    value: "HTTP + skill",
    caption: "Start with direct calls, then package repeatable workflows.",
  },
] as const;

function getGuideIcon(slug: string) {
  switch (slug) {
    case "quickstart":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "search-api":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "usage-api":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 3 3 5-7" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h10" />
        </svg>
      );
  }
}

export default function DocsPage() {
  const guides = getDocsIndexCards();

  const tocItems = [
    { id: "overview", text: "Overview", level: 1 },
    { id: "quickstart", text: "Quickstart", level: 1 },
    ...docsLandingSections.map((section) => ({
      id: section.id,
      text: section.title,
      level: 1,
    })),
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <SiteHeader currentPath="/docs" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr_200px]">
        {/* Left sidebar */}
        <DocsSidebar />

        {/* Main content */}
        <main className="min-w-0" data-ai-copy-root="true">
          {/* Hero */}
          <div id="overview" className="mb-10 scroll-mt-24">
            <section className="surface-elevated relative overflow-hidden px-6 py-7 sm:px-8">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent opacity-80" />
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div>
                  <p className="eyebrow">Documentation</p>
                  <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                    Cerul API Documentation
                  </h1>
                  <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--foreground-secondary)]">
                    Video understanding search API for AI agents. Search what is shown in videos,
                    not just what is said.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/docs/quickstart" className="button-primary">
                      Start in 5 minutes
                    </Link>
                    <Link href="/dashboard" className="button-secondary">
                      Try the dashboard
                    </Link>
                  </div>
                  <div className="mt-6">
                    <AIToolbar
                      copyRootSelector="[data-ai-copy-root='true']"
                      pageUrl="/docs"
                      pageTitle="Cerul Documentation"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {docsQuickFacts.map((fact) => (
                    <div
                      key={fact.label}
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                    >
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                        {fact.label}
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-white">{fact.value}</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                        {fact.caption}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Guide cards */}
          <div id="quickstart" className="mb-12 scroll-mt-24">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Guides</h2>
                <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                  Start with quick onboarding, then move into request shape, usage, and architecture.
                </p>
              </div>
              <Link href="/docs/search-api" className="text-sm font-medium text-[var(--brand-bright)] transition hover:text-white">
                See full search reference
              </Link>
            </div>
            <DocsCards>
              {guides.map((guide) => (
                <DocsCard
                  key={guide.slug}
                  title={guide.title}
                  description={guide.summary}
                  href={guide.href as Route}
                  icon={getGuideIcon(guide.slug)}
                  kicker={guide.kicker}
                  readingTime={guide.readingTime}
                />
              ))}
            </DocsCards>
          </div>

          {/* Code example with tabs - Two search types */}
          <div className="mb-12">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-white">Quick Example</h2>
              <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                The primary workflow is request in, evidence-rich results out. Use these samples as your first smoke test.
              </p>
            </div>

            {/* Knowledge Search - Primary */}
            <div className="mb-6 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-3">
                <span className="rounded-full border border-[var(--border-brand)] px-2 py-1 text-[11px] font-semibold tracking-[0.16em] text-[var(--brand-bright)]">
                  KNOWLEDGE SEARCH
                </span>
                <span className="text-xs text-[var(--foreground-secondary)]">Find insights from interviews and talks</span>
              </div>
              <DocsTabs
                items={[
                  {
                    label: "cURL",
                    value: "curl",
                    content: (
                      <CodeBlock
                        filename="knowledge-search.sh"
                        code={`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer $CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "search_type": "knowledge",
    "max_results": 3,
    "include_answer": true
  }'`}
                      />
                    ),
                  },
                  {
                    label: "Response",
                    value: "response",
                    content: (
                      <CodeBlock
                        filename="knowledge-response.json"
                        language="json"
                        code={`{
  "results": [
    {
      "id": "yt_hmtuvNfytjM_1223",
      "score": 0.96,
      "title": "Sam Altman on the Future of AI Creative Tools",
      "video_url": "https://www.youtube.com/watch?v=hmtuvNfytjM&t=1223s",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223,
      "timestamp_end": 1345,
      "answer": "Altman believes AI video generation will democratize filmmaking..."
    }
  ],
  "credits_used": 2,
  "credits_remaining": 998
}`}
                      />
                    ),
                  },
                ]}
              />
            </div>

            {/* B-roll Search - Secondary */}
            <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--background-elevated)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-hover)] px-4 py-3">
                <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[11px] font-semibold tracking-[0.16em] text-[var(--foreground-secondary)]">
                  B-ROLL SEARCH
                </span>
                <span className="text-xs text-[var(--foreground-secondary)]">Find stock footage and clips</span>
              </div>
              <DocsTabs
                items={[
                  {
                    label: "cURL",
                    value: "curl",
                    content: (
                      <CodeBlock
                        filename="broll-search.sh"
                        code={`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer $CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "cinematic drone shot of coastal highway",
    "search_type": "broll",
    "max_results": 5
  }'`}
                      />
                    ),
                  },
                  {
                    label: "Python",
                    value: "python",
                    content: (
                      <CodeBlock
                        filename="search.py"
                        language="python"
                        code={`import requests

response = requests.post(
    "https://api.cerul.ai/v1/search",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "query": "cinematic drone shot of coastal highway",
        "search_type": "broll",
        "max_results": 5
    }
)

results = response.json()["results"]
for video in results:
    print(f"{video['title']}: {video['video_url']}")`}
                      />
                    ),
                  },
                  {
                    label: "Response",
                    value: "response",
                    content: (
                      <CodeBlock
                        filename="broll-response.json"
                        language="json"
                        code={`{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.94,
      "title": "Aerial drone shot of coastal highway",
      "video_url": "https://videos.pexels.com/video-files/28192743/aerial-coastal-drone.mp4",
      "thumbnail_url": "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
      "duration": 18,
      "source": "pexels",
      "license": "pexels-license"
    }
  ],
  "credits_used": 1,
  "credits_remaining": 999
}`}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {/* Documentation sections */}
          <div className="space-y-12">
            {docsLandingSections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24 rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 sm:p-8"
              >
                <p className="eyebrow mb-2">{section.kicker}</p>
                <h2 className="text-2xl font-bold text-white">{section.title}</h2>
                <p className="mt-3 max-w-3xl text-[var(--foreground-secondary)]">
                  {section.description}
                </p>

                {section.list.length > 0 && (
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {section.list.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground-secondary)]"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}

                {section.code && (
                  <div className="mt-6">
                    <CodeBlock
                      code={section.code}
                      filename={section.filename || "example.json"}
                      language={section.language || "json"}
                    />
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Next steps */}
          <div className="surface-gradient mt-12 p-6">
            <h3 className="text-lg font-semibold text-white">Next Steps</h3>
            <p className="mt-2 text-[var(--foreground-secondary)]">
              Ready to start building? Check out the guides or open the dashboard.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/docs/quickstart" className="button-primary">
                Read Quickstart
              </Link>
              <Link href="/dashboard" className="button-secondary">
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
