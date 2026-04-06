import type { Route } from "next";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { FadeIn } from "./animations";

export function SiteFooter() {
  const footerLinks = [
    {
      title: "Product",
      links: [
        { label: "Search API", href: "/docs" },
        { label: "Pricing", href: "/pricing" },
        { label: "Dashboard", href: "/dashboard" },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Documentation", href: "/docs" },
        { label: "API Reference", href: "/docs/api-reference" },
        { label: "Quickstart", href: "/docs" },
        { label: "GitHub", href: "https://github.com/cerul-ai/cerul" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "Contact", href: "mailto:support@cerul.ai" },
        { label: "Terms", href: "/terms" },
        { label: "Privacy", href: "/privacy" },
      ],
    },
  ];

  return (
    <FadeIn>
      <footer className="mt-24 border-t border-[var(--border)] pt-16">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand column */}
          <div className="space-y-6">
            <BrandMark />
            <p className="max-w-sm text-[15px] leading-relaxed text-[var(--foreground-secondary)]">
              The video search layer for AI agents. Search video by meaning
              — across speech, visuals, and on-screen text.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/cerul-ai/cerul"
                target="_blank"
                rel="noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] transition hover:border-[var(--border-brand)] hover:text-[var(--brand-bright)]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.765-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3-.405 1.02.005 2.047.138 3.006.404 2.295-1.56 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.23 1.905 1.23 3.225 0 4.609-2.807 5.625-5.475 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
              <a
                href="https://x.com/cerul_hq"
                target="_blank"
                rel="noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] transition hover:border-[var(--border-brand)] hover:text-[var(--brand-bright)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Link columns */}
          {footerLinks.map((column) => (
            <div key={column.title}>
              <h4 className="text-sm font-semibold text-[var(--foreground)]">
                {column.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") || link.href.startsWith("mailto:") || link.href.startsWith("#") ? (
                      <a
                        href={link.href}
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                        className="text-[15px] text-[var(--foreground-secondary)] transition hover:text-[var(--foreground)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href as Route}
                        className="text-[15px] text-[var(--foreground-secondary)] transition hover:text-[var(--foreground)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-[var(--border)] py-8 sm:flex-row">
          <p className="text-sm text-[var(--foreground-tertiary)]">
            © 2026 Cerul. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-[var(--foreground-tertiary)]">
            <a
              href="mailto:support@cerul.ai"
              className="transition hover:text-[var(--foreground)]"
            >
              support@cerul.ai
            </a>
          </div>
        </div>
      </footer>
    </FadeIn>
  );
}
