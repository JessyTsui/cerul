function DashboardLoadingCard({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,0.03)] ${className}`}
    />
  );
}

export default function DashboardLoading() {
  return (
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px] space-y-6">
        <DashboardLoadingCard className="h-24" />
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <DashboardLoadingCard className="hidden h-[520px] lg:block" />
          <div className="space-y-6">
            <DashboardLoadingCard className="h-48" />
            <div className="grid gap-6 xl:grid-cols-3">
              <DashboardLoadingCard className="h-40" />
              <DashboardLoadingCard className="h-40" />
              <DashboardLoadingCard className="h-40" />
            </div>
            <DashboardLoadingCard className="h-[360px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
