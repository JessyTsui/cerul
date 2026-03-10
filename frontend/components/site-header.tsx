import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { isPrimaryNavigationActive, primaryNavigation } from "@/lib/site";

type SiteHeaderProps = {
  currentPath: string;
};

export function SiteHeader({ currentPath }: SiteHeaderProps) {
  return (
    <header className="surface sticky top-5 z-20 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            className="button-secondary lg:hidden"
          >
            GitHub
          </a>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {primaryNavigation.map((item) => {
            const isActive = isPrimaryNavigationActive(currentPath, item.href);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-link ${isActive ? "nav-link-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="button-secondary">
            Sign in
          </Link>
          <Link href="/dashboard" className="button-primary">
            Console
          </Link>
        </div>
      </div>
    </header>
  );
}
