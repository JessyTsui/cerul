"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  apiKeys,
  getApiErrorMessage,
  type DashboardApiKey,
} from "@/lib/api";
import { formatDashboardDateTime, formatNumber } from "@/lib/dashboard";
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import {
  DashboardNotice,
  DashboardSkeleton,
  DashboardState,
} from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

export function DashboardKeysScreen() {
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const { refresh: refreshUsage } = useMonthlyUsage();

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
      await Promise.all([
        loadKeys({ preserveData: true }),
        refreshUsage(),
      ]);
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to revoke API key."));
    } finally {
      setPendingKeyId(null);
    }
  }

  const activeKeyCount = keys.filter((item) => item.isActive).length;
  const featuredKey = keys.find((item) => item.isActive) ?? keys[0] ?? null;
  const latestCreatedKey = keys[0] ?? null;
  const latestUsedKey =
    [...keys]
      .filter((item) => item.lastUsedAt)
      .sort((itemA, itemB) =>
        (itemB.lastUsedAt ?? "").localeCompare(itemA.lastUsedAt ?? ""),
      )[0] ?? null;

  return (
    <DashboardLayout
      currentPath="/dashboard/keys"
      title="API Keys"
      description="Manage your API credentials and permissions from one workspace surface."
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
          await Promise.all([
            loadKeys({ preserveData: true }),
            refreshUsage(),
          ]);
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
          <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <article className="surface-elevated relative overflow-hidden rounded-[36px] px-6 py-6 sm:px-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.16),transparent_34%),radial-gradient(circle_at_84%_20%,rgba(249,115,22,0.12),transparent_28%)]" />
              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  {[
                    `${formatNumber(activeKeyCount)} active`,
                    `${formatNumber(keys.length - activeKeyCount)} revoked`,
                    featuredKey ? `Lead key ${featuredKey.prefix}` : "No live key yet",
                    "Secrets shown once",
                  ].map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-sm text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                      Credential runway
                    </p>
                    <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">
                      Treat keys like environment boundaries, not shared secrets.
                    </h2>
                    <p className="mt-4 max-w-xl text-base leading-8 text-[var(--foreground-secondary)]">
                      This page should stay boring and explicit. Issue a key per
                      integration surface, rotate when ownership changes, and keep
                      revoked credentials visible so the audit trail survives.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      {
                        title: featuredKey ? "Issue another key" : "Create first key",
                        body: featuredKey
                          ? "Split production, staging, and local flows cleanly."
                          : "The raw secret is only returned once after creation.",
                      },
                      {
                        title: "Rotation posture",
                        body: activeKeyCount > 1
                          ? "Healthy spread across multiple active credentials."
                          : activeKeyCount === 1
                            ? "Only one live key. Rotation would currently be risky."
                            : "No active key. Integration traffic will not authenticate.",
                      },
                      {
                        title: "Latest activity",
                        body: latestUsedKey
                          ? `${latestUsedKey.name} was used ${formatDashboardDateTime(
                              latestUsedKey.lastUsedAt,
                            )}.`
                          : "No request activity recorded against any key yet.",
                      },
                      {
                        title: "Inventory visibility",
                        body: "Revoked entries stay listed so admins can trace which key was retired and when.",
                      },
                    ].map((item) => (
                      <div
                        key={item.title}
                        className="rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-4 py-4"
                      >
                        <p className="text-base font-semibold text-white">{item.title}</p>
                        <p className="mt-3 text-sm leading-6 text-[var(--foreground-secondary)]">
                          {item.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <div className="space-y-6">
              <article className="surface-elevated rounded-[32px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Rotation posture
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  {[
                    {
                      label: "Newest key",
                      value: latestCreatedKey?.name ?? "No key yet",
                      note: latestCreatedKey
                        ? formatDashboardDateTime(latestCreatedKey.createdAt)
                        : "Create the first credential to start authenticating requests.",
                    },
                    {
                      label: "Last request",
                      value: latestUsedKey?.name ?? "No traffic yet",
                      note: latestUsedKey?.lastUsedAt
                        ? formatDashboardDateTime(latestUsedKey.lastUsedAt)
                        : "Usage will appear after the first authenticated call.",
                    },
                    {
                      label: "Active inventory",
                      value: formatNumber(activeKeyCount),
                      note: "Credentials currently accepted by the backend.",
                    },
                    {
                      label: "Revoked retained",
                      value: formatNumber(keys.length - activeKeyCount),
                      note: "Historical visibility kept for workspace context.",
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                    >
                      <p className="text-sm text-[var(--foreground-secondary)]">{item.label}</p>
                      <p className="mt-2 text-xl font-semibold text-white">{item.value}</p>
                      <p className="mt-2 text-sm leading-6 text-[var(--foreground-tertiary)]">
                        {item.note}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="surface-elevated rounded-[32px] px-5 py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  Handling model
                </p>
                <div className="mt-5 space-y-3">
                  {[
                    "Create separate keys for each app, environment, or automation.",
                    "Store raw secrets in a vault or deploy secret manager immediately.",
                    "Revoke stale keys instead of renaming or repurposing them.",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-sm leading-6 text-[var(--foreground-secondary)]"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </article>
            </div>
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
              <div className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Key Inventory</h2>
                  <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                    Stable visibility across live and revoked workspace credentials.
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                  Raw secrets are never shown again
                </span>
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

          <section className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <p className="eyebrow">Recommended workflow</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
                Build a clean key lifecycle
              </h2>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  {
                    step: "01",
                    title: "Issue per environment",
                    description: "Production, staging, and local work should never share one secret.",
                  },
                  {
                    step: "02",
                    title: "Record ownership",
                    description: "Use descriptive names so the right key gets revoked when a surface changes hands.",
                  },
                  {
                    step: "03",
                    title: "Rotate deliberately",
                    description: "Create the replacement before revoking the old credential to avoid downtime.",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                      {item.step}
                    </span>
                    <p className="mt-3 text-lg font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article className="surface-elevated rounded-[32px] px-6 py-6">
              <p className="eyebrow">Resources</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
                Keep docs close to the key inventory
              </h2>
              <div className="mt-6 space-y-3">
                {[
                  {
                    title: "API reference",
                    description: "Wire the key into the live request contract and sample payloads.",
                    href: "/docs/api-reference" as Route,
                  },
                  {
                    title: "Usage semantics",
                    description: "Review how requests and credits are counted before shipping into production.",
                    href: "/docs/usage-api" as Route,
                  },
                ].map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="block rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-4 py-4 transition hover:border-[var(--border-brand)] hover:bg-[rgba(34,211,238,0.06)]"
                  >
                    <p className="text-base font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground-secondary)]">
                      {item.description}
                    </p>
                  </Link>
                ))}
              </div>
            </article>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
