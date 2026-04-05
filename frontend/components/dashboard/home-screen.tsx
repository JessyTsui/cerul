"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiKeys, getApiErrorMessage, type DashboardApiKey } from "@/lib/api";
import { formatNumber, getTierLabel } from "@/lib/dashboard";
import { ApiKeyRow } from "./api-key-row";
import { CreateKeyDialog } from "./create-key-dialog";
import { DashboardLayout } from "./dashboard-layout";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "./dashboard-state";
import { useMonthlyUsage } from "./use-monthly-usage";

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <path d="M13.5 2.75 6.75 13.5h4.5l-.75 7.75 6.75-10.75h-4.5l.75-7.75Z" fill="currentColor" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

export function DashboardHomeScreen() {
  const searchParams = useSearchParams();
  const { data, error, isLoading, refresh } = useMonthlyUsage();
  const [keys, setKeys] = useState<DashboardApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);

  async function loadKeys() {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const items = await apiKeys.list();
      setKeys([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3));
    } catch (nextError) {
      setKeysError(getApiErrorMessage(nextError, "Failed to load API keys."));
    } finally {
      setKeysLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    if (checkoutState === "success") {
      setCheckoutNotice("Payment completed successfully.");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("checkout");
      nextUrl.searchParams.delete("session_id");
      nextUrl.searchParams.delete("type");
      window.history.replaceState({}, "", nextUrl.pathname);
    }
  }, [searchParams]);

  async function handleRevoke(apiKey: DashboardApiKey) {
    if (!apiKey.isActive) return;
    const confirmed = window.confirm(`Revoke "${apiKey.name}"?`);
    if (!confirmed) return;
    setPendingKeyId(apiKey.id);
    try {
      await apiKeys.revoke(apiKey.id);
      await Promise.all([loadKeys(), refresh()]);
    } catch (nextError) {
      setKeysError(getApiErrorMessage(nextError, "Failed to revoke API key."));
    } finally {
      setPendingKeyId(null);
    }
  }

  if (isLoading && !data) {
    return (
      <DashboardLayout currentPath="/dashboard" title="Home">
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout currentPath="/dashboard" title="Home">
        <DashboardState
          title="Unable to load dashboard"
          description={error}
          tone="error"
          action={<button className="button-primary" onClick={() => void refresh()}>Retry</button>}
        />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout currentPath="/dashboard" title="Home">
        <DashboardState title="No data available" description="Dashboard data is not available right now." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      currentPath="/dashboard"
      title="Home"
      description={`${getTierLabel(data.tier)} plan`}
    >
      <CreateKeyDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={() => void loadKeys()}
      />

      {checkoutNotice && (
        <DashboardNotice title="Success" description={checkoutNotice} tone="success" />
      )}
      {keysError && (
        <DashboardNotice title="API key action failed" description={keysError} tone="error" />
      )}

      {/* Hero: Credit Balance */}
      <section className="py-8">
        <div className="flex items-baseline gap-3">
          <span className="text-7xl font-semibold tracking-tight text-[var(--foreground)]">
            {formatNumber(data.walletBalance)}
          </span>
          <span className="text-lg text-[var(--foreground-secondary)]">credits</span>
        </div>
        <div className="mt-4 flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <IconBolt className="h-4 w-4 text-[var(--brand)]" />
            <span className="text-[var(--foreground-secondary)]">
              {formatNumber(data.dailyFreeRemaining)} free today
            </span>
          </div>
          <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
          <span className="text-[var(--foreground-secondary)]">
            {formatNumber(data.requestCount)} requests this period
          </span>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-[var(--border)]" />

      {/* API Keys Section */}
      <section className="py-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-[var(--foreground)]">API Keys</h2>
            <p className="text-xs text-[var(--foreground-tertiary)] mt-0.5">
              {keys.filter(k => k.isActive).length} active
            </p>
          </div>
          <button
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--background-elevated)]"
          >
            <IconPlus className="h-4 w-4" />
            New
          </button>
        </div>

        {keys.length === 0 && !keysLoading ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
            <p className="text-sm text-[var(--foreground-secondary)]">No API keys yet</p>
            <button
              onClick={() => setIsDialogOpen(true)}
              className="mt-2 text-sm text-[var(--brand)] hover:underline"
            >
              Create your first key
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-1">
            {keys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                isPending={pendingKeyId === key.id}
                onRevoke={handleRevoke}
                compact
                isLastKey={keys.filter((item) => item.isActive).length <= 1}
              />
            ))}
          </div>
        )}

        {keys.length > 0 && (
          <a
            href="/dashboard/keys"
            className="mt-3 inline-block text-xs text-[var(--foreground-tertiary)] hover:text-[var(--foreground)]"
          >
            View all keys →
          </a>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-[var(--border)]" />

      {/* Quick Links */}
      <section className="py-6">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Quick Links</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Documentation", href: "/docs" },
            { label: "API Reference", href: "/docs/api-reference" },
            { label: "Pricing", href: "/pricing" },
            { label: "Analytics", href: "/dashboard/usage" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>
    </DashboardLayout>
  );
}
