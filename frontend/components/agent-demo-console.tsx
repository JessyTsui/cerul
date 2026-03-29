import Image from "next/image";
import Link from "next/link";

export function AgentDemoConsole() {
  return (
    <section className="surface-elevated overflow-hidden rounded-[36px]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 border-b border-[var(--border)] px-6 py-7 sm:px-8 lg:border-b-0 lg:border-r lg:px-9">
          <div className="max-w-[34rem]">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]">
              Example request
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
              One explicit API call, then a grounded video result.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground-secondary)]">
              The goal is not to hide the API. The UI should make the contract feel clearer and
              more usable, which is exactly why the new playground leans into request-and-response
              structure instead of abstract demo chrome.
            </p>
          </div>

          <div className="mt-6 overflow-hidden rounded-[28px] border border-[rgba(34,28,23,0.08)] bg-[#171514] shadow-[0_24px_60px_rgba(20,15,11,0.18)]">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
                  POST /v1/search
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
                  search.sh
                </span>
              </div>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-6 font-mono text-[12px] leading-7 text-[#f6f1e7] sm:px-5 sm:text-[13px]">
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
            <Link href="/search" className="button-primary">
              Open playground
            </Link>
            <Link href="/docs/quickstart" className="button-secondary">
              Read quickstart
            </Link>
          </div>
        </div>

        <div className="min-w-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.52),rgba(255,250,244,0.72))] px-6 py-7 sm:px-8 lg:px-9">
          <div className="rounded-[30px] border border-[var(--border)] bg-white/78 p-4 shadow-[0_18px_44px_rgba(36,29,21,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  Matched result
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                  Grounded answer with outbound evidence
                </p>
              </div>
              <span className="rounded-full border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                YouTube match
              </span>
            </div>

            <Link
              href="https://www.youtube.com/watch?v=hmtuvNfytjM&t=1223s"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the matched video on YouTube"
              className="group mt-5 block overflow-hidden rounded-[26px] border border-[var(--border)] bg-[#0f0d0b] transition hover:border-[rgba(255,0,0,0.22)] hover:shadow-[0_12px_34px_rgba(255,0,0,0.08)]"
            >
              <div className="relative aspect-video w-full overflow-hidden">
                <Image
                  src="/homepage/sam-altman-video-result-preview.webp"
                  alt="Sam Altman on AI video generation"
                  fill
                  sizes="(min-width: 1280px) 42vw, (min-width: 1024px) 48vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
                <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white/88 backdrop-blur-md">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#ff0000]">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  Watch on YouTube
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff0000] shadow-[0_10px_36px_rgba(255,0,0,0.34)] transition-all duration-300 group-hover:scale-105">
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

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Unit type", "speech"],
                ["Tracking URL", "cerul.ai/v/..."],
                ["Relevance", "94%"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[18px] border border-[var(--border)] bg-[var(--background-elevated)] px-4 py-4"
                >
                  <p className="text-xs text-[var(--foreground-tertiary)]">{label}</p>
                  <p className="mt-2 text-base font-semibold text-[var(--foreground)]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
