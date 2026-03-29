import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function SiteFooter() {
  return (
    <footer className="mt-14 pt-6">
      <div className="flex flex-col gap-5 border-t border-[var(--border)] pt-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <BrandMark />
          <p className="max-w-xl text-sm leading-6 text-[var(--foreground-secondary)]">
            Search what is shown in videos, not just what is said.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-sm text-[var(--foreground-secondary)]">
          <Link href="/docs" className="transition-colors hover:text-[var(--foreground)]">
            Docs
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-[var(--foreground)]">
            Pricing
          </Link>
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            GitHub
          </a>
          <Link
            href="/signup"
            className="text-[var(--brand-bright)] transition-colors hover:text-[var(--foreground)]"
          >
            Sign Up
          </Link>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3 px-1 text-xs text-[var(--foreground-tertiary)] sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Cerul. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <a
            href="mailto:team@cerul.ai"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Contact
          </a>
          <span>Terms of Service</span>
        </div>
      </div>
    </footer>
  );
}
