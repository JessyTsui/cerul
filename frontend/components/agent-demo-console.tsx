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
    <section className="surface overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Live product rhythm
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Direct manipulation before prose.
          </h2>
        </div>
        <span className="rounded-full border border-[var(--line)] bg-white/72 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-deep)]">
          Mock API wired
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {Object.entries(demoModes).map(([key, item]) => (
          <button
            key={key}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              key === activeMode
                ? "border-transparent bg-[var(--surface-dark)] text-white"
                : "border-[var(--line)] bg-white/72 text-[var(--muted)]"
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

      <form
        className="mt-6 rounded-[26px] border border-[var(--line)] bg-white/82 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runPreview(activeMode, query);
        }}
      >
        <label className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
          Query composer
        </label>
        <textarea
          aria-label="Query composer"
          className="mt-3 min-h-[120px] w-full resize-none rounded-[22px] border border-[var(--line)] bg-transparent px-4 py-4 text-base outline-none ring-0 placeholder:text-slate-400 focus:border-[rgba(10,142,216,0.25)]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {mode.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-900/5 px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] text-[var(--muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/docs" className="button-secondary">
              API shape
            </Link>
            <button type="submit" className="button-primary">
              {isPending ? "Running preview" : "Run preview"}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[22px] border border-[var(--line)] bg-white/74 px-4 py-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Surface
          </p>
          <p className="mt-3 text-lg font-semibold">{mode.surface}</p>
        </div>
        <div className="rounded-[22px] border border-[var(--line)] bg-white/74 px-4 py-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Output
          </p>
          <p className="mt-3 text-lg font-semibold">{mode.output}</p>
        </div>
        <div className="rounded-[22px] border border-[var(--line)] bg-white/74 px-4 py-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Active input
          </p>
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
            {deferredQuery}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-[26px] border border-[var(--line)] bg-white/78 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Preview response
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {response
                ? `Request ${response.requestId} returned in ${response.latencyMs}ms.`
                : "Running the first preview request."}
            </p>
          </div>
          {response ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-900/5 px-3 py-1 font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                {response.creditsUsed} credits
              </span>
              <span className="rounded-full bg-slate-900/5 px-3 py-1 font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                {response.creditsRemaining} remaining
              </span>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-[18px] bg-rose-100 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {response ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              {response.answer ? (
                <div className="rounded-[20px] border border-[var(--line)] bg-white/84 px-4 py-4">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    Model-facing answer
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                    {response.answer}
                  </p>
                </div>
              ) : null}

              <div className="rounded-[20px] border border-[var(--line)] bg-white/84 px-4 py-4">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  Diagnostics
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
                  {response.diagnostics.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              {response.results.map((result) => (
                <article
                  key={result.id}
                  className="rounded-[20px] border border-[var(--line)] bg-white/84 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold tracking-tight">{result.title}</p>
                      <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                        {result.source}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                      {result.score}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    {result.detail}
                  </p>
                  <div className="mt-4">
                    <Link href={result.href as Route} className="button-secondary">
                      Open related guide
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
