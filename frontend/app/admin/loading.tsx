function AdminLoadingBlock({
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

export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <AdminLoadingBlock className="h-4 w-32 rounded-full" />
          <AdminLoadingBlock className="h-12 w-52 rounded-full" />
          <AdminLoadingBlock className="h-4 w-96 max-w-full rounded-full" />
        </div>
        <AdminLoadingBlock className="h-10 w-28 rounded-full" />
      </div>

      <div className="space-y-5">
        <AdminLoadingBlock className="h-52 rounded-[32px]" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AdminLoadingBlock className="h-36 rounded-[24px]" />
          <AdminLoadingBlock className="h-36 rounded-[24px]" />
          <AdminLoadingBlock className="h-36 rounded-[24px]" />
          <AdminLoadingBlock className="h-36 rounded-[24px]" />
        </div>
        <AdminLoadingBlock className="h-[420px] rounded-[30px]" />
      </div>
    </div>
  );
}
