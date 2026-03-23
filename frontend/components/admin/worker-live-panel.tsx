"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { admin, type AdminWorkerJob, type AdminWorkerLive } from "@/lib/admin-api";
import { SceneRouteSummary } from "./scene-route-summary";

const FAILED_JOBS_PAGE_SIZE = 5;

const BROLL_STEP_ORDER = [
  "DiscoverAssetStep",
  "FetchAssetMetadataStep",
  "DownloadPreviewFrameStep",
  "GenerateEmbeddingStep",
  "PersistBrollAssetStep",
  "MarkJobCompletedStep",
];

const KNOWLEDGE_STEP_ORDER = [
  "FetchKnowledgeMetadataStep",
  "FetchKnowledgeCaptionsStep",
  "DownloadKnowledgeVideoStep",
  "TranscribeKnowledgeVideoStep",
  "DetectKnowledgeScenesStep",
  "AnalyzeKnowledgeFramesStep",
  "SegmentKnowledgeTranscriptStep",
  "EmbedKnowledgeSegmentsStep",
  "StoreKnowledgeSegmentsStep",
  "MarkKnowledgeJobCompletedStep",
];

const UNIFIED_YOUTUBE_STEP_ORDER = [
  ...KNOWLEDGE_STEP_ORDER,
  "BuildUnifiedRetrievalUnitsStep",
  "PersistUnifiedUnitsStep",
  "MarkUnifiedJobCompletedStep",
];

const UNIFIED_VISUAL_STEP_ORDER = [
  "FetchUnifiedMetadataStep",
  "DownloadKnowledgeVideoStep",
  "DetectKnowledgeScenesStep",
  "AnalyzeKnowledgeFramesStep",
  "BuildUnifiedRetrievalUnitsStep",
  "EmbedUnifiedUnitsStep",
  "PersistUnifiedUnitsStep",
  "MarkUnifiedJobCompletedStep",
];

const STEP_LABELS: Record<string, string> = {
  DiscoverAssetStep: "Discover Assets",
  FetchAssetMetadataStep: "Metadata",
  DownloadPreviewFrameStep: "Preview Frames",
  GenerateEmbeddingStep: "Embed Assets",
  PersistBrollAssetStep: "Persist Assets",
  MarkJobCompletedStep: "B-roll Complete",
  FetchKnowledgeMetadataStep: "Metadata",
  FetchKnowledgeCaptionsStep: "Captions",
  DownloadKnowledgeVideoStep: "Download",
  TranscribeKnowledgeVideoStep: "Transcribe",
  DetectKnowledgeScenesStep: "Scenes",
  AnalyzeKnowledgeFramesStep: "Frame Analysis",
  SegmentKnowledgeTranscriptStep: "Segment Transcript",
  EmbedKnowledgeSegmentsStep: "Embed Segments",
  StoreKnowledgeSegmentsStep: "Store Segments",
  MarkKnowledgeJobCompletedStep: "Knowledge Complete",
  FetchUnifiedMetadataStep: "Unified Metadata",
  BuildUnifiedRetrievalUnitsStep: "Build Units",
  EmbedUnifiedUnitsStep: "Embed Units",
  PersistUnifiedUnitsStep: "Persist Units",
  MarkUnifiedJobCompletedStep: "Unified Complete",
};

const STEP_HINTS: Record<string, string> = {
  DiscoverAssetStep: "Discovering source assets before enrichment starts.",
  FetchAssetMetadataStep: "Normalizing source metadata and filtering duplicates.",
  DownloadPreviewFrameStep: "Downloading preview frames for later visual analysis.",
  GenerateEmbeddingStep: "Generating vector embeddings for retrieval.",
  PersistBrollAssetStep: "Writing enriched assets into the retrieval store.",
  FetchKnowledgeMetadataStep: "Fetching source metadata from the upstream provider.",
  FetchKnowledgeCaptionsStep: "Trying subtitles first; ASR fallback comes later if needed.",
  DownloadKnowledgeVideoStep: "Downloading source media. This is often the longest network step.",
  TranscribeKnowledgeVideoStep: "Chunking audio and transcribing it. Long videos can take a while here.",
  DetectKnowledgeScenesStep: "Finding scene boundaries from transcript and video structure.",
  AnalyzeKnowledgeFramesStep: "Running frame analysis to extract on-screen evidence.",
  SegmentKnowledgeTranscriptStep: "Merging transcript and visual context into retrieval segments.",
  EmbedKnowledgeSegmentsStep: "Embedding transcript segments into the shared vector space.",
  StoreKnowledgeSegmentsStep: "Persisting the knowledge video and its segments.",
  BuildUnifiedRetrievalUnitsStep: "Building summary, speech, and visual units for unified search.",
  EmbedUnifiedUnitsStep: "Embedding unified retrieval units before persistence.",
  PersistUnifiedUnitsStep: "Writing unified retrieval units into the main search index.",
  MarkUnifiedJobCompletedStep: "Finalizing job artifacts and completion state.",
};

function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name.replace(/Step$/, "");
}

function stepHint(name: string): string | null {
  return STEP_HINTS[name] ?? null;
}

function getStepOrder(job: AdminWorkerJob): string[] {
  let baseOrder: string[] = [];

  if (job.track === "broll") {
    baseOrder = BROLL_STEP_ORDER;
  } else if (job.track === "knowledge") {
    baseOrder = KNOWLEDGE_STEP_ORDER;
  } else if (job.track === "unified") {
    baseOrder = job.source === "youtube" ? UNIFIED_YOUTUBE_STEP_ORDER : UNIFIED_VISUAL_STEP_ORDER;
  }

  const extraSteps = job.steps
    .map((step) => step.stepName)
    .filter((name, index, all) => !baseOrder.includes(name) && all.indexOf(name) === index);

  return [...baseOrder, ...extraSteps];
}

function formatDuration(valueMs: number): string {
  const totalSeconds = Math.max(Math.floor(valueMs / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatRelativeTime(value: string | null, referenceNowMs: number): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return `${formatDuration(referenceNowMs - timestamp)} ago`;
}

function summarizeArtifacts(artifacts: unknown): string | null {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    return null;
  }

  const entries = Object.entries(artifacts as Record<string, unknown>).filter(([, value]) => {
    return value !== null && value !== undefined && value !== "" && value !== 0;
  }).filter(([key]) => {
    return ![
      "logs",
      "guidance",
      "duration_ms",
      "timeout_seconds",
      "current_route",
      "analysis_route",
      "route_counts",
      "annotation_frame_count",
      "total_annotation_frame_count",
      "extraction_time_ms",
      "dedup_time_ms",
      "filter_time_ms",
      "ocr_time_ms",
      "prepare_time_ms",
      "annotation_time_ms",
      "total_extraction_time_ms",
      "total_dedup_time_ms",
      "total_filter_time_ms",
      "total_ocr_time_ms",
      "total_prepare_time_ms",
      "total_annotation_time_ms",
    ].includes(key);
  });

  if (entries.length === 0) {
    return null;
  }

  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" • ");
}

function formatStepDuration(
  step: AdminWorkerJob["steps"][number] | undefined,
  referenceNowMs: number,
): string | null {
  if (!step) {
    return null;
  }
  if (typeof step.durationMs === "number" && Number.isFinite(step.durationMs)) {
    return formatDuration(step.durationMs);
  }
  if (step.startedAt) {
    return formatDuration(referenceNowMs - Date.parse(step.startedAt));
  }
  return null;
}

function JobStepBar({ job }: { job: AdminWorkerJob }) {
  const stepOrder = getStepOrder(job);
  const stepMap = Object.fromEntries(job.steps.map((step) => [step.stepName, step]));

  return (
    <div className="mt-2 flex gap-0.5">
      {stepOrder.map((name) => {
        const status = stepMap[name]?.status ?? "pending";
        const bg =
          status === "completed"
            ? "bg-emerald-500"
            : status === "running"
              ? "bg-blue-400 animate-pulse"
              : status === "failed"
                ? "bg-red-500"
                : status === "skipped"
                  ? "bg-amber-400/60"
                  : "bg-[var(--border)]";

        return (
          <div
            key={name}
            className={`h-1.5 flex-1 rounded-sm ${bg}`}
            title={`${stepLabel(name)}: ${status}`}
          />
        );
      })}
    </div>
  );
}

function ActiveJobCard({
  job,
  referenceNowMs,
}: {
  job: AdminWorkerJob;
  referenceNowMs: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const stepOrder = getStepOrder(job);
  const stepMap = Object.fromEntries(job.steps.map((step) => [step.stepName, step]));
  const runningStep = job.steps.find((step) => step.status === "running");
  const failedStep = job.steps.find((step) => step.status === "failed");
  const completedCount = stepOrder.filter((name) => stepMap[name]?.status === "completed").length;
  const runningDuration = runningStep?.startedAt
    ? formatDuration(referenceNowMs - Date.parse(runningStep.startedAt))
    : null;
  const lastActivity = formatRelativeTime(job.lastActivityAt, referenceNowMs);
  const currentHint = runningStep
    ? stepHint(runningStep.stepName)
    : job.status === "retrying"
      ? "Worker will retry this job after the current backoff window."
      : job.status === "pending"
        ? "The job is still queued and has not been claimed by the worker yet."
        : null;
  const longRunning =
    runningStep?.startedAt != null &&
    referenceNowMs - Date.parse(runningStep.startedAt) > 8 * 60 * 1000;

  return (
    <div className="surface px-4 py-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {job.title ?? job.videoId ?? job.jobId.slice(0, 8)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--foreground-tertiary)]">
            {runningStep
              ? `Running: ${stepLabel(runningStep.stepName)}${runningDuration ? ` • ${runningDuration}` : ""}`
              : job.status === "retrying"
                ? "Retrying"
                : job.status === "pending"
                  ? "Queued"
                  : `${completedCount}/${stepOrder.length} steps`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--foreground-secondary)]">
            {lastActivity ? `Last activity ${lastActivity}` : "Waiting for first worker update."}
            {job.maxAttempts > 0 ? ` • attempt ${Math.max(job.attempts, 1)}/${job.maxAttempts}` : ""}
          </p>
          {currentHint ? (
            <p className="mt-1 text-[11px] text-[var(--foreground-tertiary)]">{currentHint}</p>
          ) : null}
          {runningStep ? (
            <SceneRouteSummary artifacts={runningStep.artifacts} status={runningStep.status} />
          ) : null}
          {longRunning ? (
            <p className="mt-1 text-[11px] text-amber-300">
              This step has been running for a while. Download and transcription can take several minutes.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              job.status === "running"
                ? "bg-blue-500/20 text-blue-300"
                : job.status === "retrying"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-[var(--border)] text-[var(--foreground-secondary)]"
            }`}
          >
            {job.status}
          </span>
          <span className="text-[10px] text-[var(--foreground-tertiary)]">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      <JobStepBar job={job} />

      {expanded ? (
        <div className="mt-3 space-y-1">
          {stepOrder.map((name) => {
            const step = stepMap[name];
            const status = step?.status ?? "pending";
            const color =
              status === "completed"
                ? "text-emerald-400"
                : status === "running"
                  ? "text-blue-300"
                  : status === "failed"
                    ? "text-red-400"
                    : status === "skipped"
                      ? "text-amber-300"
                      : "text-[var(--foreground-tertiary)]";
            const details = summarizeArtifacts(step?.artifacts);
            const stepDuration = formatStepDuration(step, referenceNowMs);
            const stepLogs = step?.logs ?? [];

            return (
              <div key={name} className="rounded-lg border border-[var(--border)]/70 px-2 py-1.5">
                <div className="flex items-start justify-between gap-2 text-[11px]">
                  <span className={color}>{stepLabel(name)}</span>
                  <span className="text-right text-[var(--foreground-tertiary)]">
                    {status}
                    {stepDuration ? ` • ${stepDuration}` : ""}
                  </span>
                </div>
                {status === "running" && stepHint(name) ? (
                  <p className="mt-1 text-[10px] text-[var(--foreground-secondary)]">{stepHint(name)}</p>
                ) : null}
                {step?.guidance ? (
                  <p className="mt-1 text-[10px] text-amber-200">{step.guidance}</p>
                ) : null}
                {details ? (
                  <p className="mt-1 text-[10px] text-[var(--foreground-tertiary)]">{details}</p>
                ) : null}
                <SceneRouteSummary artifacts={step?.artifacts} status={status} />
                {stepLogs.length ? (
                  <div className="mt-2 space-y-1 rounded-md bg-black/15 p-2">
                    {stepLogs.slice(-4).map((entry, index) => (
                      <div key={`${entry.at ?? "log"}-${index}`} className="text-[10px] leading-4 text-[var(--foreground-secondary)]">
                        <span className="text-[var(--foreground-tertiary)]">
                          {entry.at ? new Date(entry.at).toLocaleTimeString() : "log"}
                        </span>{" "}
                        <span className="uppercase text-[9px] tracking-[0.12em] text-[var(--foreground-tertiary)]">
                          {entry.level}
                        </span>{" "}
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {failedStep?.errorMessage ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/30 p-2 text-[10px] leading-5 text-red-300 whitespace-pre-wrap break-all">
              {failedStep.errorMessage}
            </pre>
          ) : job.status === "retrying" && job.errorMessage ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-amber-950/30 p-2 text-[10px] leading-5 text-amber-200 whitespace-pre-wrap break-all">
              {job.errorMessage}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FailedJobCard({
  job,
  referenceNowMs,
  retrying,
  killing,
  onRetry,
  onKill,
}: {
  job: AdminWorkerJob;
  referenceNowMs: number;
  retrying: boolean;
  killing: boolean;
  onRetry: (jobId: string) => void;
  onKill: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const stepOrder = getStepOrder(job);
  const stepMap = Object.fromEntries(job.steps.map((step) => [step.stepName, step]));
  const failedStep = job.steps.find((step) => step.status === "failed");
  const lastActivity = formatRelativeTime(job.lastActivityAt, referenceNowMs);
  const errorPreview = (job.errorMessage ?? "Unknown worker failure.").slice(0, 80);

  return (
    <div className="surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          <p className="truncate text-sm font-medium text-white">
            {job.title ?? job.videoId ?? job.jobId.slice(0, 8)}
          </p>
          <p className="mt-1 text-[11px] text-red-300">{errorPreview}</p>
          <p className="mt-1 text-[11px] text-[var(--foreground-secondary)]">
            {lastActivity ? `Failed ${lastActivity}` : "Failed recently."}
            {job.maxAttempts > 0 ? ` • attempt ${Math.max(job.attempts, 1)}/${job.maxAttempts}` : ""}
            {typeof job.totalDurationMs === "number" ? ` • ${formatDuration(job.totalDurationMs)}` : ""}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={retrying || killing}
            onClick={() => onRetry(job.jobId)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              retrying
                ? "cursor-not-allowed bg-amber-500/15 text-amber-200"
                : "bg-red-500/15 text-red-200 hover:bg-red-500/25"
            }`}
          >
            {retrying ? "Retrying..." : "Retry"}
          </button>
          <button
            type="button"
            disabled={retrying || killing}
            onClick={() => {
              if (window.confirm("Kill this failed job and remove it from the queue history?")) {
                onKill(job.jobId);
              }
            }}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              killing
                ? "cursor-not-allowed bg-slate-500/15 text-slate-300"
                : "bg-slate-500/15 text-slate-200 hover:bg-slate-500/25"
            }`}
          >
            {killing ? "Killing..." : "Kill"}
          </button>
          <span className="text-[10px] text-[var(--foreground-tertiary)]">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      <JobStepBar job={job} />

      {expanded ? (
        <div className="mt-3 space-y-1">
          {stepOrder.map((name) => {
            const step = stepMap[name];
            const status = step?.status ?? "pending";
            const color =
              status === "completed"
                ? "text-emerald-400"
                : status === "running"
                  ? "text-blue-300"
                  : status === "failed"
                    ? "text-red-400"
                    : status === "skipped"
                      ? "text-amber-300"
                      : "text-[var(--foreground-tertiary)]";
            const details = summarizeArtifacts(step?.artifacts);
            const stepDuration = formatStepDuration(step, referenceNowMs);
            const stepLogs = step?.logs ?? [];

            return (
              <div key={name} className="rounded-lg border border-[var(--border)]/70 px-2 py-1.5">
                <div className="flex items-start justify-between gap-2 text-[11px]">
                  <span className={color}>{stepLabel(name)}</span>
                  <span className="text-right text-[var(--foreground-tertiary)]">
                    {status}
                    {stepDuration ? ` • ${stepDuration}` : ""}
                  </span>
                </div>
                {step?.guidance ? (
                  <p className="mt-1 text-[10px] text-amber-200">{step.guidance}</p>
                ) : null}
                {details ? (
                  <p className="mt-1 text-[10px] text-[var(--foreground-tertiary)]">{details}</p>
                ) : null}
                <SceneRouteSummary artifacts={step?.artifacts} status={status} />
                {stepLogs.length ? (
                  <div className="mt-2 space-y-1 rounded-md bg-black/15 p-2">
                    {stepLogs.slice(-4).map((entry, index) => (
                      <div key={`${entry.at ?? "log"}-${index}`} className="text-[10px] leading-4 text-[var(--foreground-secondary)]">
                        <span className="text-[var(--foreground-tertiary)]">
                          {entry.at ? new Date(entry.at).toLocaleTimeString() : "log"}
                        </span>{" "}
                        <span className="uppercase text-[9px] tracking-[0.12em] text-[var(--foreground-tertiary)]">
                          {entry.level}
                        </span>{" "}
                        <span>{entry.message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {failedStep?.errorMessage || job.errorMessage ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/30 p-2 text-[10px] leading-5 text-red-300 whitespace-pre-wrap break-all">
              {failedStep?.errorMessage ?? job.errorMessage}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkerLivePanel() {
  const [data, setData] = useState<AdminWorkerLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingJobIds, setRetryingJobIds] = useState<Set<string>>(() => new Set());
  const [killingJobIds, setKillingJobIds] = useState<Set<string>>(() => new Set());
  const [failedOffset, setFailedOffset] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (requestedOffset = failedOffset) => {
    try {
      const result = await admin.getWorkerLive({
        failedLimit: FAILED_JOBS_PAGE_SIZE,
        failedOffset: requestedOffset,
      });
      if (result.failedJobsTotal === 0 && requestedOffset !== 0) {
        setFailedOffset(0);
        return;
      }
      if (result.failedJobsTotal > 0 && requestedOffset >= result.failedJobsTotal) {
        setFailedOffset(
          Math.max(
            Math.floor((result.failedJobsTotal - 1) / FAILED_JOBS_PAGE_SIZE) *
              FAILED_JOBS_PAGE_SIZE,
            0,
          ),
        );
        return;
      }
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worker status.");
    }
  }, [failedOffset]);

  async function handleRetry(jobId: string) {
    setRetryingJobIds((current) => new Set(current).add(jobId));
    try {
      await admin.retryJob(jobId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry job.");
    } finally {
      setRetryingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  }

  async function handleKill(jobId: string) {
    setKillingJobIds((current) => new Set(current).add(jobId));
    try {
      await admin.killJob(jobId);
      if (data && data.failedJobs.length === 1 && failedOffset > 0) {
        setFailedOffset(Math.max(failedOffset - FAILED_JOBS_PAGE_SIZE, 0));
      } else {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to kill job.");
    } finally {
      setKillingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  }

  useEffect(() => {
    const initialTimer = setTimeout(() => void refresh(), 0);
    timerRef.current = setInterval(() => void refresh(), 4000);
    return () => {
      clearTimeout(initialTimer);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [refresh]);

  if (!data) {
    return (
      <div className="surface px-5 py-4 text-xs text-[var(--foreground-tertiary)]">
        {error ? `Worker status error: ${error}` : "Loading worker status…"}
      </div>
    );
  }

  const { queue, activeJobs, recentCompleted, failedJobs } = data;
  const referenceNowMs = Number.isFinite(Date.parse(data.generatedAt))
    ? Date.parse(data.generatedAt)
    : 0;
  const failedJobsTotal = data.failedJobsTotal;
  const failedCurrentPage = failedJobsTotal > 0 ? Math.floor(data.failedJobsOffset / FAILED_JOBS_PAGE_SIZE) + 1 : 1;
  const failedTotalPages = Math.max(Math.ceil(Math.max(failedJobsTotal, 1) / FAILED_JOBS_PAGE_SIZE), 1);
  const failedRangeStart = failedJobsTotal > 0 ? data.failedJobsOffset + 1 : 0;
  const failedRangeEnd = Math.min(data.failedJobsOffset + failedJobs.length, failedJobsTotal);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-white">Worker</span>
        {[
          { label: "pending", value: queue.pending, color: "text-[var(--foreground-secondary)]" },
          { label: "running", value: queue.running, color: "text-blue-300" },
          { label: "retrying", value: queue.retrying, color: "text-amber-300" },
          { label: "completed", value: queue.completed, color: "text-emerald-400" },
          { label: "failed", value: queue.failed, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <span key={label} className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs">
            <span className={`font-semibold ${color}`}>{value}</span>{" "}
            <span className="text-[var(--foreground-tertiary)]">{label}</span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-[var(--foreground-tertiary)]">
          {error ? <span className="text-red-400">{error}</span> : "↻ 4s"}
        </span>
      </div>

      {activeJobs.length === 0 && recentCompleted.length === 0 && failedJobs.length === 0 ? (
        <p className="text-xs text-[var(--foreground-tertiary)]">No active or recent jobs.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-3">
          {activeJobs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--foreground-tertiary)]">Active</p>
              {activeJobs.map((job) => (
                <ActiveJobCard key={job.jobId} job={job} referenceNowMs={referenceNowMs} />
              ))}
            </div>
          ) : null}

          {recentCompleted.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--foreground-tertiary)]">Recently completed</p>
              <article className="surface divide-y divide-[var(--border)]">
                {recentCompleted.map((job) => (
                  <div key={job.jobId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-[var(--foreground-secondary)]">
                        {job.title ?? job.videoId ?? job.jobId.slice(0, 8)}
                      </p>
                      {typeof job.totalDurationMs === "number" ? (
                        <p className="mt-0.5 text-[10px] text-[var(--foreground-tertiary)]">
                          {formatDuration(job.totalDurationMs)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs text-emerald-400">{job.segmentCount} seg</span>
                    </div>
                  </div>
                ))}
              </article>
            </div>
          ) : null}

          {failedJobs.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs text-[var(--foreground-tertiary)]">Failed Jobs</p>
                <span className="rounded-full border border-red-500/30 px-2 py-0.5 text-[10px] text-red-300">
                  {failedJobsTotal}
                </span>
              </div>
              <div className="space-y-2">
                {failedJobs.map((job) => (
                  <FailedJobCard
                    key={job.jobId}
                    job={job}
                    referenceNowMs={referenceNowMs}
                    retrying={retryingJobIds.has(job.jobId)}
                    killing={killingJobIds.has(job.jobId)}
                    onRetry={handleRetry}
                    onKill={handleKill}
                  />
                ))}
              </div>
              {failedJobsTotal > FAILED_JOBS_PAGE_SIZE ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)]/70 px-3 py-2 text-[11px] text-[var(--foreground-secondary)]">
                  <p>
                    Showing {failedRangeStart}-{failedRangeEnd} of {failedJobsTotal}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFailedOffset((current) =>
                          Math.max(current - FAILED_JOBS_PAGE_SIZE, 0),
                        )
                      }
                      disabled={data.failedJobsOffset === 0}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span className="text-[10px] text-[var(--foreground-tertiary)]">
                      Page {failedCurrentPage} / {failedTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFailedOffset((current) => current + FAILED_JOBS_PAGE_SIZE)
                      }
                      disabled={data.failedJobsOffset + FAILED_JOBS_PAGE_SIZE >= failedJobsTotal}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
