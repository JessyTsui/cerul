import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[rgba(255,255,255,0.08)] pt-8">
      <div className="flex flex-col gap-6 rounded-[24px] border border-[var(--border)] bg-[rgba(10,15,24,0.82)] px-6 py-6 shadow-[0_20px_60px_rgba(2,6,18,0.28)] sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-4">
          <BrandMark />
          <p className="max-w-xl text-sm leading-6 text-[var(--foreground-secondary)]">
            Search what is shown in videos, not just what is said.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-sm text-[var(--foreground-secondary)]">
          <Link href="/docs" className="transition-colors hover:text-white">
            Docs
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-white">
            Pricing
          </Link>
          <a
            href="https://github.com/JessyTsui/cerul"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-white"
          >
            GitHub
          </a>
          <Link href="/signup" className="text-[var(--brand-bright)] transition-colors hover:text-white">
            Sign Up
          </Link>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 px-1 text-xs text-[var(--foreground-tertiary)] sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Cerul. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <a href="mailto:team@cerul.ai" className="transition-colors hover:text-white">
            Contact
          </a>
          <span>Terms of Service</span>
        </div>
      </div>
    </footer>
  );
}
