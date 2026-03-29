import type { ReactNode } from "react";

type DashboardStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "default" | "error";
};

type DashboardNoticeProps = {
  title: string;
  description: string;
  tone?: "default" | "error";
};

export function DashboardState({
  title,
  description,
  action,
  tone = "default",
}: DashboardStateProps) {
  const toneClasses =
    tone === "error"
      ? "border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)]"
      : "border-[var(--border)] bg-white/72";

  return (
    <section
      className={`rounded-[24px] border px-6 py-8 text-center ${toneClasses}`}
    >
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
        Dashboard state
      </p>
      <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--foreground-secondary)]">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}

export function DashboardNotice({
  title,
  description,
  tone = "default",
}: DashboardNoticeProps) {
  const toneClasses =
    tone === "error"
      ? "border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] text-[var(--error)]"
      : "border-[var(--border)] bg-white/72 text-[var(--foreground)]";

  return (
    <div className={`rounded-[20px] border px-4 py-4 ${toneClasses}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--foreground-secondary)]">{description}</p>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <section className="surface-elevated rounded-[28px] px-6 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 rounded-full bg-[rgba(36,29,21,0.08)]" />
          <div className="h-9 w-72 rounded-full bg-[rgba(36,29,21,0.08)]" />
          <div className="h-3 w-full rounded-full bg-[rgba(36,29,21,0.08)]" />
          <div className="h-3 w-5/6 rounded-full bg-[rgba(36,29,21,0.08)]" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <article key={index} className="surface rounded-[24px] px-5 py-5">
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-20 rounded-full bg-[rgba(36,29,21,0.08)]" />
              <div className="h-8 w-24 rounded-full bg-[rgba(36,29,21,0.08)]" />
              <div className="h-3 w-full rounded-full bg-[rgba(36,29,21,0.08)]" />
            </div>
          </article>
        ))}
      </section>

      <section className="surface-elevated rounded-[28px] px-6 py-6">
        <div className="animate-pulse space-y-5">
          <div className="flex gap-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex-1 space-y-2">
                <div className="mx-auto h-32 w-full rounded-[12px] bg-[rgba(36,29,21,0.08)]" />
                <div className="mx-auto h-3 w-8 rounded-full bg-[rgba(36,29,21,0.08)]" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
