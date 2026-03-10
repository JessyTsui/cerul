import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type DocsCardProps = {
  title: string;
  description: string;
  href?: Route;
  icon?: ReactNode;
  kicker?: string;
  readingTime?: string;
};

export function DocsCard({
  title,
  description,
  href,
  icon,
  kicker,
  readingTime,
}: DocsCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          {icon ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]">
              {icon}
            </div>
          ) : null}
          <div>
            {kicker ? <p className="eyebrow text-[11px]">{kicker}</p> : null}
            <h3 className="mt-2 font-semibold text-white">{title}</h3>
          </div>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground-tertiary)] transition group-hover:border-[var(--border-brand)] group-hover:text-[var(--brand-bright)]">
          →
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--foreground-secondary)]">{description}</p>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-[var(--foreground-tertiary)]">
        <span>{readingTime || "Guide"}</span>
        {href ? <span className="text-[var(--brand-bright)]">Open guide</span> : null}
      </div>
    </>
  );

  const className =
    "group block rounded-[20px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--surface-hover)] hover:shadow-[0_18px_40px_rgba(2,6,23,0.35)]";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

type DocsCardsProps = {
  children: ReactNode;
};

export function DocsCards({ children }: DocsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}
