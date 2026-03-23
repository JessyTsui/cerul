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

type DraftTarget = AdminMetricTargetInput & { id: string | null };

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
const METRIC_SCOPE_OPTIONS: Record<(typeof METRIC_OPTIONS)[number], AdminTargetScopeType[]> = {
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
  return targets.map((t) => ({
    id: t.id,
    metricName: t.metricName,
    scopeType: t.scopeType,
    scopeKey: t.scopeKey,
    rangeKey: t.rangeKey,
    comparisonMode: t.comparisonMode,
    targetValue: t.targetValue,
    note: t.note,
  }));
}

function allowedScopesForMetric(metricName: string): AdminTargetScopeType[] {
  return isMetricOption(metricName) ? METRIC_SCOPE_OPTIONS[metricName] : ["global"];
}

function normalizeDraftTarget(target: DraftTarget): DraftTarget {
  const allowed = allowedScopesForMetric(target.metricName);
  const scopeType = allowed.includes(target.scopeType) ? target.scopeType : allowed[0];
  return { ...target, scopeType, scopeKey: scopeType === "global" ? "" : target.scopeKey.trim().toLowerCase() };
}

function scopeKeyHint(target: DraftTarget): string {
  if (target.scopeType === "global") return "Global — no key needed";
  if (target.scopeType === "track") return "broll, knowledge, or unified";
  if (target.metricName === "jobs_completed" || target.metricName === "jobs_failed") return "Source slug or UUID";
  return "youtube, pexels, or pixabay";
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
    if (!data) return;
    setDraftTargets(toDraftTargets(data.targets));
  }, [data]);

  function addTargetRow() {
    setDraftTargets((current) => [
      ...current,
      { id: null, metricName: "requests_total", scopeType: "global", scopeKey: "", rangeKey: range, comparisonMode: "at_least", targetValue: 0, note: null },
    ]);
  }

  function updateTarget(index: number, patch: Partial<DraftTarget>) {
    setDraftTargets((current) =>
      current.map((t, i) => (i === index ? normalizeDraftTarget({ ...t, ...patch }) : t)),
    );
  }

  async function removeTarget(index: number) {
    const target = draftTargets[index];
    if (!target) return;
    setSaveError(null);
    setSaveSuccess(null);
    if (!target.id) {
      setDraftTargets((current) => current.filter((_, i) => i !== index));
      return;
    }
    try {
      await admin.deleteTarget(target.id);
      setDraftTargets((current) => current.filter((_, i) => i !== index));
      await refresh();
    } catch (e) {
      setSaveError(getApiErrorMessage(e, "Failed to delete target."));
    }
  }

  async function saveTargets() {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const payload = draftTargets.map((t) => ({
        metricName: t.metricName,
        scopeType: t.scopeType,
        scopeKey: t.scopeKey,
        rangeKey: range,
        comparisonMode: t.comparisonMode,
        targetValue: Number.isFinite(t.targetValue) ? t.targetValue : 0,
        note: t.note,
      }));
      const response = await admin.updateTargets(range, payload);
      setDraftTargets(toDraftTargets(response.targets));
      setSaveSuccess("Targets saved.");
      await refresh();
    } catch (e) {
      setSaveError(getApiErrorMessage(e, "Failed to save targets."));
    } finally {
      setIsSaving(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-[var(--border)] bg-slate-950/40 px-3 py-2 text-sm text-white";

  return (
    <AdminLayout
      currentPath="/admin/settings"
      title="Targets"
      description="Define expected operating ranges so actuals can be compared against explicit goals."
      actions={
        <>
          <AdminRangePicker value={range} onChange={setRange} />
          <button className="button-secondary" onClick={() => void addTargetRow()} type="button">
            Add target
          </button>
          <button className="button-primary" disabled={isSaving} onClick={() => void saveTargets()} type="button">
            {isSaving ? "Saving…" : "Save"}
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
          title="Targets could not be loaded"
          tone="error"
        />
      ) : data ? (
        <>
          {error ? <DashboardNotice title="Showing last successful snapshot." description={error} tone="error" /> : null}
          {saveError ? <DashboardNotice title="Save failed" description={saveError} tone="error" /> : null}
          {saveSuccess ? <DashboardNotice title="Saved" description={saveSuccess} /> : null}

          {/* Editor */}
          <article className="surface-elevated px-5 py-5">
            <p className="mb-4 text-sm font-semibold text-white">
              {range} targets{" "}
              <span className="ml-1 text-xs font-normal text-[var(--foreground-tertiary)]">
                ({draftTargets.length})
              </span>
            </p>
            <div className="space-y-3">
              {draftTargets.map((target, index) => (
                <div key={target.id ?? `draft-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr_0.8fr_0.7fr_80px_auto]">
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--foreground-tertiary)]">Metric</p>
                      <select className={inputClass} value={target.metricName} onChange={(e) => updateTarget(index, { metricName: e.target.value as DraftTarget["metricName"] })}>
                        {METRIC_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--foreground-tertiary)]">Scope</p>
                      <select className={inputClass} value={target.scopeType} onChange={(e) => updateTarget(index, { scopeType: e.target.value as AdminTargetScopeType })}>
                        {allowedScopesForMetric(target.metricName).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--foreground-tertiary)]">Scope key</p>
                      <input className={inputClass} disabled={target.scopeType === "global"} placeholder={scopeKeyHint(target)} value={target.scopeKey} onChange={(e) => updateTarget(index, { scopeKey: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--foreground-tertiary)]">Mode</p>
                      <select className={inputClass} value={target.comparisonMode} onChange={(e) => updateTarget(index, { comparisonMode: e.target.value as AdminTargetComparisonMode })}>
                        {COMPARISON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--foreground-tertiary)]">Value</p>
                      <input className={inputClass} type="number" min="0" step="1" value={target.targetValue} onChange={(e) => updateTarget(index, { targetValue: Number(e.target.value) })} />
                    </div>
                    <button className="button-secondary self-end text-xs" onClick={() => void removeTarget(index)} type="button">
                      ✕
                    </button>
                  </div>
                  <div className="mt-2">
                    <input className={`${inputClass} text-xs`} placeholder="Note (optional)" value={target.note ?? ""} onChange={(e) => updateTarget(index, { note: e.target.value || null })} />
                  </div>
                </div>
              ))}
              {draftTargets.length === 0 ? (
                <p className="py-4 text-center text-xs text-[var(--foreground-tertiary)]">No targets configured. Click &quot;Add target&quot; to set one.</p>
              ) : null}
            </div>
          </article>

          {/* Live status */}
          {data.targets.length > 0 ? (
            <article className="surface-elevated overflow-hidden px-5 py-5">
              <p className="mb-4 text-sm font-semibold text-white">Actual vs target</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--foreground-tertiary)]">
                    <th className="pb-2 pr-3 font-medium">Metric</th>
                    <th className="pb-2 pr-3 font-medium">Scope</th>
                    <th className="pb-2 pr-3 font-medium">Target</th>
                    <th className="pb-2 pr-3 font-medium">Actual</th>
                    <th className="pb-2 font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.targets.map((target) => (
                    <tr key={target.id}>
                      <td className="py-2 pr-3 text-white">{target.metricName}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">
                        {target.scopeType}{target.scopeKey ? `:${target.scopeKey}` : ""}
                      </td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">{formatAdminMetricValue(target.targetValue)}</td>
                      <td className="py-2 pr-3 text-[var(--foreground-secondary)]">
                        {target.actualValue === null ? "—" : formatAdminMetricValue(target.actualValue)}
                      </td>
                      <td className="py-2 text-[var(--foreground-secondary)]">
                        {target.targetGap === null ? "—" : formatAdminMetricValue(target.targetGap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ) : null}
        </>
      ) : (
        <DashboardState
          action={<button className="button-primary" onClick={() => void refresh()} type="button">Retry</button>}
          description="No targets payload returned."
          title="No data available"
        />
      )}
    </AdminLayout>
  );
}
