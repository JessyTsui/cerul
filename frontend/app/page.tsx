import type { Metadata } from "next";
import { AgentDemoConsole } from "@/components/agent-demo-console";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteOrigin } from "@/lib/site-url";
import { marketingMetrics } from "@/lib/site";
import { homeOpenGraphImages, homeTwitterImages } from "@/lib/social-metadata";

const homeDescription =
  "Video understanding search API for AI agents. Search what is shown in videos, not just what is said.";

const siteOrigin = getSiteOrigin();

export const metadata: Metadata = {
  description: homeDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Cerul",
    description: homeDescription,
    url: siteOrigin,
    siteName: "Cerul",
    type: "website",
    images: homeOpenGraphImages,
  },
  twitter: {
    card: "summary_large_image",
    title: "Cerul",
    description: homeDescription,
    images: homeTwitterImages,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Cerul",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  description: homeDescription,
  url: siteOrigin,
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="soft-theme">
        <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
          <SiteHeader currentPath="/" />

          <main className="flex flex-1 flex-col gap-8 py-10 sm:py-12">
            <section className="surface-elevated rounded-[36px] px-6 py-8 sm:px-8 lg:px-10">
              <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
                <div>
                  <span className="label label-brand">Video search for agents</span>
                  <h1 className="display-title mt-5 text-5xl sm:text-6xl">
                    Search what is shown in videos, not just what is said.
                  </h1>
                </div>
                <p className="max-w-2xl text-base leading-8 text-[var(--foreground-secondary)] sm:text-lg">
                  Cerul turns video frames, transcript segments, and summary units into one public
                  search surface. The UI is being rebuilt around that idea too: fewer ornamental
                  flourishes, more product-shaped interfaces.
                </p>
              </div>
            </section>

            <AgentDemoConsole />

            <section className="grid gap-4 lg:grid-cols-3">
              {marketingMetrics.map((metric) => (
                <article
                  key={metric.label}
                  className="surface-elevated rounded-[28px] px-5 py-5"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                    {metric.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {metric.value}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                    {metric.caption}
                  </p>
                </article>
              ))}
            </section>
          </main>

          <SiteFooter />
        </div>
      </div>
    </>
  );
}
