"use client";

import { useState } from "react";

type CodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
};

export function CodeBlock({
  code,
  language = "bash",
  filename,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures.
    }
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[#0b111b] shadow-[0_18px_44px_rgba(2,6,18,0.18)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-400/80" />
            <span className="h-2 w-2 rounded-full bg-amber-300/80" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          </div>
          <div className="min-w-0">
            {filename ? (
              <p className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                {filename}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-xs text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-white"
        >
          {copied ? "Copied" : `Copy ${language.toUpperCase()}`}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#d7f7ff]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
