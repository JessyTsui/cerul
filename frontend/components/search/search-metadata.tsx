import type { DemoSearchResponse } from "@/lib/demo-api";

type SearchMetadataProps = {
  response: DemoSearchResponse;
  isLoading: boolean;
};

type MetadataItem = {
  label: string;
  value: string;
  monospace?: boolean;
};

const metadataItems = (response: DemoSearchResponse): MetadataItem[] => [
  {
    label: "Latency",
    value: `${response.latencyMs}ms`,
  },
  {
    label: "Credits Used",
    value: response.creditsUsed.toString(),
  },
  {
    label: "Credits Remaining",
    value: response.creditsRemaining.toString(),
  },
  {
    label: "Request ID",
    value: response.requestId,
    monospace: true,
  },
];

export function SearchMetadata({ response, isLoading }: SearchMetadataProps) {
  return (
    <section className="surface-elevated px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Request Metadata</p>
          <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
            Search response details for the current public demo request.
          </p>
        </div>
        {isLoading ? (
          <span className="badge badge-success w-fit">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
            Refreshing results
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metadataItems(response).map((item) => (
          <article
            key={item.label}
            className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              {item.label}
            </p>
            <p
              className={`mt-3 break-all text-xl font-semibold text-white ${
                item.monospace ? "font-mono text-base sm:text-lg" : "font-mono"
              }`}
            >
              {item.value}
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
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                signal
              </span>
              <p className="mt-2 text-sm text-[var(--foreground-secondary)]">{item}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
