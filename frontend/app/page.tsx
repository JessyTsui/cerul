import type { Metadata } from "next";
import Link from "next/link";
import { AgentDemoConsole } from "@/components/agent-demo-console";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteOrigin } from "@/lib/site-url";
import {
  benchmarkRows,
  capabilityHighlights,
  dashboardSignals,
  marketingMetrics,
  pricingTiers,
  searchTracks,
} from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
};

const siteOrigin = getSiteOrigin();

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Cerul",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  description:
    "Video understanding search API for AI agents. Search what is shown in videos, not just what is said.",
  url: siteOrigin,
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/" />
        <main className="flex-1">
          {/* Hero Section */}
          <section className="relative py-16 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
              <div className="space-y-8">
                <div className="space-y-6">
                  <span className="label label-brand">Video understanding for AI agents</span>
                  <h1 className="display-title-gradient text-4xl sm:text-5xl lg:text-6xl xl:text-7xl">
                    Search what is shown in videos.
                  </h1>
                  <p className="max-w-xl text-lg leading-relaxed text-[var(--foreground-secondary)]">
                    Cerul turns slides, charts, demos, code screens, and whiteboards
                    into queryable evidence for agents. One platform backbone, two
                    tracks: lightweight b-roll discovery and knowledge-dense retrieval.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href="/docs" className="button-primary">
                    Explore docs
                  </Link>
                  <Link href="/signup" className="button-secondary">
                    Create account
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {marketingMetrics.map((metric) => (
                    <div key={metric.label} className="surface px-5 py-4">
                      <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                        {metric.label}
                      </p>
                      <p className="mt-3 text-2xl font-bold text-white">
                        {metric.value}
                      </p>
                      <p className="mt-1 text-sm text-[var(--foreground-tertiary)]">
                        {metric.caption}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <AgentDemoConsole />
            </div>
          </section>

          {/* API Example Section - RIGHT AFTER HERO */}
          <section className="py-8">
            <div className="surface-elevated overflow-hidden">
              <div className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="eyebrow">Try it now</p>
                    <h2 className="mt-1 text-xl font-bold text-white">
                      Copy, paste, run. Get video results in seconds.
                    </h2>
                  </div>
                  <Link href="/docs" className="button-secondary text-sm">
                    Full API reference →
                  </Link>
                </div>
              </div>

              {/* Knowledge Search - Primary */}
              <div className="border-b border-[var(--border)]">
                <div className="bg-[var(--brand-subtle)] px-6 py-2">
                  <span className="text-xs font-medium text-[var(--brand-bright)]">KNOWLEDGE SEARCH</span>
                  <span className="ml-2 text-xs text-[var(--foreground-tertiary)]">Find insights from interviews and talks</span>
                </div>
                <div className="grid gap-0 lg:grid-cols-2">
                  {/* Request */}
                  <div className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
                    <div className="code-window-header">
                      <div className="flex items-center gap-2">
                        <span className="code-window-dot code-window-dot-red" />
                        <span className="code-window-dot code-window-dot-yellow" />
                        <span className="code-window-dot code-window-dot-green" />
                        <span className="ml-2 font-mono text-xs text-[var(--foreground-tertiary)]">knowledge-search.sh</span>
                      </div>
                      <span className="rounded bg-[var(--brand-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--brand-bright)]">POST</span>
                    </div>
                    <pre className="p-4 text-sm">{`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "search_type": "knowledge",
    "max_results": 3,
    "include_answer": true
  }'`}</pre>
                  </div>
                  {/* Response */}
                  <div>
                    <div className="code-window-header">
                      <div className="flex items-center gap-2">
                        <span className="code-window-dot code-window-dot-red" />
                        <span className="code-window-dot code-window-dot-yellow" />
                        <span className="code-window-dot code-window-dot-green" />
                        <span className="ml-2 font-mono text-xs text-[var(--foreground-tertiary)]">knowledge-response.json</span>
                      </div>
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">200 OK</span>
                    </div>
                    <pre className="p-4 text-sm">{`{
  "results": [
    {
      "id": "yt_hmtuvNfytjM_1223",
      "score": 0.96,
      "title": "Sam Altman on the Future of AI Creative Tools",
      "description": "OpenAI CEO discusses the implications of AI video generation for creative industries",
      "video_url": "https://www.youtube.com/watch?v=hmtuvNfytjM&t=1223s",
      "thumbnail_url": "https://i.ytimg.com/vi/hmtuvNfytjM/hqdefault.jpg",
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 1223,
      "timestamp_end": 1345,
      "duration": 122,
      "answer": "Altman believes AI video generation will democratize filmmaking, allowing anyone to create professional content. He emphasizes the importance of human creativity in prompting and curation."
    },
    {
      "id": "yt_8XJ6z1K3n9P_445",
      "score": 0.91,
      "title": "Fireside Chat: AI and the Future of Media",
      "description": "Discussion on how AI tools are reshaping video production and storytelling",
      "video_url": "https://www.youtube.com/watch?v=8XJ6z1K3n9P&t=445s",
      "thumbnail_url": "https://i.ytimg.com/vi/8XJ6z1K3n9P/hqdefault.jpg",
      "source": "youtube",
      "speaker": "Sam Altman",
      "timestamp_start": 445,
      "timestamp_end": 582,
      "duration": 137
    }
  ],
  "credits_used": 2,
  "credits_remaining": 998,
  "request_id": "req_know_20240310_xyz"
}`}</pre>
                  </div>
                </div>
              </div>

              {/* B-roll Search - Secondary */}
              <div>
                <div className="bg-[var(--surface-hover)] px-6 py-2">
                  <span className="text-xs font-medium text-[var(--foreground-secondary)]">B-ROLL SEARCH</span>
                  <span className="ml-2 text-xs text-[var(--foreground-tertiary)]">Find stock footage and clips</span>
                </div>
                <div className="grid gap-0 lg:grid-cols-2">
                  {/* Request */}
                  <div className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
                    <div className="code-window-header">
                      <div className="flex items-center gap-2">
                        <span className="code-window-dot code-window-dot-red" />
                        <span className="code-window-dot code-window-dot-yellow" />
                        <span className="code-window-dot code-window-dot-green" />
                        <span className="ml-2 font-mono text-xs text-[var(--foreground-tertiary)]">broll-search.sh</span>
                      </div>
                      <span className="rounded bg-[var(--accent-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--accent-bright)]">POST</span>
                    </div>
                    <pre className="p-4 text-sm">{`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "cinematic drone shot of coastal highway",
    "search_type": "broll",
    "max_results": 3
  }'`}</pre>
                  </div>
                  {/* Response */}
                  <div>
                    <div className="code-window-header">
                      <div className="flex items-center gap-2">
                        <span className="code-window-dot code-window-dot-red" />
                        <span className="code-window-dot code-window-dot-yellow" />
                        <span className="code-window-dot code-window-dot-green" />
                        <span className="ml-2 font-mono text-xs text-[var(--foreground-tertiary)]">broll-response.json</span>
                      </div>
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">200 OK</span>
                    </div>
                    <pre className="p-4 text-sm">{`{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.94,
      "title": "Aerial drone shot of coastal highway",
      "description": "Cinematic 4K drone footage of winding coastal road",
      "video_url": "https://videos.pexels.com/video-files/28192743/aerial-coastal-drone.mp4",
      "thumbnail_url": "https://images.pexels.com/photos/28192743/pexels-photo-28192743.jpeg",
      "duration": 18,
      "source": "pexels",
      "license": "pexels-license"
    }
  ],
  "credits_used": 1,
  "credits_remaining": 999
}`}</pre>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Why Section */}
          <section className="py-16">
            <div className="surface-elevated px-6 py-8 lg:px-10 lg:py-12">
              <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
                <div className="space-y-4">
                  <p className="eyebrow">Why Cerul</p>
                  <h2 className="text-3xl font-bold text-white sm:text-4xl">
                    Transcripts are not enough.
                  </h2>
                  <p className="text-[var(--foreground-secondary)]">
                    Agents can already search web pages. The missing layer is visual
                    evidence inside videos. Cerul indexes what was actually on screen,
                    not only what happened to be spoken.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {capabilityHighlights.map((item) => (
                    <article key={item.title} className="surface px-4 py-4">
                      <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                        {item.kicker}
                      </p>
                      <h3 className="mt-3 text-lg font-semibold text-white">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
                        {item.description}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Two Tracks Section */}
          <section className="py-16">
            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Two tracks, one platform</p>
                <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
                  Ship the showcase first.
                  <br />
                  <span className="text-[var(--foreground-secondary)]">Keep the deeper moat.</span>
                </h2>
              </div>
              <p className="max-w-md text-[var(--foreground-secondary)]">
                The front end borrows Tavily&apos;s unified product rhythm: one brand,
                one stack, distinct product surfaces.
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {searchTracks.map((track) => (
                <article key={track.name} className="surface-elevated px-6 py-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                        {track.badge}
                      </p>
                      <h3 className="mt-2 text-2xl font-bold text-white">
                        {track.name}
                      </h3>
                    </div>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                      {track.grain}
                    </span>
                  </div>
                  <p className="mt-4 text-[var(--foreground-secondary)]">
                    {track.description}
                  </p>
                  <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                    {track.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground-secondary)]"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          {/* Benchmark & Dashboard Section */}
          <section className="py-16">
            <div className="grid gap-5 lg:grid-cols-2">
              <article className="surface-elevated px-6 py-6 lg:px-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="eyebrow">Benchmarks</p>
                    <h2 className="mt-3 text-2xl font-bold text-white">
                      Make evaluation visible.
                    </h2>
                  </div>
                  <p className="max-w-xs text-sm text-[var(--foreground-tertiary)]">
                    Cerul leans on benchmarks to establish trust, especially where transcript-only systems lose visual recall.
                  </p>
                </div>
                <div className="mt-8 space-y-5">
                  {benchmarkRows.map((row) => (
                    <div key={row.label} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-center">
                      <div>
                        <p className="font-medium text-white">{row.label}</p>
                        <p className="text-sm text-[var(--foreground-tertiary)]">{row.description}</p>
                      </div>
                      <div className="chart-bar">
                        <span style={{ width: `${row.score}%` }} />
                      </div>
                      <p className="font-mono text-sm text-[var(--brand-bright)]">{row.score}%</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="surface-gradient px-6 py-6 lg:px-8">
                <p className="eyebrow">Operator console</p>
                <h2 className="mt-3 text-2xl font-bold text-white">
                  One dashboard for usage, keys, and pipelines.
                </h2>
                <div className="mt-6 grid gap-3">
                  {dashboardSignals.map((signal) => (
                    <div
                      key={signal.label}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                            {signal.label}
                          </p>
                          <p className="mt-2 text-2xl font-bold text-white">
                            {signal.value}
                          </p>
                        </div>
                        <span className="rounded-full bg-[var(--accent-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--accent-bright)]">
                          {signal.change}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--foreground-tertiary)]">
                        {signal.caption}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          {/* Pricing Preview Section */}
          <section className="py-16">
            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Pricing</p>
                <h2 className="mt-3 text-3xl font-bold text-white">
                  Keep pricing operator-readable.
                </h2>
              </div>
              <Link href="/pricing" className="button-secondary">
                View all plans
              </Link>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {pricingTiers.map((tier) => (
                <article key={tier.name} className={`surface px-5 py-5 ${tier.accent === "orange" ? "border-[var(--accent)]/30" : ""}`}>
                  <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                    {tier.name}
                  </p>
                  <div className="mt-4 flex items-end gap-2">
                    <p className="text-4xl font-bold text-white">{tier.price}</p>
                    <p className="mb-1 text-sm text-[var(--foreground-tertiary)]">{tier.cadence}</p>
                  </div>
                  <p className="mt-4 text-sm text-[var(--foreground-tertiary)]">
                    {tier.description}
                  </p>
                  <ul className="mt-5 space-y-2">
                    {tier.features.slice(0, 3).map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)]"
                      >
                        <svg className="h-4 w-4 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
