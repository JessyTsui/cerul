"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { isPrimaryNavigationActive, primaryNavigation } from "@/lib/site";

type SiteHeaderProps = {
  currentPath: string;
};

export function SiteHeader({ currentPath }: SiteHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigationId = useId();
  const actionsId = useId();

  return (
    <header className="sticky top-4 z-50 mx-auto max-w-[1400px] px-4">
      <div className="surface-elevated flex flex-col gap-4 px-5 py-4 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <button
            type="button"
            aria-controls={`${navigationId} ${actionsId}`}
            aria-expanded={mobileMenuOpen}
            className="button-ghost focus-ring lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>

        <nav
          id={navigationId}
          className={`flex-col gap-4 lg:flex lg:flex-row lg:items-center ${
            mobileMenuOpen ? "flex" : "hidden"
          }`}
        >
          {primaryNavigation.map((item) => {
            const isActive = isPrimaryNavigationActive(currentPath, item.href);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-link px-2 ${isActive ? "nav-link-active" : ""}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div
          id={actionsId}
          className={`flex-col gap-3 lg:flex lg:flex-row lg:items-center ${
            mobileMenuOpen ? "flex" : "hidden"
          }`}
        >
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            className="button-ghost focus-ring inline-flex items-center gap-2"
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
          <Link href="/login" className="button-secondary focus-ring">
            Sign in
          </Link>
          <Link href="/signup" className="button-primary focus-ring">
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
