import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { FadeIn, BlurFade } from "@/components/animations";
import { pricingFaqs, pricingTiers, topupPackages } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Cerul pricing for evaluation, production API usage, and enterprise deployment.",
  alternates: {
    canonical: "/pricing",
  },
};

const featuresComparison = [
  { name: "Included credits", free: "1K / month", monthly: "5K / month", enterprise: "Custom" },
  { name: "Top-up packs", free: "Available", monthly: "Available", enterprise: "Custom" },
  { name: "Rate limits", free: "Standard", monthly: "Higher", enterprise: "Custom" },
  { name: "Search API access", free: true, monthly: true, enterprise: true },
  { name: "Usage insights", free: "Basic", monthly: "Advanced", enterprise: "Full" },
  { name: "Promo codes", free: true, monthly: true, enterprise: "Custom" },
  { name: "Referral rewards", free: true, monthly: true, enterprise: "Custom" },
  { name: "Private indexing", free: false, monthly: false, enterprise: true },
  { name: "SLA guarantee", free: false, monthly: false, enterprise: true },
];

export default function PricingPage() {
  return (
    <div className="soft-theme">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/pricing" />
        <main className="flex-1">
          {/* Hero */}
          <section className="py-16 text-center lg:py-24">
            <BlurFade>
              <span className="eyebrow inline-flex items-center gap-2">
                <span className="inline-block h-px w-4 bg-[var(--brand)]" />
                Pricing
              </span>
            </BlurFade>
            <BlurFade delay={100}>
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
                Find a plan to power your AI agents
              </h1>
            </BlurFade>
            <BlurFade delay={200}>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--foreground-secondary)]">
                1,000 free credits per month. Upgrade to Monthly for 5,000 included credits,
                then add prepaid top-up packs when traffic spikes.
              </p>
            </BlurFade>
          </section>

          {/* Pricing Cards */}
          <section className="grid gap-6 lg:grid-cols-3">
            {pricingTiers.map((tier, index) => (
              <FadeIn key={tier.name} delay={index * 100}>
                <div
                  className={`relative flex h-full flex-col rounded-3xl border p-8 transition-all duration-300 hover:shadow-lg ${
                    index === 1
                      ? "border-[var(--border-brand)] bg-gradient-to-b from-[var(--surface)] to-[var(--background-elevated)] shadow-[0_0_40px_-10px_rgba(136,165,242,0.15)] lg:scale-105"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  {index === 1 && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--brand-bright)] px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
                      Most Popular
                    </div>
                  )}

                  <div className="mb-6">
                    <p className="text-sm font-medium uppercase tracking-wider text-[var(--brand-bright)]">
                      {tier.name}
                    </p>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-5xl font-bold tracking-tight text-[var(--foreground)]">
                        {tier.price}
                      </span>
                      <span className="text-sm text-[var(--foreground-tertiary)]">
                        {tier.cadence}
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                      {tier.description}
                    </p>
                  </div>

                  <ul className="mb-8 flex-1 space-y-4">
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

                  {tier.ctaHref.startsWith("mailto:") ? (
                    <a
                      href={tier.ctaHref}
                      className={`w-full text-center ${
                        index === 1
                          ? "button-gradient"
                          : "button-secondary"
                      }`}
                    >
                      {tier.ctaLabel}
                    </a>
                  ) : (
                    <Link
                      href={tier.ctaHref}
                      className={`w-full text-center ${
                        index === 2
                          ? "button-gradient"
                          : "button-secondary"
                      }`}
                    >
                      {tier.ctaLabel}
                    </Link>
                  )}
                </div>
              </FadeIn>
            ))}
          </section>

          <section className="mt-12">
            <FadeIn>
              <div className="mb-6">
                <span className="eyebrow">Prepaid top-ups</span>
                <h2 className="mt-4 text-2xl font-bold text-[var(--foreground)]">
                  Keep a separate wallet for burst traffic
                </h2>
              </div>
            </FadeIn>
            <div className="grid gap-6 lg:grid-cols-3">
              {topupPackages.map((pack, index) => (
                <FadeIn key={pack.name} delay={index * 100}>
                  <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8">
                    <p className="text-sm font-medium uppercase tracking-wider text-[var(--brand-bright)]">
                      {pack.name}
                    </p>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-4xl font-bold tracking-tight text-[var(--foreground)]">
                        {pack.price}
                      </span>
                      <span className="text-sm text-[var(--foreground-tertiary)]">
                        {pack.cadence}
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                      {pack.description}
                    </p>
                    <ul className="mt-6 space-y-3">
                      {pack.features.map((feature) => (
                        <li key={feature} className="text-sm text-[var(--foreground-secondary)]">
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeIn>
              ))}
            </div>
          </section>

          {/* Comparison Table */}
          <section className="mt-20">
            <FadeIn>
              <h2 className="text-center text-2xl font-bold text-[var(--foreground)]">
                Compare plans
              </h2>
            </FadeIn>

            <FadeIn delay={100}>
              <div className="mt-8 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--background-elevated)]">
                        <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--foreground)]">
                          Feature
                        </th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-[var(--foreground)]">
                          Free
                        </th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-[var(--brand-bright)]">
                          Monthly
                        </th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-[var(--foreground)]">
                          Enterprise
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {featuresComparison.map((feature, index) => {
                        const renderCell = (value: boolean | string, highlight?: boolean) => (
                          typeof value === "boolean" ? (
                            value ? (
                              <svg className="mx-auto h-5 w-5 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <span className="text-[var(--foreground-tertiary)]">&mdash;</span>
                            )
                          ) : (
                            <span className={`text-sm ${highlight ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground-secondary)]"}`}>
                              {value}
                            </span>
                          )
                        );

                        return (
                          <tr
                            key={feature.name}
                            className={index !== featuresComparison.length - 1 ? "border-b border-[var(--border)]" : ""}
                          >
                            <td className="px-6 py-4 text-sm text-[var(--foreground)]">{feature.name}</td>
                            <td className="px-6 py-4 text-center">{renderCell(feature.free)}</td>
                            <td className="px-6 py-4 text-center bg-[var(--brand-subtle)]/30">{renderCell(feature.monthly, true)}</td>
                            <td className="px-6 py-4 text-center">{renderCell(feature.enterprise)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </FadeIn>
          </section>

          {/* Open Source + FAQ */}
          <section className="mt-20 grid gap-8 lg:grid-cols-2">
            <FadeIn>
              <div className="relative overflow-hidden rounded-3xl border border-[var(--border-brand)] bg-gradient-to-br from-[var(--brand-subtle)] via-[var(--surface)] to-[var(--background-elevated)] p-8">
                <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-[var(--brand)] opacity-10 blur-3xl" />
                <div className="relative">
                  <span className="eyebrow text-[var(--brand-bright)]">Open Source</span>
                  <h2 className="mt-4 text-2xl font-bold text-[var(--foreground)]">
                    Fully open. Hosted when you need it.
                  </h2>
                  <p className="mt-4 text-[var(--foreground-secondary)]">
                    Cerul is open source — self-host the entire stack for free, or use the
                    hosted API to skip infrastructure and start searching immediately.
                  </p>
                  <a
                    href="https://github.com/cerul-ai/cerul"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button-secondary mt-6 inline-flex items-center gap-2"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.765-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3-.405 1.02.005 2.047.138 3.006.404 2.295-1.56 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.23 1.905 1.23 3.225 0 4.609-2.807 5.625-5.475 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    View on GitHub
                  </a>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={100}>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8">
                <span className="eyebrow">FAQ</span>
                <div className="mt-6 space-y-4">
                  {pricingFaqs.map((item) => (
                    <div
                      key={item.question}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--background-elevated)] p-4 transition hover:border-[var(--border-strong)]"
                    >
                      <h3 className="font-semibold text-[var(--foreground)]">
                        {item.question}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-secondary)]">
                        {item.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          </section>

          {/* Bottom CTA */}
          <FadeIn>
            <div className="mt-20 text-center">
              <p className="text-lg text-[var(--foreground-secondary)]">
                Have questions?{" "}
                <a
                  href="mailto:support@cerul.ai"
                  className="font-medium text-[var(--brand-bright)] hover:text-[var(--foreground)]"
                >
                  Contact our team
                </a>{" "}
                for custom pricing.
              </p>
            </div>
          </FadeIn>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
