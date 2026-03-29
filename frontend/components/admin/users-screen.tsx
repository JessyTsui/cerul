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
        <AdminRangePicker value={range} onChange={setRange} />
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
            <article className="surface-elevated rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Distribution</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                The split between plan tiers and console roles in the selected window.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-3 mt-4 text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                    Plan
                  </p>
                  <div className="space-y-2">
                    {data.tiers.map((tier) => (
                      <div key={tier.key} className="flex items-center justify-between rounded-[16px] border border-[var(--border)] bg-white/62 px-3 py-2 text-xs">
                        <span className="text-[var(--foreground-secondary)]">{tier.label}</span>
                        <span className="font-mono text-[var(--foreground)]">{tier.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-3 mt-4 text-xs uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                    Role
                  </p>
                  <div className="space-y-2">
                    {data.consoleRoles.map((role) => (
                      <div key={role.key} className="flex items-center justify-between rounded-[16px] border border-[var(--border)] bg-white/62 px-3 py-2 text-xs">
                        <span className="text-[var(--foreground-secondary)]">{role.label}</span>
                        <span className="font-mono text-[var(--foreground)]">{role.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Most active</p>
              <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
                Accounts generating the most request activity in the current range.
              </p>
              <table className="admin-table mt-4">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Req</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mostActiveUsers.map((user) => (
                    <tr key={user.userId}>
                      <td className="admin-table-primary">{user.email ?? user.userId.slice(0, 8)}</td>
                      <td>{user.requestCount}</td>
                      <td>{formatAdminDateTime(user.lastRequestAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>

          <article className="surface-elevated overflow-hidden rounded-[30px] px-5 py-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">Recent signups</p>
            <p className="mt-1 text-xs leading-6 text-[var(--foreground-tertiary)]">
              New accounts, their current plan, and whether they have already created
              API access.
            </p>
            <table className="admin-table mt-4">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Tier</th>
                  <th>Role</th>
                  <th>Keys</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentUsers.map((user) => (
                  <tr key={user.userId}>
                    <td className="admin-table-primary">{user.email ?? user.userId}</td>
                    <td>{user.tier}</td>
                    <td>{user.consoleRole}</td>
                    <td>{user.activeApiKeys}</td>
                    <td>{formatAdminDateTime(user.createdAt)}</td>
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
