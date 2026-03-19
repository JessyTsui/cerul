"use client";

import { useEffect, useRef, useState } from "react";
import { admin, type AdminWorkerJob, type AdminWorkerLive } from "@/lib/admin-api";

const STEP_ORDER = [
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

function shortStepName(name: string): string {
  return name
    .replace(/^(Fetch|Download|Transcribe|Detect|Analyze|Segment|Embed|Store|Mark)Knowledge/, "")
    .replace("Step", "");
}

function JobStepBar({ job }: { job: AdminWorkerJob }) {
  const stepMap = Object.fromEntries(job.steps.map((s) => [s.stepName, s]));

  return (
    <div className="mt-2 flex gap-0.5">
      {STEP_ORDER.map((name) => {
        const status = stepMap[name]?.status ?? "pending";
        const bg =
          status === "completed"
            ? "bg-emerald-500"
            : status === "running"
              ? "bg-blue-400 animate-pulse"
              : status === "failed"
                ? "bg-red-500"
                : "bg-[var(--border)]";
        return (
          <div
            key={name}
            className={`h-1.5 flex-1 rounded-sm ${bg}`}
            title={`${shortStepName(name)}: ${status}`}
          />
        );
      })}
    </div>
  );
}

function ActiveJobCard({ job }: { job: AdminWorkerJob }) {
  const [expanded, setExpanded] = useState(false);
  const runningStep = job.steps.find((s) => s.status === "running");
  const completedCount = job.steps.filter((s) => s.status === "completed").length;

  return (
    <div className="surface px-4 py-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {job.title ?? job.videoId ?? job.jobId.slice(0, 8)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--foreground-tertiary)]">
            {runningStep
              ? `Running: ${shortStepName(runningStep.stepName)}`
              : job.status === "retrying"
                ? "Retrying"
                : job.status === "pending"
                  ? "Queued"
                  : `${completedCount}/${STEP_ORDER.length} steps`}
          </p>
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
          {STEP_ORDER.map((name) => {
            const step = job.steps.find((s) => s.stepName === name);
            const status = step?.status ?? "pending";
            const color =
              status === "completed"
                ? "text-emerald-400"
                : status === "running"
                  ? "text-blue-300"
                  : status === "failed"
                    ? "text-red-400"
                    : "text-[var(--foreground-tertiary)]";
            return (
              <div key={name} className="flex items-start justify-between gap-2 text-[11px]">
                <span className={color}>{shortStepName(name)}</span>
                <span className="text-[var(--foreground-tertiary)]">{status}</span>
              </div>
            );
          })}
          {job.steps.find((s) => s.status === "failed")?.errorMessage ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-red-950/30 p-2 text-[10px] leading-5 text-red-300 whitespace-pre-wrap break-all">
              {job.steps.find((s) => s.status === "failed")!.errorMessage}
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const result = await admin.getWorkerLive();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worker status.");
    }
  }

  useEffect(() => {
    const initialTimer = setTimeout(() => void refresh(), 0);
    timerRef.current = setInterval(() => void refresh(), 4000);
    return () => {
      clearTimeout(initialTimer);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!data) {
    return (
      <div className="surface px-5 py-4 text-xs text-[var(--foreground-tertiary)]">
        {error ? `Worker status error: ${error}` : "Loading worker status…"}
      </div>
    );
  }

  const { queue, activeJobs, recentCompleted } = data;

  return (
    <section className="space-y-3">
      {/* Queue row */}
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

      {activeJobs.length === 0 && recentCompleted.length === 0 ? (
        <p className="text-xs text-[var(--foreground-tertiary)]">No active or recent jobs.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {activeJobs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--foreground-tertiary)]">Active</p>
              {activeJobs.map((job) => (
                <ActiveJobCard key={job.jobId} job={job} />
              ))}
            </div>
          ) : null}

          {recentCompleted.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--foreground-tertiary)]">Recently completed</p>
              <article className="surface divide-y divide-[var(--border)]">
                {recentCompleted.map((job) => (
                  <div key={job.jobId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <p className="min-w-0 truncate text-xs text-[var(--foreground-secondary)]">
                      {job.title ?? job.videoId ?? job.jobId.slice(0, 8)}
                    </p>
                    <span className="shrink-0 text-xs text-emerald-400">{job.segmentCount} seg</span>
                  </div>
                ))}
              </article>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
