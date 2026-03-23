"use client";

type SceneRoute = "text_only" | "embed_only" | "annotate";
type SceneRouteCounts = Record<SceneRoute, number>;
type SceneRouteSummaryVariant = "compact" | "detail";

const ROUTE_ORDER: SceneRoute[] = ["text_only", "embed_only", "annotate"];

const EMPTY_ROUTE_COUNTS: SceneRouteCounts = {
  text_only: 0,
  embed_only: 0,
  annotate: 0,
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function asSceneRoute(value: unknown): SceneRoute | null {
  if (value === "text_only" || value === "embed_only" || value === "annotate") {
    return value;
  }
  return null;
}

function getSceneRouteLabel(route: SceneRoute): string {
  if (route === "text_only") {
    return "Text only";
  }
  if (route === "embed_only") {
    return "Embed only";
  }
  return "Annotate";
}

function formatMetricDuration(valueMs: number): string {
  if (valueMs >= 60_000) {
    const minutes = Math.floor(valueMs / 60_000);
    const seconds = Math.round((valueMs % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  if (valueMs >= 1000) {
    return `${(valueMs / 1000).toFixed(valueMs >= 10_000 ? 0 : 1)}s`;
  }
  return `${valueMs}ms`;
}

function getRouteBadgeClass(route: SceneRoute, emphasized = false): string {
  const base = emphasized
    ? "border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em]"
    : "border px-2 py-1 text-[10px] font-medium";

  if (route === "annotate") {
    return `${base} border-emerald-400/25 bg-emerald-500/10 text-emerald-200`;
  }
  if (route === "embed_only") {
    return `${base} border-sky-400/25 bg-sky-500/10 text-sky-200`;
  }
  return `${base} border-slate-400/20 bg-slate-500/10 text-slate-200`;
}

function getRouteCounts(payload: Record<string, unknown> | null): SceneRouteCounts {
  const counts = asObject(payload?.route_counts);
  if (!counts) {
    return { ...EMPTY_ROUTE_COUNTS };
  }

  return {
    text_only: asNumber(counts.text_only) ?? 0,
    embed_only: asNumber(counts.embed_only) ?? 0,
    annotate: asNumber(counts.annotate) ?? 0,
  };
}

function hasRouteCounts(counts: SceneRouteCounts): boolean {
  return ROUTE_ORDER.some((route) => counts[route] > 0);
}

function getTelemetry(artifacts: unknown) {
  const payload = asObject(artifacts);
  const routeCounts = getRouteCounts(payload);
  const currentRoute =
    asSceneRoute(payload?.current_route) ?? asSceneRoute(payload?.analysis_route);
  const annotationFrameCount = asNumber(payload?.annotation_frame_count);
  const totalAnnotationFrameCount = asNumber(payload?.total_annotation_frame_count);
  const extractionTimeMs = asNumber(payload?.total_extraction_time_ms) ?? asNumber(payload?.extraction_time_ms);
  const dedupTimeMs = asNumber(payload?.total_dedup_time_ms) ?? asNumber(payload?.dedup_time_ms);
  const filterTimeMs = asNumber(payload?.total_filter_time_ms) ?? asNumber(payload?.filter_time_ms);
  const ocrTimeMs = asNumber(payload?.total_ocr_time_ms) ?? asNumber(payload?.ocr_time_ms);
  const prepareTimeMs = asNumber(payload?.total_prepare_time_ms) ?? asNumber(payload?.prepare_time_ms);
  const annotationTimeMs = asNumber(payload?.total_annotation_time_ms) ?? asNumber(payload?.annotation_time_ms);

  return {
    currentRoute,
    routeCounts,
    annotationFrameCount,
    totalAnnotationFrameCount,
    extractionTimeMs,
    dedupTimeMs,
    filterTimeMs,
    ocrTimeMs,
    prepareTimeMs,
    annotationTimeMs,
  };
}

export function SceneRouteSummary({
  artifacts,
  status,
  variant = "compact",
  className = "",
}: {
  artifacts: unknown;
  status?: string;
  variant?: SceneRouteSummaryVariant;
  className?: string;
}) {
  const telemetry = getTelemetry(artifacts);
  const annotationCount =
    telemetry.totalAnnotationFrameCount ?? telemetry.annotationFrameCount;
  const hasTimingTelemetry = [
    telemetry.extractionTimeMs,
    telemetry.dedupTimeMs,
    telemetry.filterTimeMs,
    telemetry.ocrTimeMs,
    telemetry.prepareTimeMs,
    telemetry.annotationTimeMs,
  ].some((value) => typeof value === "number" && value > 0);
  const shouldRender =
    telemetry.currentRoute !== null ||
    hasRouteCounts(telemetry.routeCounts) ||
    (annotationCount !== null && annotationCount > 0) ||
    hasTimingTelemetry;

  if (!shouldRender) {
    return null;
  }

  const routeDescriptor = status === "running" ? "Current route" : "Last route";
  const wrapperClass = className ? ` ${className}` : "";

  if (variant === "detail") {
    return (
      <div
        className={`mt-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 py-3${wrapperClass}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
            Scene routing
          </p>
          {telemetry.currentRoute ? (
            <span className={`inline-flex items-center rounded-full ${getRouteBadgeClass(telemetry.currentRoute, true)}`}>
              {routeDescriptor} · {getSceneRouteLabel(telemetry.currentRoute)}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {ROUTE_ORDER.map((route) => (
            <div
              key={route}
              className={`rounded-[12px] ${getRouteBadgeClass(route)} px-3 py-2`}
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-tertiary)]">
                {getSceneRouteLabel(route)}
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {telemetry.routeCounts[route]}
              </p>
            </div>
          ))}

          <div className="rounded-[12px] border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-amber-100">
            <p className="text-[10px] uppercase tracking-[0.12em] text-amber-200/80">
              Annotated frames
            </p>
            <p className="mt-1 text-lg font-semibold text-white">{annotationCount ?? 0}</p>
          </div>
        </div>

        {hasTimingTelemetry ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              ["Extract", telemetry.extractionTimeMs],
              ["Dedup", telemetry.dedupTimeMs],
              ["Filter", telemetry.filterTimeMs],
              ["OCR", telemetry.ocrTimeMs],
              ["Prepare", telemetry.prepareTimeMs],
              ["Annotate", telemetry.annotationTimeMs],
            ].map(([label, value]) => {
              if (typeof value !== "number" || value <= 0) {
                return null;
              }
              return (
                <div
                  key={label}
                  className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-tertiary)]">
                    {label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatMetricDuration(value)}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`mt-2 flex flex-wrap gap-1.5${wrapperClass}`}>
      {telemetry.currentRoute ? (
        <span className={`inline-flex items-center rounded-full ${getRouteBadgeClass(telemetry.currentRoute, true)}`}>
          {routeDescriptor} · {getSceneRouteLabel(telemetry.currentRoute)}
        </span>
      ) : null}
      {ROUTE_ORDER.map((route) => {
        const count = telemetry.routeCounts[route];
        if (count <= 0) {
          return null;
        }
        return (
          <span key={route} className={`inline-flex items-center rounded-full ${getRouteBadgeClass(route)}`}>
            {getSceneRouteLabel(route)} {count}
          </span>
        );
      })}
      {annotationCount !== null && annotationCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-100">
          Annotated frames {annotationCount}
        </span>
      ) : null}
      {typeof telemetry.extractionTimeMs === "number" && telemetry.extractionTimeMs > 0 ? (
        <span className="inline-flex items-center rounded-full border border-slate-400/20 bg-slate-500/10 px-2 py-1 text-[10px] font-medium text-slate-200">
          Extract {formatMetricDuration(telemetry.extractionTimeMs)}
        </span>
      ) : null}
      {typeof telemetry.annotationTimeMs === "number" && telemetry.annotationTimeMs > 0 ? (
        <span className="inline-flex items-center rounded-full border border-slate-400/20 bg-slate-500/10 px-2 py-1 text-[10px] font-medium text-slate-200">
          Annotate {formatMetricDuration(telemetry.annotationTimeMs)}
        </span>
      ) : null}
    </div>
  );
}
