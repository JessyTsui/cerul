import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";

type AuthShellProps = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  highlights: readonly string[];
  children: ReactNode;
};

export function AuthShell({
  heroEyebrow,
  heroTitle,
  heroDescription,
  highlights,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen">
      <div className="relative mx-auto grid min-h-screen lg:grid-cols-2">
        {/* Left Panel - Hero */}
        <section className="relative hidden flex-col justify-between overflow-hidden bg-[#05070d] px-12 py-10 lg:flex lg:px-16 xl:px-20">
          {/* Background Effects */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_35%,rgba(34,211,238,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(14,165,233,0.1),transparent_40%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.02)_0%,transparent_50%)]" />

          {/* Top - Logo */}
          <div className="relative z-10">
            <BrandMark />
          </div>

          {/* Middle - Content */}
          <div className="relative z-10 max-w-[520px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-4 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-bright)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                {heroEyebrow}
              </span>
            </div>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.15] tracking-tight text-white xl:text-5xl">
              {heroTitle}
            </h1>

            <p className="mt-5 text-base leading-relaxed text-[var(--foreground-secondary)]">
              {heroDescription}
            </p>

            {/* Features */}
            <div className="mt-10 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-2 text-sm text-[var(--foreground-secondary)]"
                >
                  <svg
                    className="h-4 w-4 text-[var(--brand-bright)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom - Quote */}
          <div className="relative z-10">
            <blockquote className="border-l-2 border-[var(--border-brand)] pl-5">
              <p className="text-sm leading-relaxed text-[var(--foreground-secondary)]">
                &ldquo;Video understanding should be as simple as a search query.&rdquo;
              </p>
              <p className="mt-2 text-xs text-[var(--foreground-tertiary)]">
                — Cerul Team
              </p>
            </blockquote>
          </div>
        </section>

        {/* Right Panel - Form */}
        <section className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-6 py-12 sm:px-8 lg:bg-[linear-gradient(180deg,#080a10_0%,#05070d_100%)] lg:px-12">
          {/* Mobile Logo */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
          </div>

          {/* Form Container */}
          <div className="relative w-full max-w-[420px]">
            {/* Subtle glow effect */}
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-[rgba(34,211,238,0.08)] to-transparent opacity-50 blur-sm" />

            <div className="relative rounded-3xl border border-[var(--border)] bg-[rgba(8,11,18,0.8)] p-8 shadow-2xl backdrop-blur-xl sm:p-10">
              {children}
            </div>
          </div>

          {/* Footer */}
          <p className="mt-8 max-w-[420px] text-center text-xs leading-6 text-[var(--foreground-tertiary)]">
            Browser sessions only unlock the Cerul console. Public API calls still use scoped bearer keys.
          </p>
        </section>
      </div>
    </div>
  );
}
