import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BlurFade } from "@/components/animations";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Cerul collects, uses, and protects your data.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div className="soft-theme">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/privacy" />
        <main className="flex-1">
          <section className="py-16 lg:py-24">
            <BlurFade>
              <span className="eyebrow inline-flex items-center gap-2">
                <span className="inline-block h-px w-4 bg-[var(--brand)]" />
                Legal
              </span>
            </BlurFade>
            <BlurFade delay={100}>
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
                Privacy Policy
              </h1>
            </BlurFade>
            <BlurFade delay={200}>
              <p className="mt-4 text-sm text-[var(--foreground-tertiary)]">
                Effective date: March 31, 2026
              </p>
            </BlurFade>

            <BlurFade delay={300}>
              <div className="prose-legal mt-12 max-w-3xl space-y-10 text-[var(--foreground-secondary)]">
                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">1. Introduction</h2>
                  <p className="mt-4 leading-7">
                    Cerul (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the cerul.ai website and
                    the Cerul API (collectively, the &ldquo;Service&rdquo;). This Privacy Policy explains how we
                    collect, use, disclose, and safeguard your information when you use our Service.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">2. Information We Collect</h2>

                  <h3 className="mt-6 text-base font-semibold text-[var(--foreground)]">Account Information</h3>
                  <p className="mt-2 leading-7">
                    When you create an account, we collect your email address and, if you sign in through a
                    third-party provider (GitHub or Google), your name and profile picture as provided by
                    that service. We do not store your third-party passwords.
                  </p>

                  <h3 className="mt-6 text-base font-semibold text-[var(--foreground)]">API Usage Data</h3>
                  <p className="mt-2 leading-7">
                    We log API requests including query text, timestamps, response metadata, and credit
                    consumption. We use this data to operate the Service, enforce rate limits, and improve
                    search quality. We do not sell this data to third parties.
                  </p>

                  <h3 className="mt-6 text-base font-semibold text-[var(--foreground)]">Payment Information</h3>
                  <p className="mt-2 leading-7">
                    Payment processing is handled by Stripe. We do not store your credit card numbers or
                    bank account details. We receive only a transaction identifier and billing status from
                    Stripe.
                  </p>

                  <h3 className="mt-6 text-base font-semibold text-[var(--foreground)]">Automatically Collected Data</h3>
                  <p className="mt-2 leading-7">
                    When you visit cerul.ai, we may collect standard web analytics data such as IP address
                    (anonymized), browser type, operating system, referring URL, and pages visited. We use
                    this data in aggregate to understand how the Service is used.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">3. How We Use Your Information</h2>
                  <ul className="mt-4 list-disc space-y-2 pl-6 leading-7">
                    <li>Provide, maintain, and improve the Service</li>
                    <li>Authenticate your identity and manage your account</li>
                    <li>Process payments and track credit usage</li>
                    <li>Enforce our Terms of Service, rate limits, and usage policies</li>
                    <li>Send transactional emails (account confirmations, billing receipts, security alerts)</li>
                    <li>Respond to support requests</li>
                  </ul>
                  <p className="mt-4 leading-7">
                    We do not use your data for advertising. We do not sell or rent your personal information
                    to third parties.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">4. Data Sharing</h2>
                  <p className="mt-4 leading-7">We may share your information with:</p>
                  <ul className="mt-4 list-disc space-y-2 pl-6 leading-7">
                    <li>
                      <strong>Service providers</strong> that help us operate the Service (Stripe for payments,
                      Cloudflare for hosting, Vercel for the website). These providers process data on our
                      behalf and are contractually obligated to protect it.
                    </li>
                    <li>
                      <strong>Law enforcement or legal process</strong> if required by applicable law, regulation,
                      or valid legal process.
                    </li>
                  </ul>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">5. Data Retention</h2>
                  <p className="mt-4 leading-7">
                    We retain your account information for as long as your account is active. API query logs
                    are retained for up to 90 days for operational purposes and then deleted or anonymized.
                    You may request deletion of your account and associated data at any time by contacting
                    us at{" "}
                    <a href="mailto:support@cerul.ai" className="text-[var(--brand-bright)] hover:underline">
                      support@cerul.ai
                    </a>.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">6. Security</h2>
                  <p className="mt-4 leading-7">
                    We implement industry-standard security measures to protect your data. API keys are
                    stored as irreversible SHA-256 hashes. All data in transit is encrypted via TLS.
                    However, no method of transmission over the Internet is 100% secure, and we cannot
                    guarantee absolute security.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">7. Cookies</h2>
                  <p className="mt-4 leading-7">
                    We use session cookies to keep you signed in to the dashboard. We do not use
                    third-party tracking cookies or advertising cookies.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">8. Your Rights</h2>
                  <p className="mt-4 leading-7">
                    Depending on your jurisdiction, you may have the right to access, correct, or delete
                    your personal data, or to object to or restrict certain processing. To exercise these
                    rights, contact us at{" "}
                    <a href="mailto:support@cerul.ai" className="text-[var(--brand-bright)] hover:underline">
                      support@cerul.ai
                    </a>.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">9. Children</h2>
                  <p className="mt-4 leading-7">
                    The Service is not directed to individuals under 16. We do not knowingly collect
                    personal information from children.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">10. Changes to This Policy</h2>
                  <p className="mt-4 leading-7">
                    We may update this Privacy Policy from time to time. We will notify you of material
                    changes by posting the updated policy on this page with a revised effective date.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">11. Contact</h2>
                  <p className="mt-4 leading-7">
                    If you have questions about this Privacy Policy, contact us at{" "}
                    <a href="mailto:support@cerul.ai" className="text-[var(--brand-bright)] hover:underline">
                      support@cerul.ai
                    </a>.
                  </p>
                </section>
              </div>
            </BlurFade>
          </section>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
