function AdminLoadingBlock({
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

export default function AdminLoading() {
  return (
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1520px] space-y-6">
        <AdminLoadingBlock className="h-24" />
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <AdminLoadingBlock className="hidden h-[560px] lg:block" />
          <div className="space-y-6">
            <AdminLoadingBlock className="h-56" />
            <div className="grid gap-6 xl:grid-cols-4">
              <AdminLoadingBlock className="h-36" />
              <AdminLoadingBlock className="h-36" />
              <AdminLoadingBlock className="h-36" />
              <AdminLoadingBlock className="h-36" />
            </div>
            <AdminLoadingBlock className="h-[420px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
