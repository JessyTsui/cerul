import type { Metadata } from "next";
import { SearchDemo } from "@/components/search/search-demo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { canonicalUrl } from "@/lib/site-url";

const description =
  "Public Cerul search demo for knowledge retrieval, b-roll discovery, and agent-ready video evidence.";

const searchDemoUrl = canonicalUrl("/search");

export const metadata: Metadata = {
  title: "Search Demo",
  description,
  alternates: {
    canonical: "/search",
  },
  openGraph: {
    title: "Search Demo",
    description,
    url: searchDemoUrl,
  },
  twitter: {
    title: "Search Demo",
    description,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Cerul Search Demo",
  description,
  url: searchDemoUrl,
};

export default function SearchPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <SiteHeader currentPath="/search" />
        <main className="flex-1 pt-8">
          <SearchDemo />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
