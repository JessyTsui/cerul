"use client";

import { useEffect, useState } from "react";
import { apiKeys, getApiErrorMessage, type DashboardApiKey } from "@/lib/api";
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

export function DashboardKeysScreen() {
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const { refresh: refreshUsage } = useMonthlyUsage();

  async function loadKeys(options?: { preserveData?: boolean }) {
    if (!options?.preserveData) setIsLoading(true);
    setError(null);
    try {
      const items = await apiKeys.list();
      setKeys([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to load API keys."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadKeys(); }, []);

  async function handleRevoke(apiKey: DashboardApiKey) {
    if (!apiKey.isActive) return;
    const confirmed = window.confirm(
      `Revoke "${apiKey.name}"? Existing integrations using this key will stop working immediately.`,
    );
    if (!confirmed) return;
    setPendingKeyId(apiKey.id);
    setError(null);
    try {
      await apiKeys.revoke(apiKey.id);
      await Promise.all([loadKeys({ preserveData: true }), refreshUsage()]);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to revoke API key."));
    } finally {
      setPendingKeyId(null);
    }
  }

  return (
    <DashboardLayout
      currentPath="/dashboard/keys"
      title="API Keys"
      description="Plaintext keys stay masked by default and auto-hide after reveal."
      actions={
        <button type="button" className="button-primary" onClick={() => setIsDialogOpen(true)}>
          + New Key
        </button>
      }
    >
      <CreateKeyDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={async () => {
          await Promise.all([loadKeys({ preserveData: true }), refreshUsage()]);
        }}
      />

      {error && keys.length > 0 && (
        <DashboardNotice
          title="Key list could not be refreshed."
          description={error}
          tone="error"
        />
      )}

      {isLoading && keys.length === 0 ? (
        <DashboardSkeleton />
      ) : error && keys.length === 0 ? (
        <DashboardState
          title="API keys could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void loadKeys()} type="button">
              Retry
            </button>
          }
        />
      ) : keys.length === 0 ? (
        <DashboardState
          title="No API keys yet"
          description="Create your first key to start authenticating requests against the public API."
          action={
            <button className="button-primary" onClick={() => setIsDialogOpen(true)} type="button">
              Create your first key
            </button>
          }
        />
      ) : (
        <section className="surface-elevated overflow-hidden rounded-[24px]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[rgba(255,255,255,0.03)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--foreground-tertiary)]">
                <tr>
                  <th className="px-5 py-4">Name</th>
                  <th className="px-5 py-4">Key</th>
                  <th className="px-5 py-4">Created</th>
                  <th className="px-5 py-4">Last used</th>
                  <th className="px-5 py-4 text-right">Options</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((apiKey) => (
                  <ApiKeyRow
                    key={apiKey.id}
                    apiKey={apiKey}
                    isPending={pendingKeyId === apiKey.id}
                    onRevoke={handleRevoke}
                    isLastKey={keys.filter((k) => k.isActive).length <= 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </DashboardLayout>
  );
}
