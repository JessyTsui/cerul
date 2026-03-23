import Image from "next/image";
import Link from "next/link";

export function AgentDemoConsole() {
  return (
    <section className="surface-elevated overflow-hidden rounded-[36px]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div className="min-w-0 border-b border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,10,17,0.96),rgba(7,10,16,0.98))] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col px-6 py-7 sm:px-8 lg:px-9">
            <div className="mb-6 max-w-[30rem]">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                cURL request
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Start with one explicit API call.
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
                Keep the request visible, change the query, and get to a real result without extra product chrome.
              </p>
            </div>

            <div className="overflow-hidden rounded-[30px] border border-[rgba(103,232,249,0.22)] bg-[rgba(4,8,15,0.98)] shadow-[0_30px_90px_rgba(2,6,18,0.4)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-[rgba(103,232,249,0.18)] bg-[rgba(34,211,238,0.08)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                    POST /v1/search
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
                    search.sh
                  </span>
                </div>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-6 font-mono text-[12px] leading-7 text-[#d9fafe] sm:px-5 sm:text-[13px]">
                <code>{`curl "https://api.cerul.ai/v1/search" \\
  -H "Authorization: Bearer YOUR_CERUL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Sam Altman views on AI video generation tools",
    "max_results": 3,
    "include_answer": true,
    "filters": {
      "speaker": "Sam Altman",
      "source": "youtube"
    }
  }'`}</code>
              </pre>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/docs/search-api" className="button-primary">
                Open docs
              </Link>
              <Link href="/signup" className="button-secondary">
                Get API key
              </Link>
            </div>
          </div>
        </div>

        <div className="min-w-0 bg-[linear-gradient(180deg,rgba(8,13,22,0.96),rgba(6,10,17,0.98))] px-6 py-7 sm:px-8 lg:px-9">
          <div className="flex h-full flex-col justify-center">
            <Link
              href="https://www.youtube.com/watch?v=hmtuvNfytjM&t=1223s"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the matched video on YouTube"
              className="group relative block overflow-hidden rounded-[24px] border border-white/10 bg-[#090b0f] transition-all duration-300 hover:border-[rgba(255,0,0,0.28)] hover:shadow-[0_0_40px_rgba(255,0,0,0.12)]"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-[#05070b]">
                <Image
                  src="/homepage/sam-altman-video-result-preview.webp"
                  alt="Sam Altman on AI video generation"
                  fill
                  sizes="(min-width: 1280px) 42vw, (min-width: 1024px) 48vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white/88 backdrop-blur-md transition-colors group-hover:border-red-500/30 group-hover:text-white">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#ff0000]">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  Watch on YouTube
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff0000] shadow-[0_10px_36px_rgba(255,0,0,0.34)] transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_14px_44px_rgba(255,0,0,0.42)]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                <div className="absolute bottom-4 right-4 rounded-md bg-black/72 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                  20:23
                </div>
              </div>

              <div className="border-t border-white/8 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="text-sm font-semibold text-white transition-colors group-hover:text-red-300 sm:text-base">
                    Sam Altman on AI video generation
                  </h3>
                  <span className="text-sm text-white/45">•</span>
                  <p className="text-sm text-white/62">Lex Fridman Podcast</p>
                </div>
                <p className="mt-2 text-sm text-white/56">
                  Matched at <span className="text-white/78">20:23</span> for “Sam Altman views on AI video generation tools”
                </p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
