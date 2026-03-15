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
      currentPath="/dashboard/keys"
      title="API Keys"
      description="Manage your API credentials and permissions from one operator surface."
      actions={
        <button
          type="button"
          className="button-primary"
          onClick={() => setIsDialogOpen(true)}
        >
          + Create New Key
        </button>
      }
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
          title="The key list could not be refreshed."
          description={error}
          tone="error"
        />
      ) : null}

      {isLoading && keys.length === 0 ? (
        <DashboardSkeleton />
      ) : error && keys.length === 0 ? (
        <DashboardState
          title="API keys could not be loaded"
          description={error}
          tone="error"
          action={
            <button className="button-primary" onClick={() => void loadKeys()} type="button">
              Retry request
            </button>
          }
        />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {[
              { label: "Total keys", value: formatNumber(keys.length), note: "Full credential inventory" },
              { label: "Active keys", value: formatNumber(activeKeyCount), note: "Currently accepted by the backend" },
              { label: "Revoked keys", value: formatNumber(keys.length - activeKeyCount), note: "Retained for audit visibility" },
            ].map((item) => (
              <article key={item.label} className="surface-elevated rounded-[24px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-3 text-4xl font-semibold text-white">{item.value}</p>
                <p className="mt-2 text-sm text-[var(--foreground-secondary)]">{item.note}</p>
              </article>
            ))}
          </section>

          {keys.length === 0 ? (
            <DashboardState
              title="No API keys yet"
              description="Create your first key to start authenticating requests against the public API."
              action={
                <button
                  className="button-primary"
                  onClick={() => setIsDialogOpen(true)}
                  type="button"
                >
                  Create your first key
                </button>
              }
            />
          ) : (
            <section className="surface-elevated overflow-hidden rounded-[28px]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Key Inventory</h2>
                  <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                    Manage your API credentials and permissions
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[rgba(255,255,255,0.03)] text-white">
                    <tr>
                      <th className="px-4 py-4 font-medium">Key Name</th>
                      <th className="px-4 py-4 font-medium">Key Preview</th>
                      <th className="px-4 py-4 font-medium">Created</th>
                      <th className="px-4 py-4 font-medium">Last Used</th>
                      <th className="px-4 py-4 font-medium">Permissions</th>
                      <th className="px-4 py-4 font-medium">Status</th>
                      <th className="px-4 py-4 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((apiKey) => (
                      <ApiKeyRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        isPending={pendingKeyId === apiKey.id}
                        onRevoke={handleRevoke}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <article className="surface-elevated rounded-[28px] px-5 py-5">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white">Security Notice</h2>
                  <p className="mt-3 text-base leading-8 text-[var(--foreground-secondary)]">
                    For enhanced security, regularly rotate your API keys. Avoid sharing
                    secrets in plain text and generate fresh credentials whenever an
                    integration surface changes.
                  </p>
                </div>
              </div>
            </article>

            <article className="surface-elevated rounded-[28px] px-5 py-5">
              <h2 className="text-2xl font-semibold text-white">Quick Actions</h2>
              <div className="mt-5 space-y-3">
                <Link href="/docs/api-reference" className="button-secondary w-full">
                  API Key Documentation
                </Link>
                <Link href="/docs/usage-api" className="button-secondary w-full">
                  Permission Guide
                </Link>
              </div>
            </article>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
