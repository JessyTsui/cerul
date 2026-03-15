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
      <td className="px-4 py-4 text-white">{apiKey.name}</td>
      <td className="px-4 py-4 font-mono text-sm text-white">{apiKey.prefix}</td>
      <td className="px-4 py-4">{formatDashboardDateTime(apiKey.createdAt)}</td>
      <td className="px-4 py-4">{formatDashboardDateTime(apiKey.lastUsedAt)}</td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--brand-subtle)] px-3 py-1 text-xs text-[var(--brand-bright)]">
            Default
          </span>
          <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-3 py-1 text-xs text-[var(--foreground-secondary)]">
            Session-created
          </span>
        </div>
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            apiKey.isActive
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-white/8 text-[var(--foreground-secondary)]"
          }`}
        >
          {statusLabel}
        </span>
      </td>
      <td className="px-4 py-4 text-right">
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
