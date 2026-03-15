"use client";

import type { Route } from "next";
import Link from "next/link";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DemoMode, DemoSearchResponse } from "@/lib/demo-api";
import { demoModes, searchTracks } from "@/lib/site";
import { SearchAnswer } from "./search-answer";
import { SearchMetadata } from "./search-metadata";
import { SearchResults } from "./search-results";

type ModeNarrative = {
  badge: string;
  title: string;
  description: string;
  points: string[];
};

const brollTrack = searchTracks.find((track) => track.name === "B-roll");
const knowledgeTrack = searchTracks.find((track) => track.name === "Knowledge");

const modeNarratives: Record<DemoMode, ModeNarrative> = {
  knowledge: {
    badge: knowledgeTrack?.badge ?? "Core moat",
    title: "Knowledge retrieval with visible evidence",
    description:
      knowledgeTrack?.description ??
      "Segment-level retrieval that combines transcript context with what was on screen.",
    points: knowledgeTrack?.points.slice(0, 2) ?? [],
  },
  broll: {
    badge: brollTrack?.badge ?? "Launch track",
    title: "Fast asset discovery for footage search",
    description:
      brollTrack?.description ??
      "Asset-level retrieval optimized for public demos and lower-friction discovery.",
    points: brollTrack?.points.slice(0, 2) ?? [],
  },
  agent: {
    badge: "Skill-first path",
    title: "Structured output for downstream agents",
    description:
      "Run the same demo API in an agent-oriented mode to return evidence bundles, citations, and timestamp-ready references.",
    points: [
      "Bundle citations, timestamps, and grounded snippets in one response.",
      "Keep integrations thin with direct HTTP and installable skill workflows.",
    ],
  },
};

async function fetchDemoSearch(
  mode: DemoMode,
  query: string,
  signal?: AbortSignal,
): Promise<DemoSearchResponse> {
  const response = await fetch("/api/demo/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode,
      query,
    }),
    signal,
  });

  if (!response.ok) {
    let message = "Search request failed.";

    try {
      const payload = (await response.json()) as { error?: string };

      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Fall back to the default message when the error body is unavailable.
    }

    throw new Error(message);
  }

  return (await response.json()) as DemoSearchResponse;
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="surface-elevated min-h-[220px] animate-pulse px-6 py-6" />
      <div className="surface-elevated min-h-[220px] animate-pulse px-6 py-6" />
    </div>
  );
}

type SearchDemoProps = {
  initialResponse: DemoSearchResponse;
};

export function SearchDemo({ initialResponse }: SearchDemoProps) {
  const [activeMode, setActiveMode] = useState<DemoMode>("knowledge");
  const [query, setQuery] = useState<string>(initialResponse.query);
  const [response, setResponse] = useState<DemoSearchResponse | null>(initialResponse);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const deferredQuery = useDeferredValue(query);

  const activeModeConfig = demoModes[activeMode];
  const activeModeNarrative = modeNarratives[activeMode];

  const runSearch = useCallback(async (nextMode: DemoMode, nextQuery: string) => {
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const nextResponse = await fetchDemoSearch(
        nextMode,
        nextQuery,
        controller.signal,
      );

      if (activeRequestRef.current !== requestId || controller.signal.aborted) {
        return;
      }

      setResponse(nextResponse);
    } catch (nextError) {
      if (controller.signal.aborted || activeRequestRef.current !== requestId) {
        return;
      }

      const nextMessage =
        nextError instanceof Error
          ? nextError.message
          : "Search request failed. The demo API did not respond as expected.";

      setError(nextMessage);
    } finally {
      if (activeRequestRef.current === requestId && !controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return (
    <div className="space-y-8 pb-8">
      <section className="surface-elevated relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_32%)]" />
        <div className="relative grid gap-8 px-6 py-8 lg:px-10 lg:py-10 xl:grid-cols-[1.02fr_0.98fr] xl:items-start">
          <div className="space-y-6">
            <div className="space-y-4">
              <span className="label label-brand">Public Search Demo</span>
              <h1 className="display-title-gradient text-4xl sm:text-5xl lg:text-6xl">
                Search product-grade video intelligence in one public surface.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-[var(--foreground-secondary)] sm:text-lg">
                Try Cerul across knowledge retrieval, b-roll discovery, and
                agent-oriented evidence packaging. The page uses the same public
                demo API route visitors can inspect in the frontend.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <article className="surface px-5 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Shared Backbone
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {searchTracks.length} tracks
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  B-roll and knowledge retrieval stay on one platform spine.
                </p>
              </article>
              <article className="surface px-5 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Active Surface
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {activeModeConfig.surface}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  The current demo mode shapes what Cerul returns.
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
                  Enter a custom query or run the seeded example for this mode.
                </p>
              </article>
            </div>

            <div className="surface px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="label label-accent">{activeModeNarrative.badge}</span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                  {activeModeConfig.output}
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
                {activeModeNarrative.title}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--foreground-secondary)] sm:text-base">
                {activeModeNarrative.description}
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {activeModeNarrative.points.map((point) => (
                  <article
                    key={point}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                  >
                    <p className="text-sm leading-7 text-[var(--foreground-secondary)]">
                      {point}
                    </p>
                  </article>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {activeModeConfig.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-elevated overflow-hidden">
            <div className="border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                    Demo API
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    Search videos without signing in
                  </p>
                </div>
                <span className="badge badge-success w-fit">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
                  Public route active
                </span>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(demoModes).map(([mode, item]) => {
                  const isActive = mode === activeMode;

                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={isActive}
                      className={`min-h-12 rounded-[18px] border px-4 py-3 text-left transition-all ${
                        isActive
                          ? "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-white"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:text-white"
                      }`}
                      onClick={() => {
                        const nextMode = mode as DemoMode;
                        const nextQuery = demoModes[nextMode].query;

                        startTransition(() => {
                          setActiveMode(nextMode);
                          setQuery(nextQuery);
                        });

                        void runSearch(nextMode, nextQuery);
                      }}
                    >
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                        {item.surface}
                      </p>
                      <p className="mt-2 text-sm font-semibold capitalize text-current">
                        {item.label}
                      </p>
                    </button>
                  );
                })}
              </div>

              <form
                className="mt-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch(activeMode, query);
                }}
              >
                <label
                  htmlFor="search-demo-query"
                  className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]"
                >
                  Search videos
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <input
                    id="search-demo-query"
                    type="text"
                    value={query}
                    placeholder="Search videos..."
                    className="min-h-14 flex-1 rounded-[20px] border border-[var(--border)] bg-[var(--background)] px-5 text-base text-white outline-none transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="button-primary min-h-14 min-w-[156px]"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <svg
                          className="h-4 w-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Searching...
                      </>
                    ) : (
                      "Run Search"
                    )}
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--foreground-tertiary)]">
                  Press Enter or use the mode selector to run the seeded demo query.
                </p>
              </form>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link href={"/docs/search-api" as Route} className="button-secondary">
                  Search API Docs
                </Link>
                <Link href={"/pricing" as Route} className="button-ghost">
                  Pricing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <section className="surface-elevated border border-red-500/30 bg-red-500/10 px-5 py-4 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-red-300">
            Search Error
          </p>
          <p className="mt-2 text-sm leading-6 text-red-200">{error}</p>
        </section>
      ) : null}

      {response ? (
        <>
          <SearchMetadata response={response} isLoading={isLoading} />
          <SearchAnswer answer={response.answer} mode={response.mode} />
          <SearchResults
            isLoading={isLoading}
            mode={response.mode}
            query={response.query}
            results={response.results}
          />
        </>
      ) : isLoading ? (
        <section className="space-y-4">
          <div className="surface-elevated px-5 py-4 sm:px-6">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Loading Demo
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
              Running the seeded knowledge query so the demo page lands with real output.
            </p>
          </div>
          <LoadingSkeleton />
        </section>
      ) : (
        <section className="surface-elevated px-5 py-8 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Demo Unavailable
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--foreground-secondary)]">
            The seeded search did not complete. Retry the current query or switch to
            another mode to continue exploring the demo surface.
          </p>
          <button
            type="button"
            className="button-primary mt-5"
            onClick={() => void runSearch(activeMode, query)}
          >
            Retry search
          </button>
        </section>
      )}
    </div>
  );
}
