import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { UnifiedSearchDemo } from "@/components/search/unified-search-demo";

export default function SearchPage() {
  return (
    <div className="soft-theme min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1480px] flex-col">
        <SiteHeader currentPath="/search" />
        <main className="flex-1 py-8">
          <UnifiedSearchDemo />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
