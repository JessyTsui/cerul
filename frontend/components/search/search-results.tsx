import type { DemoMode, DemoSearchResult } from "@/lib/demo-api";
import { SearchResultCard } from "./search-result-card";

type SearchResultsProps = {
  isLoading: boolean;
  mode: DemoMode;
  query: string;
  results: DemoSearchResult[];
};

const resultHeadingByMode: Record<DemoMode, string> = {
  knowledge: "Evidence Matches",
  broll: "B-roll Matches",
  agent: "Agent-Ready Evidence",
};

export function SearchResults({
  isLoading,
  mode,
  query,
  results,
}: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <section className="surface-elevated px-5 py-8 text-center sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
          No Results
        </p>
        <p className="mt-3 text-base leading-7 text-[var(--foreground-secondary)]">
          Try another query or switch to a different search mode.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{resultHeadingByMode[mode]}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            {results.length} result{results.length === 1 ? "" : "s"} for &quot;{query}&quot;
          </h2>
        </div>
        {isLoading ? (
          <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
            Refreshing
          </span>
        ) : null}
      </div>

      <div
        className={
          mode === "broll"
            ? "grid gap-4 md:grid-cols-2"
            : "grid gap-4"
        }
      >
        {results.map((result, index) => (
          <SearchResultCard
            key={result.id}
            mode={mode}
            rank={index + 1}
            result={result}
          />
        ))}
      </div>
    </section>
  );
}
