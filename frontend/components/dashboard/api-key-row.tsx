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
    <tr className="border-t border-[var(--border)] bg-[var(--background-elevated)]">
      <td className="px-4 py-4 align-top">
        <p className="font-semibold text-white">{apiKey.name}</p>
        <p className="mt-2 font-mono text-xs text-[var(--foreground-tertiary)]">
          {apiKey.prefix}
        </p>
      </td>
      <td className="px-4 py-4 align-top text-sm text-[var(--foreground-secondary)]">
        {formatDashboardDateTime(apiKey.createdAt)}
      </td>
      <td className="px-4 py-4 align-top text-sm text-[var(--foreground-secondary)]">
        {formatDashboardDateTime(apiKey.lastUsedAt)}
      </td>
      <td className="px-4 py-4 align-top">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            apiKey.isActive
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-white/8 text-[var(--foreground-secondary)]"
          }`}
        >
          {statusLabel}
        </span>
      </td>
      <td className="px-4 py-4 align-top text-right">
        <button
          className="button-secondary min-w-[120px]"
          disabled={isPending || !apiKey.isActive}
          onClick={() => onRevoke(apiKey)}
          type="button"
        >
          {isPending ? "Revoking..." : "Revoke"}
        </button>
      </td>
    </tr>
  );
}
