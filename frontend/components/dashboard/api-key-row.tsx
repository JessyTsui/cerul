import type { DashboardApiKey } from "@/lib/api";
import {
  formatDashboardDateTime,
  getApiKeyStatusLabel,
} from "@/lib/dashboard";

type ApiKeyRowProps = {
  apiKey: DashboardApiKey;
  isPending: boolean;
  onRevoke: (apiKey: DashboardApiKey) => void;
};

export function ApiKeyRow({
  apiKey,
  isPending,
  onRevoke,
}: ApiKeyRowProps) {
  const statusLabel = getApiKeyStatusLabel(apiKey);

  return (
    <tr className="border-t border-[var(--border)] text-[var(--foreground-secondary)]">
      <td className="px-5 py-4">
        <div>
          <p className="font-medium text-[var(--foreground)]">{apiKey.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-2.5 py-1 text-[11px] text-[var(--brand-bright)]">
              Default
            </span>
            <span className="rounded-full border border-[var(--border)] bg-white/72 px-2.5 py-1 text-[11px] text-[var(--foreground-tertiary)]">
              Session-created
            </span>
          </div>
        </div>
      </td>
      <td className="px-5 py-4 font-mono text-sm text-[var(--foreground)]">{apiKey.prefix}</td>
      <td className="px-5 py-4">{formatDashboardDateTime(apiKey.createdAt)}</td>
      <td className="px-5 py-4">{formatDashboardDateTime(apiKey.lastUsedAt)}</td>
      <td className="px-5 py-4">
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
            apiKey.isActive
              ? "border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]"
              : "border-[var(--border)] bg-white/72 text-[var(--foreground-tertiary)]"
          }`}
        >
          {statusLabel}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        <button
          type="button"
          onClick={() => onRevoke(apiKey)}
          disabled={isPending || !apiKey.isActive}
          className="button-secondary min-w-[120px]"
        >
          {isPending ? "Revoking..." : apiKey.isActive ? "Revoke" : "Revoked"}
        </button>
      </td>
    </tr>
  );
}
