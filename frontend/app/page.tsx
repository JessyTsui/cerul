import type { Metadata } from "next";
import { AgentDemoConsole } from "@/components/agent-demo-console";
import { ParticlesBackground } from "@/components/particles-background";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSiteOrigin } from "@/lib/site-url";
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
      <ParticlesBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/" />

        <main className="flex flex-1 flex-col justify-center gap-8 py-10 sm:py-16">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Search what is <span className="text-[var(--brand-bright)]">shown</span> in videos.
            </h1>
            <p className="mt-3 max-w-lg text-lg text-[var(--foreground-secondary)]">
              Video understanding search API for AI agents. One call, grounded visual results.
            </p>
          </div>

          <AgentDemoConsole />
        </main>

        <SiteFooter />
      </div>
    </>
  );
}
