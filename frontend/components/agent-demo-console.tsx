"use client";

import type { Route } from "next";
import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { DemoMode, DemoSearchResponse } from "@/lib/demo-api";
import { demoModes } from "@/lib/site";

async function fetchDemoPreview(
  mode: DemoMode,
  query: string,
): Promise<DemoSearchResponse> {
  const previewResponse = await fetch("/api/demo/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode,
      query,
    }),
  });

  if (!previewResponse.ok) {
    throw new Error("Preview request failed");
  }

  return (await previewResponse.json()) as DemoSearchResponse;
}

export function AgentDemoConsole() {
  const [activeMode, setActiveMode] = useState<DemoMode>("knowledge");
  const [query, setQuery] = useState<string>(demoModes.knowledge.query);
  const [response, setResponse] = useState<DemoSearchResponse | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const mode = demoModes[activeMode];

  async function runPreview(nextMode: DemoMode, nextQuery: string) {
    setIsPending(true);
    setError(null);

    try {
      setResponse(await fetchDemoPreview(nextMode, nextQuery));
    } catch {
      setError("Preview request failed. The mock API did not respond as expected.");
    } finally {
      setIsPending(false);
    }
  }

  useEffect(() => {
    void runPreview("knowledge", demoModes.knowledge.query);
  }, []);

  return (
    <section className="gradient-border overflow-hidden p-[1px]">
      <div className="rounded-[15px] bg-[#0a0a0f] p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--brand-bright)]">
              Interactive Demo
            </p>
            <h2 className="mt-2 text-xl font-bold text-white sm:text-2xl">
              Try the API live
            </h2>
          </div>
          <span className="badge badge-success w-fit">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
            Mock API Connected
          </span>
        </div>

        {/* Mode selector */}
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.entries(demoModes).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                key === activeMode
                  ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => {
                const nextMode = key as DemoMode;
                const nextQuery = demoModes[nextMode].query;

                startTransition(() => {
                  setActiveMode(nextMode);
                  setQuery(nextQuery);
                });

                void runPreview(nextMode, nextQuery);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Query composer */}
        <form
          className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void runPreview(activeMode, query);
          }}
        >
          <label className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
            Query
          </label>
          <textarea
            aria-label="Query composer"
            className="mt-3 min-h-[100px] w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-base text-white outline-none ring-0 transition-all placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {mode.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--surface-elevated)] px-3 py-1 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-secondary)]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/docs" className="button-secondary">
                View API Docs
              </Link>
              <button type="submit" className="button-primary" disabled={isPending}>
                {isPending ? (
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
                    Running...
                  </>
                ) : (
                  "Run Preview"
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Info cards */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Surface
            </p>
            <p className="mt-2 font-semibold text-white">{mode.surface}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Output
            </p>
            <p className="mt-2 font-semibold text-white">{mode.output}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
              Active Input
            </p>
            <p className="mt-2 line-clamp-2 text-sm text-[var(--foreground-secondary)]">
              {deferredQuery}
            </p>
          </div>
        </div>

        {/* Response section */}
        <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                Response
              </p>
              <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                {response
                  ? `Request ${response.requestId} completed in ${response.latencyMs}ms`
                  : "Running initial preview request..."}
              </p>
            </div>
            {response ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-[var(--surface-elevated)] px-3 py-1 font-mono text-[var(--foreground-secondary)]">
                  {response.creditsUsed} credits
                </span>
                <span className="rounded-full bg-[var(--surface-elevated)] px-3 py-1 font-mono text-[var(--foreground-secondary)]">
                  {response.creditsRemaining} remaining
                </span>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : null}

          {response ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                {response.answer ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
                    <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--brand-bright)]">
                      Answer
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-white">
                      {response.answer}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
                  <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                    Diagnostics
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-[var(--foreground-secondary)]">
                    {response.diagnostics.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="space-y-3">
                {response.results.map((result) => (
                  <article
                    key={result.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-4 transition-all hover:border-[var(--border-strong)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{result.title}</p>
                        <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-[var(--foreground-tertiary)]">
                          {result.source}
                        </p>
                      </div>
                      <span className="rounded-full bg-[var(--accent-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-bright)]">
                        {result.score}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                      {result.detail}
                    </p>
                    <div className="mt-4">
                      <Link href={result.href as Route} className="button-ghost text-xs">
                        Open guide →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
