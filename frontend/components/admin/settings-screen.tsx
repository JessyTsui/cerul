"use client";

import { useEffect, useState } from "react";
import {
  admin,
  type AdminMetricTarget,
  type AdminMetricTargetInput,
  type AdminRange,
  type AdminTargetComparisonMode,
  type AdminTargetScopeType,
} from "@/lib/admin-api";
import { formatAdminMetricValue } from "@/lib/admin-console";
import { getApiErrorMessage } from "@/lib/api";
import { AdminLayout } from "./admin-layout";
import { AdminRangePicker } from "./admin-range-picker";
import { DashboardNotice, DashboardSkeleton, DashboardState } from "@/components/dashboard/dashboard-state";
import { useAdminResource } from "./use-admin-resource";

type DraftTarget = AdminMetricTargetInput & {
  id: string | null;
};

const METRIC_OPTIONS = [
  "new_users",
  "active_users",
  "requests_total",
  "credits_used",
  "broll_assets_added",
  "knowledge_videos_added",
  "knowledge_segments_added",
  "jobs_completed",
  "jobs_failed",
] as const;

const COMPARISON_OPTIONS: AdminTargetComparisonMode[] = ["at_least", "at_most"];
const METRIC_SCOPE_OPTIONS: Record<
  (typeof METRIC_OPTIONS)[number],
  AdminTargetScopeType[]
> = {
  new_users: ["global"],
  active_users: ["global", "track"],
  requests_total: ["global", "track"],
  credits_used: ["global", "track"],
  broll_assets_added: ["global", "track", "source"],
  knowledge_videos_added: ["global", "track", "source"],
  knowledge_segments_added: ["global", "track", "source"],
  jobs_completed: ["global", "track", "source"],
  jobs_failed: ["global", "track", "source"],
};

function isMetricOption(value: string): value is (typeof METRIC_OPTIONS)[number] {
  return value in METRIC_SCOPE_OPTIONS;
}

function toDraftTargets(targets: AdminMetricTarget[]): DraftTarget[] {
  return targets.map((target) => ({
    id: target.id,
    metricName: target.metricName,
    scopeType: target.scopeType,
    scopeKey: target.scopeKey,
    rangeKey: target.rangeKey,
    comparisonMode: target.comparisonMode,
    targetValue: target.targetValue,
    note: target.note,
  }));
}

function allowedScopesForMetric(metricName: string): AdminTargetScopeType[] {
  return isMetricOption(metricName) ? METRIC_SCOPE_OPTIONS[metricName] : ["global"];
}

function normalizeDraftTarget(target: DraftTarget): DraftTarget {
  const allowedScopes = allowedScopesForMetric(target.metricName);
  const scopeType = allowedScopes.includes(target.scopeType)
    ? target.scopeType
    : allowedScopes[0];
  return {
    ...target,
    scopeType,
    scopeKey: scopeType === "global" ? "" : target.scopeKey.trim().toLowerCase(),
  };
}

function scopeKeyHint(target: DraftTarget): string {
  if (target.scopeType === "global") {
    return "Global scope does not need a key";
  }

  if (target.scopeType === "track") {
    return "Use broll or knowledge";
  }

  if (target.metricName === "jobs_completed" || target.metricName === "jobs_failed") {
    return "Use content source slug or source UUID";
  }

  return "Use provider key like youtube, pexels, or pixabay";
}

export function AdminSettingsScreen() {
  const [range, setRange] = useState<AdminRange>("7d");
  const { data, error, isLoading, refresh } = useAdminResource({
    range,
    loader: admin.getTargets,
    errorMessage: "Failed to load admin targets.",
  });
  const [draftTargets, setDraftTargets] = useState<DraftTarget[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }

    setDraftTargets(toDraftTargets(data.targets));
  }, [data]);

  function addTargetRow() {
    setDraftTargets((current) => [
      ...current,
      {
        id: null,
        metricName: "requests_total",
        scopeType: "global",
        scopeKey: "",
        rangeKey: range,
        comparisonMode: "at_least",
        targetValue: 0,
        note: null,
      },
    ]);
  }

  function updateTarget(index: number, patch: Partial<DraftTarget>) {
    setDraftTargets((current) =>
      current.map((target, currentIndex) =>
        currentIndex === index
          ? normalizeDraftTarget({ ...target, ...patch })
          : target,
      ),
    );
  }

  async function removeTarget(index: number) {
    const target = draftTargets[index];

    if (!target) {
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);

    if (!target.id) {
      setDraftTargets((current) =>
        current.filter((_item, currentIndex) => currentIndex !== index),
      );
      return;
    }

    try {
      await admin.deleteTarget(target.id);
      setDraftTargets((current) =>
        current.filter((_item, currentIndex) => currentIndex !== index),
      );
      await refresh();
    } catch (nextError) {
      setSaveError(getApiErrorMessage(nextError, "Failed to delete admin target."));
    }
  }

  async function saveTargets() {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const payload = draftTargets.map((target) => ({
        metricName: target.metricName,
        scopeType: target.scopeType,
        scopeKey: target.scopeKey,
        rangeKey: range,
        comparisonMode: target.comparisonMode,
        targetValue: Number.isFinite(target.targetValue) ? target.targetValue : 0,
        note: target.note,
      }));
      const response = await admin.updateTargets(range, payload);
      setDraftTargets(toDraftTargets(response.targets));
      setSaveSuccess("Targets updated.");
      await refresh();
    } catch (nextError) {
      setSaveError(getApiErrorMessage(nextError, "Failed to save admin targets."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AdminLayout
      currentPath="/admin/settings"
      title="Targets"
      description="Configure the expected operating envelope for Cerul so the console can show actuals against explicit goals instead of forcing admins to eyeball raw numbers."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <button className="button-secondary" onClick={() => void addTargetRow()} type="button">
            Add target
          </button>
          <button
            className="button-primary"
            disabled={isSaving}
            onClick={() => void saveTargets()}
            type="button"
          >
            {isSaving ? "Saving..." : "Save targets"}
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
          title="Target settings could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? (
            <DashboardNotice
              title="Showing the last successful target snapshot."
              description={error}
              tone="error"
            />
          ) : null}
          {saveError ? (
            <DashboardNotice
              title="Target update failed"
              description={saveError}
              tone="error"
            />
          ) : null}
          {saveSuccess ? (
            <DashboardNotice
              title="Targets updated"
              description={saveSuccess}
            />
          ) : null}

          <article className="surface-elevated px-6 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Target editor
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              {range} operating targets
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--foreground-secondary)]">
              Use these targets to define what “healthy” looks like for growth,
              content coverage, and ingestion throughput. The overview and section
              pages will compare actuals against these rows automatically.
            </p>

            <div className="mt-6 space-y-4">
              {draftTargets.map((target, index) => (
                <div
                  key={target.id ?? `draft-${index}`}
                  className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4"
                >
                  <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr_1fr_1fr_auto]">
                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Metric
                      </span>
                      <select
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        onChange={(event) =>
                          updateTarget(index, {
                            metricName: event.target.value as DraftTarget["metricName"],
                          })
                        }
                        value={target.metricName}
                      >
                        {METRIC_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Scope
                      </span>
                      <select
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        onChange={(event) =>
                          updateTarget(index, {
                            scopeType: event.target.value as AdminTargetScopeType,
                          })
                        }
                        value={target.scopeType}
                      >
                        {allowedScopesForMetric(target.metricName).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Scope key
                      </span>
                      <input
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        disabled={target.scopeType === "global"}
                        onChange={(event) =>
                          updateTarget(index, {
                            scopeKey: event.target.value,
                          })
                        }
                        placeholder={scopeKeyHint(target)}
                        value={target.scopeKey}
                      />
                    </label>

                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Comparison
                      </span>
                      <select
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        onChange={(event) =>
                          updateTarget(index, {
                            comparisonMode:
                              event.target.value as AdminTargetComparisonMode,
                          })
                        }
                        value={target.comparisonMode}
                      >
                        {COMPARISON_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      className="button-secondary self-end"
                      onClick={() => void removeTarget(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Target value
                      </span>
                      <input
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        min="0"
                        onChange={(event) =>
                          updateTarget(index, {
                            targetValue: Number(event.target.value),
                          })
                        }
                        step="1"
                        type="number"
                        value={target.targetValue}
                      />
                    </label>

                    <label className="space-y-2 text-sm text-[var(--foreground-secondary)]">
                      <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--foreground-tertiary)]">
                        Note
                      </span>
                      <input
                        className="w-full rounded-[14px] border border-[var(--border)] bg-slate-950/40 px-3 py-3 text-white"
                        onChange={(event) =>
                          updateTarget(index, {
                            note: event.target.value || null,
                          })
                        }
                        placeholder="Optional admin note"
                        value={target.note ?? ""}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-elevated overflow-hidden px-6 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              Live target status
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Actual vs expected
            </h2>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-[var(--foreground-tertiary)]">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Metric</th>
                    <th className="pb-3 pr-4 font-medium">Scope</th>
                    <th className="pb-3 pr-4 font-medium">Target</th>
                    <th className="pb-3 pr-4 font-medium">Actual</th>
                    <th className="pb-3 font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-[var(--foreground-secondary)]">
                  {data.targets.map((target) => (
                    <tr key={target.id}>
                      <td className="py-3 pr-4 text-white">{target.metricName}</td>
                      <td className="py-3 pr-4">
                        {target.scopeType}
                        {target.scopeKey ? `:${target.scopeKey}` : ""}
                      </td>
                      <td className="py-3 pr-4">
                        {formatAdminMetricValue(target.targetValue)}
                      </td>
                      <td className="py-3 pr-4">
                        {target.actualValue === null
                          ? "N/A"
                          : formatAdminMetricValue(target.actualValue)}
                      </td>
                      <td className="py-3">
                        {target.targetGap === null
                          ? "N/A"
                          : formatAdminMetricValue(target.targetGap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : (
        <DashboardState
          action={
            <button className="button-primary" onClick={() => void refresh()} type="button">
              Retry request
            </button>
          }
          description="The admin API returned no target payload."
          title="No targets available"
        />
      )}
    </AdminLayout>
  );
}
