import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { pricingFaqs, pricingTiers } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Cerul pricing for evaluation, production API usage, and enterprise deployment.",
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <div className="soft-theme">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/pricing" />
        <main className="flex-1">
        {/* Hero */}
          <section className="surface-elevated mt-8 rounded-[34px] px-6 py-10 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
            <div className="space-y-4">
              <span className="label label-brand">Pricing</span>
              <h1 className="text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
                One simple credit model from first request to production.
              </h1>
            </div>
            <p className="max-w-lg text-lg text-[var(--foreground-secondary)]">
              Start with a public API key, pay with credits, and scale into higher
              limits only when your usage becomes operational.
            </p>
          </div>
        </section>

        {/* Pricing tiers */}
          <section className="mt-8 grid gap-4 lg:grid-cols-3">
          {pricingTiers.map((tier, index) => (
            <article
              key={tier.name}
              className={`surface px-6 py-6 ${
                index === 1
                  ? "relative border-[var(--accent)]/40 lg:scale-105"
                  : ""
              }`}
            >
              {index === 1 && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white">
                  Most Popular
                </div>
              )}
              <p className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--brand-bright)]">
                {tier.name}
              </p>
              <div className="mt-4 flex items-end gap-2">
                <p className="text-5xl font-bold text-[var(--foreground)]">{tier.price}</p>
                <p className="mb-2 text-sm text-[var(--foreground-tertiary)]">
                  {tier.cadence}
                </p>
              </div>
              <p className="mt-4 text-[var(--foreground-secondary)]">
                {tier.description}
              </p>
              <ul className="mt-6 space-y-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 text-sm text-[var(--foreground-secondary)]"
                  >
                    <svg
                      className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {tier.ctaHref.startsWith("mailto:") ? (
                  <a
                    href={tier.ctaHref}
                    className={`w-full ${
                      index === 1 ? "button-accent" : "button-secondary"
                    }`}
                  >
                    {tier.ctaLabel}
                  </a>
                ) : (
                  <Link
                    href={tier.ctaHref}
                    className={`w-full ${
                      index === 1 ? "button-accent" : "button-secondary"
                    }`}
                  >
                    {tier.ctaLabel}
                  </Link>
                )}
              </div>
            </article>
          ))}
          </section>

        {/* Commercial stance + FAQ */}
          <section className="mt-10 grid gap-5 lg:grid-cols-2">
            <article className="surface-gradient rounded-[30px] px-6 py-6 lg:px-8">
            <p className="eyebrow">Commercial stance</p>
            <h2 className="mt-3 text-3xl font-bold text-[var(--foreground)]">
              Open core. Operational leverage in the service.
            </h2>
            <p className="mt-4 text-[var(--foreground-secondary)]">
              The repository stays infrastructure-oriented and public-safe, while the
              hosted product compounds through indexing assets, tuning, and admin
              workflows.
            </p>
          </article>

            <article className="surface rounded-[30px] px-6 py-6 lg:px-8">
            <p className="eyebrow">FAQ</p>
            <div className="mt-5 space-y-4">
              {pricingFaqs.map((item) => (
                <div
                  key={item.question}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                >
                  <h3 className="font-semibold text-[var(--foreground)]">{item.question}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-tertiary)]">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
            </article>
          </section>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
