"use client";

import { useState } from "react";
import { admin, type AdminRange } from "@/lib/admin-api";
import { formatAdminDateTime } from "@/lib/admin-console";
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
      description="Account growth, activity, and access distribution."
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
              Retry
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
              title="Showing last successful snapshot."
              description={error}
              tone="error"
            />
          ) : null}

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AdminMetricCard label="Total users" metric={data.metrics.totalUsers} />
            <AdminMetricCard label="New users" metric={data.metrics.newUsers} />
            <AdminMetricCard label="Active users" metric={data.metrics.activeUsers} />
            <AdminMetricCard label="Active API keys" metric={data.metrics.activeApiKeys} />
          </section>

          <AdminTrendChart
            title="Signups"
            data={data.dailySignups.map((point) => ({
              date: point.key,
              shortLabel: point.label.slice(5),
              fullLabel: point.label,
              primaryValue: point.count,
            }))}
            metricLabel="Signups"
          />

          <div className="grid gap-3 xl:grid-cols-2">
            <article className="surface-elevated px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Distribution</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-2 text-xs text-[var(--foreground-tertiary)]">Plan</p>
                  <div className="space-y-1.5">
                    {data.tiers.map((tier) => (
                      <div key={tier.key} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--foreground-secondary)]">{tier.label}</span>
                        <span className="font-mono text-white">{tier.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs text-[var(--foreground-tertiary)]">Role</p>
                  <div className="space-y-1.5">
                    {data.consoleRoles.map((role) => (
                      <div key={role.key} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--foreground-secondary)]">{role.label}</span>
                        <span className="font-mono text-white">{role.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Most active</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Email</th>
                    <th className="pb-2 pr-3 font-medium">Req</th>
                    <th className="pb-2 font-medium">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.mostActiveUsers.map((user) => (
                    <tr key={user.userId}>
                      <td className="py-2 pr-3 text-white">{user.email ?? user.userId.slice(0, 8)}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{user.requestCount}</td>
                      <td className="py-2 text-[var(--foreground-secondary)]">{formatAdminDateTime(user.lastRequestAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          <article className="surface-elevated overflow-hidden px-5 py-5">
            <p className="mb-4 text-sm font-semibold text-white">Recent signups</p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[var(--foreground-tertiary)]">
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Tier</th>
                  <th className="pb-2 pr-3 font-medium">Role</th>
                  <th className="pb-2 pr-3 font-medium">Keys</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.recentUsers.map((user) => (
                  <tr key={user.userId}>
                    <td className="py-2 pr-3 text-white">{user.email ?? user.userId}</td>
                    <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{user.tier}</td>
                    <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{user.consoleRole}</td>
                    <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{user.activeApiKeys}</td>
                    <td className="py-2 text-[var(--foreground-secondary)]">{formatAdminDateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry
            </button>
          }
          description="No user payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
