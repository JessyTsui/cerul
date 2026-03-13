"use client";

import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime, topCountLabel } from "@/lib/admin-console";
import { AdminLayout } from "./admin-layout";
import { AdminMetricCard } from "./admin-metric-card";
import { AdminRangePicker } from "./admin-range-picker";
import { AdminTrendChart } from "./admin-trend-chart";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

export function AdminUsersScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getUsers,
    errorMessage: "Failed to load admin user metrics.",
  });

  return (
    <AdminLayout
      currentPath="/admin/users"
      title="Users"
      description="Inspect account growth, role distribution, and which workspaces are actually using the product."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <button className="button-primary" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </>
      }
    >
      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description={error}
          title="User metrics could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing the last successful user snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard
              label="Total users"
              metric={data.metrics.totalUsers}
              note="All accounts in the primary Cerul user table."
            />
            <AdminMetricCard
              label="New users"
              metric={data.metrics.newUsers}
              note="Created inside the selected reporting window."
            />
            <AdminMetricCard
              label="Active users"
              metric={data.metrics.activeUsers}
              note="Distinct accounts with request traffic."
            />
            <AdminMetricCard
              label="Active API keys"
              metric={data.metrics.activeApiKeys}
              note="Current key posture across all accounts."
            />
          </section>

          <AdminTrendChart
            title="Signup cadence"
            description={`Top tier mix right now: ${topCountLabel(data.tiers)}. This view helps you separate “accounts created” from “accounts actually using Cerul.”`}
            data={data.dailySignups.map((point) => ({
              date: point.key,
              shortLabel: point.label.slice(5),
              fullLabel: point.label,
              primaryValue: point.count,
            }))}
            metricLabel="Signups"
          />

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Tier distribution
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Plan mix
              </h2>
              <div className="mt-5 space-y-3">
                {data.tiers.map((tier) => (
                  <div
                    key={tier.key}
                    className="flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                  >
                    <span className="text-sm text-white">{tier.label}</span>
                    <span className="font-mono text-sm text-[var(--foreground-secondary)]">
                      {tier.count}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="surface-elevated px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Console roles
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Access posture
              </h2>
              <div className="mt-5 space-y-3">
                {data.consoleRoles.map((role) => (
                  <div
                    key={role.key}
                    className="flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                  >
                    <span className="text-sm text-white">{role.label}</span>
                    <span className="font-mono text-sm text-[var(--foreground-secondary)]">
                      {role.count}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Recent users
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Latest signups
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Email</th>
                      <th className="pb-3 pr-4 font-medium">Tier</th>
                      <th className="pb-3 pr-4 font-medium">Role</th>
                      <th className="pb-3 pr-4 font-medium">Keys</th>
                      <th className="pb-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.recentUsers.map((user) => (
                      <tr key={user.userId}>
                        <td className="py-3 pr-4 text-white">{user.email ?? user.userId}</td>
                        <td className="py-3 pr-4">{user.tier}</td>
                        <td className="py-3 pr-4">{user.consoleRole}</td>
                        <td className="py-3 pr-4">{user.activeApiKeys}</td>
                        <td className="py-3">{formatAdminDateTime(user.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-6 py-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                Active accounts
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Most active users
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[var(--foreground-tertiary)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Email</th>
                      <th className="pb-3 pr-4 font-medium">Requests</th>
                      <th className="pb-3 pr-4 font-medium">Credits</th>
                      <th className="pb-3 font-medium">Last request</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                    {data.mostActiveUsers.map((user) => (
                      <tr key={user.userId}>
                        <td className="py-3 pr-4 text-white">{user.email ?? user.userId}</td>
                        <td className="py-3 pr-4">{user.requestCount}</td>
                        <td className="py-3 pr-4">{user.creditsUsed}</td>
                        <td className="py-3">{formatAdminDateTime(user.lastRequestAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The admin API returned no user payload."
          title="No user data available"
        />
      )}
    </AdminLayout>
  );
}
