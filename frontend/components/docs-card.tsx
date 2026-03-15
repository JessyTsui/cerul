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
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]">
              {icon}
            </div>
          ) : null}
          <div>
            {kicker ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                {kicker}
              </p>
            ) : null}
            <h3 className="mt-2 text-2xl font-semibold text-white">{title}</h3>
          </div>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition group-hover:border-[var(--border-brand)] group-hover:text-[var(--brand-bright)]">
          Open
        </span>
      </div>
      <p className="mt-4 text-sm leading-7 text-[var(--foreground-secondary)]">{description}</p>
      <div className="mt-6 text-xs text-[var(--foreground-tertiary)]">
        {readingTime || "Guide"}
      </div>
    </>
  );

  const className =
    "group block rounded-[26px] border border-[var(--border-brand)] bg-[linear-gradient(180deg,rgba(17,24,39,0.66),rgba(10,16,28,0.92))] p-6 shadow-[0_20px_60px_rgba(2,6,18,0.26)] transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(2,6,18,0.36)]";

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
  return <div className="grid gap-5 md:grid-cols-2">{children}</div>;
}
