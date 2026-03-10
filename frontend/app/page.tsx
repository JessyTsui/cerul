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
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
        <SiteHeader currentPath="/" />
        <main className="flex-1">
          <section className="grid gap-8 pb-14 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-14 lg:pt-16">
            <div className="space-y-8">
              <div className="space-y-5">
                <span className="label">Video understanding for AI agents</span>
                <div className="space-y-4">
                  <p className="eyebrow">The video access layer for reasoning systems</p>
                  <h1 className="display-title max-w-[12ch] text-5xl sm:text-6xl lg:text-8xl">
                    Search what is shown in videos.
                  </h1>
                </div>
                <p className="max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
                  Cerul turns slides, charts, demos, code screens, and whiteboards
                  into queryable evidence for agents. One platform backbone, two
                  tracks: lightweight b-roll discovery and knowledge-dense retrieval.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/docs" className="button-primary">
                  Explore docs
                </Link>
                <Link href="/dashboard" className="button-secondary">
                  Open console
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {marketingMetrics.map((metric) => (
                  <div key={metric.label} className="surface px-5 py-5">
                    <p className="font-mono text-sm text-[var(--brand-deep)]">{metric.label}</p>
                    <p className="mt-4 text-3xl font-semibold tracking-tight">
                      {metric.value}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {metric.caption}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <AgentDemoConsole />
          </section>

          <section className="py-12">
            <div className="surface grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
              <div className="space-y-4">
                <p className="eyebrow">Why this exists</p>
                <h2 className="display-title text-4xl sm:text-5xl">
                  Transcripts are not enough.
                </h2>
                <p className="max-w-xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                  Agents can already search web pages. The missing layer is visual
                  evidence inside videos. Cerul indexes what was actually on screen,
                  not only what happened to be spoken.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {capabilityHighlights.map((item) => (
                  <article key={item.title} className="surface-strong grid-lines px-5 py-5">
                    <p className="font-mono text-sm text-[var(--brand-deep)]">{item.kicker}</p>
                    <h3 className="mt-4 text-xl font-semibold tracking-tight">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      {item.description}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="py-12">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Two tracks, one platform</p>
                <h2 className="display-title text-4xl sm:text-5xl">
                  Ship the showcase first. Keep the deeper moat.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-[var(--muted)]">
                The front end borrows Tavily&apos;s unified product rhythm: one brand,
                one stack, distinct product surfaces. Cerul does the same for b-roll
                search and knowledge retrieval.
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {searchTracks.map((track) => (
                <article key={track.name} className="surface grid-lines px-6 py-6 sm:px-7">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-sm text-[var(--brand-deep)]">{track.badge}</p>
                      <h3 className="mt-2 text-3xl font-semibold tracking-tight">
                        {track.name}
                      </h3>
                    </div>
                    <span className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      {track.grain}
                    </span>
                  </div>
                  <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">
                    {track.description}
                  </p>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {track.points.map((point) => (
                      <li
                        key={point}
                        className="rounded-2xl border border-[var(--line)] bg-white/68 px-4 py-3 text-sm leading-6 text-[var(--foreground)]"
                      >
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="py-12">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <article className="surface px-6 py-6 sm:px-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="eyebrow">Benchmark posture</p>
                    <h2 className="display-title text-4xl sm:text-5xl">
                      Make evaluation visible.
                    </h2>
                  </div>
                  <p className="max-w-md text-sm leading-6 text-[var(--muted)]">
                    Tavily leans on benchmarks to establish trust. Cerul should do the
                    same, especially where transcript-only systems lose visual recall.
                  </p>
                </div>
                <div className="mt-8 space-y-4">
                  {benchmarkRows.map((row) => (
                    <div key={row.label} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-center">
                      <div>
                        <p className="font-medium">{row.label}</p>
                        <p className="text-sm text-[var(--muted)]">{row.description}</p>
                      </div>
                      <div className="chart-bar h-3">
                        <span style={{ width: `${row.score}%` }} />
                      </div>
                      <p className="font-mono text-sm text-[var(--brand-deep)]">{row.score}%</p>
                    </div>
                  ))}
                </div>
              </article>
              <article className="surface px-6 py-6 sm:px-8">
                <p className="eyebrow">Operator cockpit</p>
                <h2 className="display-title text-4xl sm:text-5xl">
                  One console for usage, keys, and pipelines.
                </h2>
                <div className="mt-7 grid gap-4">
                  {dashboardSignals.map((signal) => (
                    <div
                      key={signal.label}
                      className="rounded-[24px] border border-[var(--line)] bg-white/72 px-5 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                            {signal.label}
                          </p>
                          <p className="mt-3 text-3xl font-semibold tracking-tight">
                            {signal.value}
                          </p>
                        </div>
                        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                          {signal.change}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {signal.caption}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="py-12">
            <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
              <article className="surface-strong px-6 py-6 sm:px-8">
                <p className="eyebrow">Docs preview</p>
                <h2 className="display-title mt-3 text-4xl sm:text-5xl">
                  Clear API shape. Thin product surface.
                </h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">
                  Docs should immediately tell developers what the two public endpoints
                  are, what payload shape to send, and how the b-roll and knowledge
                  tracks diverge.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link href="/docs" className="button-primary">
                    Read the docs
                  </Link>
                  <a
                    className="button-secondary"
                    href="https://github.com/JessyTsui/cerul"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View repository
                  </a>
                </div>
              </article>
              <article className="code-window px-5 py-5 sm:px-7 sm:py-7">
                <div className="mb-5 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#ff6b6b]" />
                  <span className="h-3 w-3 rounded-full bg-[#ffbf69]" />
                  <span className="h-3 w-3 rounded-full bg-[#57cc99]" />
                </div>
                <pre>
{`POST /v1/search

{
  "query": "cinematic drone shot of coastal highway at sunset",
  "search_type": "broll",
  "max_results": 10,
  "filters": {
    "source": "pexels",
    "min_duration": 5,
    "max_duration": 30
  }
}

{
  "results": [
    {
      "id": "pexels_28192743",
      "score": 0.89,
      "duration": 18,
      "description": "Aerial drone shot of a winding coastal road at sunset."
    }
  ]
}`}
                </pre>
              </article>
            </div>
          </section>

          <section className="py-12">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Pricing preview</p>
                <h2 className="display-title text-4xl sm:text-5xl">
                  Keep pricing operator-readable.
                </h2>
              </div>
              <Link href="/pricing" className="button-secondary">
                Open pricing
              </Link>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              {pricingTiers.map((tier) => (
                <article key={tier.name} className="surface grid-lines px-6 py-6">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--brand-deep)]">
                    {tier.name}
                  </p>
                  <div className="mt-4 flex items-end gap-3">
                    <p className="text-4xl font-semibold tracking-tight">{tier.price}</p>
                    <p className="pb-1 text-sm text-[var(--muted)]">{tier.cadence}</p>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                    {tier.description}
                  </p>
                  <ul className="mt-5 space-y-3">
                    {tier.features.slice(0, 3).map((feature) => (
                      <li
                        key={feature}
                        className="rounded-[18px] border border-[var(--line)] bg-white/72 px-4 py-3 text-sm leading-6"
                      >
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
