"use client";

import type { Route } from "next";
import Link from "next/link";
import { startTransition, useDeferredValue, useState } from "react";

type UnifiedDemoResult = {
  id: string;
  title: string;
  source: string;
  unitType: "summary" | "speech" | "visual";
  score: number;
  detail: string;
  href: string;
};

type UnifiedDemoResponse = {
  requestId: string;
  query: string;
  latencyMs: number;
  creditsUsed: number;
  creditsRemaining: number;
  answer: string;
  diagnostics: string[];
  results: UnifiedDemoResult[];
};

type SearchPreset = {
  label: string;
  query: string;
};

const presets: SearchPreset[] = [
  {
    label: "Agent workflows",
    query: "agent workflows with slides and demos",
  },
  {
    label: "Product launch footage",
    query: "product demo shots with hands typing and interface closeups",
  },
  {
    label: "Charts and evidence",
    query: "talks explaining trends with charts on screen",
  },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function buildResponse(query: string): UnifiedDemoResponse {
  const normalizedQuery = query.trim() || presets[0].query;
  const seed = hashString(normalizedQuery);
  const requestId = `req_${seed.toString(16).padStart(10, "0").slice(0, 10)}`;
  const latencyMs = 118 + (seed % 90);
  const creditsUsed = 1;
  const creditsRemaining = 999 - (seed % 120);

  const results: UnifiedDemoResult[] = [
    {
      id: "summary_openai_001",
      title: "Summary unit: roadmap discussion with visible slide evidence",
      source: "YouTube",
      unitType: "summary",
      score: Number((0.94 - (seed % 3) * 0.01).toFixed(2)),
      detail:
        "A unified summary combines the main claim, supporting slide context, and creator metadata into one retrieval unit.",
      href: "/docs/search-api",
    },
    {
      id: "speech_openai_1820",
      title: "Speech unit: timestamped explanation with grounded transcript",
      source: "YouTube",
      unitType: "speech",
      score: Number((0.89 - (seed % 4) * 0.01).toFixed(2)),
      detail:
        "The spoken passage explains the idea directly, while the result keeps timestamps ready for outbound links and citations.",
      href: "/docs/api-reference",
    },
    {
      id: "visual_pexels_022",
      title: "Visual unit: product demo moment with strong on-screen cues",
      source: "Pexels",
      unitType: "visual",
      score: Number((0.84 - (seed % 5) * 0.01).toFixed(2)),
      detail:
        "A visual-only match still appears in the same result list, so users do not have to choose b-roll or knowledge first.",
      href: "/docs/quickstart",
    },
  ];

  return {
    requestId,
    query: normalizedQuery,
    latencyMs,
    creditsUsed,
    creditsRemaining,
    answer:
      "Cerul now searches one unified retrieval surface. Summary, speech, and visual units can all appear in the same ranked response without a search_type switch.",
    diagnostics: [
      "Query embedded once into the shared 3072D retrieval space.",
      "Results diversified across summary, speech, and visual unit types.",
      "Tracking URLs and keyframe-ready metadata stay attached to each match.",
    ],
    results,
  };
}

function unitTypeCopy(unitType: UnifiedDemoResult["unitType"]): string {
  if (unitType === "summary") return "Summary";
  if (unitType === "speech") return "Speech";
  return "Visual";
}

export function UnifiedSearchDemo() {
  const [query, setQuery] = useState(presets[0].query);
  const [response, setResponse] = useState<UnifiedDemoResponse>(() =>
    buildResponse(presets[0].query),
  );
  const deferredQuery = useDeferredValue(query);

  const runSearch = (nextQuery: string) => {
    startTransition(() => {
      setResponse(buildResponse(nextQuery));
    });
  };

  return (
    <div className="space-y-8 pb-8">
      <section className="surface-elevated relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_32%)]" />
        <div className="relative grid gap-8 px-6 py-8 lg:px-10 lg:py-10 xl:grid-cols-[1.02fr_0.98fr] xl:items-start">
          <div className="space-y-6">
            <div className="space-y-4">
              <span className="label label-brand">Unified Search Demo</span>
              <h1 className="display-title-gradient text-4xl sm:text-5xl lg:text-6xl">
                One query. One search surface. Mixed video intelligence.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[var(--foreground-secondary)] sm:text-lg">
                This page demos the product shape in
                {" "}
                <code>/v1/search</code>
                {" "}
                after the unified pipeline change. Users no longer pick b-roll or
                knowledge. Cerul blends summary, speech, and visual retrieval
                units in a single ranked response.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <article className="surface px-5 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Public API
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">POST /v1/search</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  No `search_type` field in the request body.
                </p>
              </article>
              <article className="surface px-5 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Retrieval Mix
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">3 unit types</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  Summary, speech, and visual evidence are ranked together.
                </p>
              </article>
              <article className="surface px-5 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Draft Query
                </p>
                <p className="mt-3 line-clamp-2 text-base font-semibold text-white">
                  {deferredQuery}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  Seed a query or type your own retrieval intent.
                </p>
              </article>
            </div>

            <div className="surface px-5 py-5 sm:px-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Suggested Prompts
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--foreground-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-white"
                    onClick={() => {
                      startTransition(() => {
                        setQuery(preset.query);
                      });
                      runSearch(preset.query);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-elevated overflow-hidden">
            <div className="border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Unified API Shape
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    Search videos without picking a track
                  </p>
                </div>
                <span className="badge badge-success w-fit">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
                  Unified route active
                </span>
              </div>
            </div>

            <form
              className="px-5 py-5 sm:px-6 sm:py-6"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch(query);
              }}
            >
              <label
                htmlFor="unified-search-query"
                className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]"
              >
                Search videos
              </label>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  id="unified-search-query"
                  type="text"
                  value={query}
                  placeholder="Search videos..."
                  className="min-h-14 flex-1 rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-5 text-base text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    startTransition(() => {
                      setQuery(nextQuery);
                    });
                  }}
                />
                <button type="submit" className="button-primary min-h-14 min-w-[156px]">
                  Run Search
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--foreground-tertiary)]">
                The demo response shows how mixed retrieval units come back from one
                search request.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/docs/search-api" className="button-secondary">
                  Search API Docs
                </Link>
                <Link href="/docs/api-reference" className="button-ghost">
                  API Reference
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="surface-elevated px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">Request Metadata</p>
            <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
              A unified search request still returns the same operational metadata.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Latency", `${response.latencyMs}ms`],
            ["Credits Used", response.creditsUsed.toString()],
            ["Credits Remaining", response.creditsRemaining.toString()],
            ["Request ID", response.requestId],
          ].map(([label, value]) => (
            <article
              key={label}
              className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
            >
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {label}
              </p>
              <p className="mt-3 break-all font-mono text-xl font-semibold text-white">
                {value}
              </p>
            </article>
          ))}
        </div>

        <details className="mt-5 rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-white">
            <span>Diagnostics ({response.diagnostics.length})</span>
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Expand
            </span>
          </summary>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {response.diagnostics.map((item) => (
              <li
                key={item}
                className="rounded-2xl border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3 text-sm leading-6 text-[var(--foreground-secondary)]"
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--brand)]" />
                {item}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="surface-elevated overflow-hidden">
        <div className="border-b border-[var(--border-brand)] bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(249,115,22,0.08))] px-5 py-4 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Unified Answer
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--foreground-secondary)]">
            The response can synthesize across mixed unit types after one retrieval pass.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <p className="max-w-4xl text-lg leading-8 text-white sm:text-xl">
            {response.answer}
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Mixed Retrieval Results</p>
            <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
              {response.results.length} results for &quot;{response.query}&quot;
            </h2>
          </div>
          <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            One ranked list
          </span>
        </div>

        <div className="grid gap-4">
          {response.results.map((result, index) => (
            <article key={result.id} className="surface-elevated px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      Rank {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                      {unitTypeCopy(result.unitType)}
                    </span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                      {result.source}
                    </span>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-white sm:text-2xl">
                    {result.title}
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)] sm:text-base">
                    {result.detail}
                  </p>
                </div>

                <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 lg:min-w-[132px]">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    Relevance
                  </p>
                  <p className="mt-3 font-mono text-3xl font-semibold text-white">
                    {formatScore(result.score)}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-xs leading-6 break-all text-[var(--foreground-tertiary)]">
                  {result.href}
                </p>
                <Link
                  href={result.href as Route}
                  className="button-ghost w-fit px-0 text-sm text-[var(--brand-bright)] hover:bg-transparent hover:text-white"
                >
                  Open link →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
