"use client";

import { useState } from "react";

type CodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
};

export function CodeBlock({ code, language = "bash", filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const languageLabel = language.toUpperCase();

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="code-window overflow-hidden">
      <div className="code-window-header flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="code-window-dot code-window-dot-red" />
          <span className="code-window-dot code-window-dot-yellow" />
          <span className="code-window-dot code-window-dot-green" />
          <div className="ml-2 flex min-w-0 items-center gap-2">
            {filename ? (
              <span className="truncate font-mono text-xs text-[var(--foreground-tertiary)]">
                {filename}
              </span>
            ) : null}
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
              {languageLabel}
            </span>
          </div>
        </div>
        <button
          onClick={copyCode}
          aria-label={copied ? "Code copied" : "Copy code sample"}
          className="focus-ring flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--foreground-tertiary)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          type="button"
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        className={`language-${language}`}
        data-language={language}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
