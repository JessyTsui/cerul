import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SiteHeaderAuthActions } from "@/components/site-header-auth-actions";
import { isPrimaryNavigationActive, primaryNavigation } from "@/lib/site";

type SiteHeaderProps = {
  currentPath: string;
};

export function SiteHeader({ currentPath }: SiteHeaderProps) {
  const visibleNavigation = primaryNavigation.filter((item) => item.href !== "/dashboard");

  return (
    <header className="sticky top-4 z-50 mx-auto max-w-[1400px]">
      <div className="surface-elevated flex flex-col gap-4 rounded-[30px] px-4 py-4 backdrop-blur-xl lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-5 lg:px-5">
        <div className="flex items-center gap-4">
          <BrandMark />
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-2 lg:justify-self-center">
          {visibleNavigation.map((item) => {
            const isActive = isPrimaryNavigationActive(currentPath, item.href);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-[var(--background-sunken)] text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]"
                    : "text-[var(--foreground-secondary)] hover:bg-white/40 hover:text-[var(--foreground)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-3 lg:justify-self-end">
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-4 text-sm font-medium text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:bg-white hover:text-[var(--foreground)]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <SiteHeaderAuthActions currentPath={currentPath} />
        </div>
      </div>
    </header>
  );
}
