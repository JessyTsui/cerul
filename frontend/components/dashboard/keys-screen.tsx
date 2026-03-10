"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  apiKeys,
  getApiErrorMessage,
  type DashboardApiKey,
} from "@/lib/api";
import { formatNumber } from "@/lib/dashboard";
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";

export function DashboardKeysScreen() {
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);

  async function loadKeys(options?: { preserveData?: boolean }) {
    if (!options?.preserveData) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const items = await apiKeys.list();
      setKeys(
        [...items].sort((itemA, itemB) =>
          itemB.createdAt.localeCompare(itemA.createdAt),
        ),
      );
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to load API keys."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function handleRevoke(apiKey: DashboardApiKey) {
    if (!apiKey.isActive) {
      return;
    }

    const confirmed = window.confirm(
      `Revoke "${apiKey.name}"? Existing integrations using this key will stop working immediately.`,
    );

    if (!confirmed) {
      return;
    }

    setPendingKeyId(apiKey.id);
    setError(null);

    try {
      await apiKeys.revoke(apiKey.id);
      await loadKeys({ preserveData: true });
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to revoke API key."));
    } finally {
      setPendingKeyId(null);
    }
  }

  const activeKeyCount = keys.filter((item) => item.isActive).length;

  return (
    <DashboardLayout
      actions={
        <>
          <Link className="button-secondary" href="/docs/usage-api">
            Usage guide
          </Link>
          <button
            className="button-primary"
            onClick={() => setIsDialogOpen(true)}
            type="button"
          >
            Create key
          </button>
        </>
      }
      currentPath="/dashboard/keys"
      description="Create session-scoped API keys, review last-used timestamps, and revoke credentials without exposing hashes or widening auth scope."
      title="API Keys"
    >
      <CreateKeyDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={async () => {
          await loadKeys({ preserveData: true });
        }}
      />

      {error && keys.length > 0 ? (
        <DashboardNotice
          description={error}
          title="The key list could not be refreshed."
          tone="error"
        />
      ) : null}

      {isLoading && keys.length === 0 ? (
        <DashboardSkeleton />
      ) : error && keys.length === 0 ? (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void loadKeys()} type="button">
              Retry request
            </button>
          }
          description={error}
          title="API keys could not be loaded"
          tone="error"
        />
      ) : keys.length === 0 ? (
        <DashboardState
          action={
            <button
              className="button-primary"
              onClick={() => setIsDialogOpen(true)}
              type="button"
            >
              Create your first key
            </button>
          }
          description="No API keys have been created for this account yet. Keys are shown once at creation time and then only their metadata remains visible."
          title="No API keys yet"
        />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {[
              {
                label: "Total keys",
                value: formatNumber(keys.length),
                note: "Historical inventory, including revoked entries.",
              },
              {
                label: "Active keys",
                value: formatNumber(activeKeyCount),
                note: "Keys still accepted by the backend dashboard API.",
              },
              {
                label: "Revoked keys",
                value: formatNumber(keys.length - activeKeyCount),
                note: "Retained for operator visibility and audit context.",
              },
            ].map((item) => (
              <article key={item.label} className="surface px-5 py-5">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">{item.value}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                  {item.note}
                </p>
              </article>
            ))}
          </section>

          <section className="surface-elevated overflow-hidden">
            <div className="border-b border-[var(--border)] px-6 py-5">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Key inventory
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Current dashboard credentials
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--surface)]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                      Name
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                      Created
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                      Last used
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--foreground-secondary)]">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--foreground-secondary)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((apiKey) => (
                    <ApiKeyRow
                      apiKey={apiKey}
                      isPending={pendingKeyId === apiKey.id}
                      key={apiKey.id}
                      onRevoke={handleRevoke}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
