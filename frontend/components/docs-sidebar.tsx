import type { Route } from "next";
import Link from "next/link";
import { getDocsIndexCards } from "@/lib/docs";

type DocsSidebarProps = {
  currentSlug?: string;
  anchors?: Array<{
    href: string;
    label: string;
    index: string;
  }>;
};

export function DocsSidebar({ currentSlug, anchors = [] }: DocsSidebarProps) {
  const guides = getDocsIndexCards();

  return (
    <aside className="surface sticky top-6 space-y-6 px-5 py-5">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Docs home
        </p>
        <Link href="/docs" className="dashboard-sidebar-link mt-3">
          <span>Overview</span>
          <span className="font-mono text-xs">00</span>
        </Link>
      </div>

      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Guides
        </p>
        <nav className="mt-3 space-y-2">
          {guides.map((guide, index) => {
            const active = currentSlug === guide.slug;

            return (
              <Link
                key={guide.slug}
                href={guide.href as Route}
                className={`dashboard-sidebar-link ${active ? "dashboard-sidebar-link-active" : ""}`}
              >
                <span>{guide.title}</span>
                <span className="font-mono text-xs">{`0${index + 1}`}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {anchors.length > 0 ? (
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            On this page
          </p>
          <nav className="mt-3 space-y-2">
            {anchors.map((anchor) => (
              <a key={anchor.href} href={anchor.href} className="dashboard-sidebar-link">
                <span>{anchor.label}</span>
                <span className="font-mono text-xs">{anchor.index}</span>
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </aside>
  );
}
