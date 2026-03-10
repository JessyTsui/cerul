import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="surface mt-20 px-6 py-8 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div className="space-y-4">
          <p className="eyebrow">Video understanding infrastructure</p>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Search what is shown in videos,
            <br />
            <span className="text-[var(--foreground-secondary)]">not just what is said.</span>
          </h2>
          <p className="max-w-xl text-[var(--foreground-secondary)]">
            Cerul turns slides, charts, demos, code screens, and whiteboards into
            queryable evidence for AI agents.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--foreground-tertiary)]">
              Product
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Link href="/" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">
                Home
              </Link>
              <Link href="/docs" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">
                Documentation
              </Link>
              <Link href="/pricing" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">
                Pricing
              </Link>
              <Link href="/dashboard" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">
                Dashboard
              </Link>
            </div>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--foreground-tertiary)]">
              Resources
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <a
                href="https://github.com/JessyTsui/cerul"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white"
              >
                GitHub
              </a>
              <Link href="/login" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">
                Sign in
              </Link>
              <a
                href="mailto:team@cerul.ai"
                className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white"
              >
                Contact
              </a>
              <span className="text-sm text-[var(--foreground-tertiary)]">
                Apache 2.0 License
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-col gap-4 border-t border-[var(--border)] pt-6 text-sm text-[var(--foreground-tertiary)] sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 Cerul. All rights reserved.</p>
        <p>Designed for AI agents and developer workflows.</p>
      </div>
    </footer>
  );
}
