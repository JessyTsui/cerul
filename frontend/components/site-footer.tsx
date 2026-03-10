import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="surface mt-10 px-6 py-6 sm:px-8">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <div>
          <p className="eyebrow">Build with public-safe primitives</p>
          <h2 className="display-title mt-3 text-4xl sm:text-5xl">
            Video understanding infrastructure that keeps the API thin.
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Explore
            </p>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <Link href="/">Home</Link>
              <Link href="/docs">Docs</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/dashboard">Dashboard</Link>
            </div>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Repository
            </p>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <a href="https://github.com/JessyTsui/cerul" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <Link href="/login">Sign in</Link>
              <a href="mailto:team@cerul.ai">team@cerul.ai</a>
              <span className="text-[var(--muted)]">Apache 2.0</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-2 border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
        <p>Search what is shown in videos, not just what is said.</p>
        <p>Designed as one backbone for b-roll, knowledge, docs, and agent operations.</p>
      </div>
    </footer>
  );
}
