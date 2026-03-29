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
    <div className="overflow-hidden rounded-[20px] border border-[#2b2621] bg-[#15120f] shadow-[0_18px_44px_rgba(20,15,11,0.22)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[#1d1916] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
              {filename || `${language}.example`}
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
            {language}
          </span>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-5 font-mono text-sm leading-7 text-[#f6f1e7]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
