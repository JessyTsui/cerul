import { formatNumber, getCreditsPercent } from "@/lib/dashboard";

type CreditUsageBarProps = {
  used: number;
  limit: number;
  remaining?: number;
  label?: string;
};

export function CreditUsageBar({
  used,
  limit,
  remaining,
  label = "Credit usage",
}: CreditUsageBarProps) {
  const safeRemaining =
    remaining ?? Math.max(0, limit - used);
  const percentUsed = getCreditsPercent(used, limit);

  return (
    <div className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {formatNumber(used)}
            <span className="text-lg text-[var(--foreground-secondary)]">
              {" "}
              / {formatNumber(limit)}
            </span>
          </p>
        </div>
        <span className="badge badge-success">{percentUsed}% used</span>
      </div>

      <div
        aria-label={`${percentUsed}% of credits used`}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={used}
        className="chart-bar mt-5 h-3"
        role="progressbar"
      >
        <span style={{ width: `${percentUsed}%` }} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[18px] bg-[var(--surface-elevated)] px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Used
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {formatNumber(used)} credits
          </p>
        </div>
        <div className="rounded-[18px] bg-[var(--surface-elevated)] px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Remaining
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {formatNumber(safeRemaining)} credits
          </p>
        </div>
      </div>
    </div>
  );
}
