import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { pricingFaqs, pricingTiers } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Cerul pricing for agents, demos, and production search workflows.",
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 pb-8 pt-5 sm:px-8 lg:px-10">
      <SiteHeader currentPath="/pricing" />
      <main className="flex-1 pb-12 pt-10">
        <section className="surface px-6 py-7 sm:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <span className="label">Pricing</span>
              <h1 className="display-title mt-5 text-5xl sm:text-6xl">
                Credits that map cleanly to product value.
              </h1>
            </div>
            <p className="text-lg leading-8 text-[var(--muted)]">
              Cerul prices the same public API surface used by direct clients, docs,
              and installable skills. Start with evaluation credits, then scale into
              predictable operator workflows.
            </p>
          </div>
        </section>

        <section className="grid gap-5 pt-8 lg:grid-cols-3">
          {pricingTiers.map((tier) => (
            <article
              key={tier.name}
              className={`surface px-6 py-6 ${
                tier.accent === "orange"
                  ? "bg-[linear-gradient(180deg,rgba(255,240,230,0.92),rgba(255,252,247,0.88))]"
                  : ""
              }`}
            >
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--brand-deep)]">
                {tier.name}
              </p>
              <div className="mt-4 flex items-end gap-3">
                <p className="text-5xl font-semibold tracking-tight">{tier.price}</p>
                <p className="pb-2 text-sm text-[var(--muted)]">{tier.cadence}</p>
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
                {tier.description}
              </p>
              <ul className="mt-6 space-y-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="rounded-[18px] border border-[var(--line)] bg-white/74 px-4 py-3 text-sm leading-6"
                  >
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {tier.ctaHref.startsWith("mailto:") ? (
                  <a href={tier.ctaHref} className="button-primary">
                    {tier.ctaLabel}
                  </a>
                ) : (
                  <Link href={tier.ctaHref} className="button-primary">
                    {tier.ctaLabel}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-5 pt-10 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="surface-strong px-6 py-6 sm:px-8">
            <p className="eyebrow">Commercial stance</p>
            <h2 className="display-title mt-3 text-4xl sm:text-5xl">
              Keep public code open. Keep operational leverage in the service.
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">
              The repository stays infrastructure-oriented and public-safe, while the
              hosted product compounds through indexing assets, tuning, and operator
              workflows. Pricing should follow that same split.
            </p>
          </article>
          <article className="surface px-6 py-6 sm:px-8">
            <p className="eyebrow">Frequently asked</p>
            <div className="mt-5 space-y-4">
              {pricingFaqs.map((item) => (
                <div
                  key={item.question}
                  className="rounded-[22px] border border-[var(--line)] bg-white/76 px-4 py-4"
                >
                  <h3 className="text-lg font-semibold tracking-tight">{item.question}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
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
  );
}
