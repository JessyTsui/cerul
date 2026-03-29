function DashboardLoadingBlock({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-[24px] border border-[var(--border)] bg-[rgba(36,29,21,0.08)] ${className}`}
    />
  );
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <DashboardLoadingBlock className="h-4 w-28 rounded-full" />
          <DashboardLoadingBlock className="h-12 w-48 rounded-full" />
          <DashboardLoadingBlock className="h-4 w-80 max-w-full rounded-full" />
        </div>
        <DashboardLoadingBlock className="h-10 w-24 rounded-full" />
      </div>

      <div className="space-y-5">
        <DashboardLoadingBlock className="h-56 rounded-[32px]" />
        <div className="grid gap-5 xl:grid-cols-3">
          <DashboardLoadingBlock className="h-40 rounded-[28px]" />
          <DashboardLoadingBlock className="h-40 rounded-[28px]" />
          <DashboardLoadingBlock className="h-40 rounded-[28px]" />
        </div>
        <DashboardLoadingBlock className="h-[360px] rounded-[30px]" />
      </div>
    </div>
  );
}
