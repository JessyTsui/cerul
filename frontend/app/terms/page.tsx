import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BlurFade } from "@/components/animations";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms and conditions for using the Cerul API and website.",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="soft-theme">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/terms" />
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
                Terms of Service
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
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">1. Acceptance of Terms</h2>
                  <p className="mt-4 leading-7">
                    By accessing or using the Cerul website (cerul.ai), API, SDK, or any related services
                    (collectively, the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service
                    (&ldquo;Terms&rdquo;). If you do not agree, do not use the Service.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">2. Description of Service</h2>
                  <p className="mt-4 leading-7">
                    Cerul provides a video understanding search API that allows AI agents and developers to
                    search indexed video content by visual scenes, speech, and on-screen text. The Service
                    includes the hosted API, dashboard, documentation, SDKs, and MCP integrations.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">3. Accounts</h2>
                  <p className="mt-4 leading-7">
                    You must create an account to use the API. You are responsible for maintaining the
                    security of your account credentials and API keys. You must not share API keys publicly
                    or embed them in client-side code. You are responsible for all activity that occurs
                    under your account.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">4. API Usage and Rate Limits</h2>
                  <p className="mt-4 leading-7">
                    Each account is subject to usage limits based on its plan tier (Free, Pay-as-you-go,
                    Monthly, or Enterprise). Usage is measured in credits. Exceeding your plan&rsquo;s
                    rate limits may result in throttled requests (HTTP 429). We reserve the right to
                    suspend accounts that abuse the Service or circumvent rate limits.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">5. Acceptable Use</h2>
                  <p className="mt-4 leading-7">You agree not to:</p>
                  <ul className="mt-4 list-disc space-y-2 pl-6 leading-7">
                    <li>Use the Service for any unlawful purpose</li>
                    <li>Attempt to reverse-engineer, decompile, or extract the source code of the Service infrastructure</li>
                    <li>Interfere with or disrupt the integrity or performance of the Service</li>
                    <li>Resell or redistribute API access without our written permission</li>
                    <li>Use automated means to create accounts or generate API keys in bulk</li>
                    <li>Submit content that infringes on intellectual property rights of others</li>
                  </ul>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">6. Payment and Billing</h2>
                  <p className="mt-4 leading-7">
                    Paid plans are billed through Stripe. By subscribing to a paid plan, you authorize us to
                    charge the payment method on file. Charges are non-refundable except where required by
                    law. We may change pricing with 30 days&rsquo; notice. Free-tier credits do not carry
                    over between billing periods.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">7. Intellectual Property</h2>
                  <p className="mt-4 leading-7">
                    The Cerul name, logo, API design, and documentation are our property. The video content
                    returned by search results is sourced from publicly available videos and remains the
                    property of its respective owners. We do not claim ownership of your queries or
                    application code.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">8. API Data and Results</h2>
                  <p className="mt-4 leading-7">
                    Search results include metadata, snippets, and timestamps derived from publicly
                    available video content. Results are provided &ldquo;as is.&rdquo; We do not guarantee
                    the accuracy, completeness, or availability of any specific content. Video content may
                    be removed from our index at any time if the source becomes unavailable or upon valid
                    takedown request.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">9. Service Availability</h2>
                  <p className="mt-4 leading-7">
                    We strive to maintain high availability but do not guarantee uninterrupted access. The
                    Service may be temporarily unavailable due to maintenance, updates, or circumstances
                    beyond our control. We will make reasonable efforts to provide advance notice of planned
                    downtime.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">10. Limitation of Liability</h2>
                  <p className="mt-4 leading-7">
                    To the maximum extent permitted by law, Cerul shall not be liable for any indirect,
                    incidental, special, consequential, or punitive damages, or any loss of profits or
                    revenue, whether incurred directly or indirectly, or any loss of data, use, goodwill,
                    or other intangible losses, resulting from your use of the Service.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">11. Disclaimer of Warranties</h2>
                  <p className="mt-4 leading-7">
                    The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
                    warranties of any kind, whether express or implied, including but not limited to implied
                    warranties of merchantability, fitness for a particular purpose, and non-infringement.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">12. Termination</h2>
                  <p className="mt-4 leading-7">
                    We may suspend or terminate your access to the Service at any time for violation of
                    these Terms, with or without notice. You may delete your account at any time. Upon
                    termination, your right to use the Service ceases immediately. Provisions that by their
                    nature should survive termination will survive.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">13. Changes to Terms</h2>
                  <p className="mt-4 leading-7">
                    We may revise these Terms at any time by posting the updated version on this page.
                    Material changes will be communicated via email or a notice on the Service. Continued
                    use of the Service after changes constitutes acceptance of the revised Terms.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">14. Governing Law</h2>
                  <p className="mt-4 leading-7">
                    These Terms are governed by the laws of the State of Delaware, United States, without
                    regard to its conflict of law provisions.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold text-[var(--foreground)]">15. Contact</h2>
                  <p className="mt-4 leading-7">
                    Questions about these Terms? Contact us at{" "}
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
