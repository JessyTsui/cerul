"use client";

import { useCallback, useRef, useState } from "react";

type DocsExportMarkdownProps = {
  pageTitle: string;
  pageUrl: string;
  copyRootSelector?: string;
};

export function DocsExportMarkdown({
  pageTitle,
  pageUrl,
  copyRootSelector,
}: DocsExportMarkdownProps) {
  const [state, setState] = useState<"idle" | "done">("idle");
  const timeoutRef = useRef<number | null>(null);

  const exportMarkdown = useCallback(() => {
    const article = document.querySelector(
      copyRootSelector || "[data-ai-copy-root='true'], article, main",
    );

    const clone =
      article instanceof HTMLElement
        ? (article.cloneNode(true) as HTMLElement)
        : null;

    clone?.querySelectorAll("[data-ai-copy-ignore='true']").forEach((node) => {
      node.remove();
    });

    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://cerul.ai";
    const fullUrl = new URL(pageUrl, origin).toString();

    const raw =
      clone?.textContent
        ?.replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() || "";

    const markdown = [
      `# ${pageTitle}`,
      "",
      `> Source: ${fullUrl}`,
      "",
      raw,
    ].join("\n");

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setState("done");
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setState("idle"), 2000);
  }, [pageTitle, pageUrl, copyRootSelector]);

  return (
    <button
      type="button"
      onClick={exportMarkdown}
      data-ai-copy-ignore="true"
      className="focus-ring inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--foreground-secondary)] transition hover:bg-[var(--surface-hover)]"
      title="Download page as Markdown"
    >
      {state === "done" ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Downloaded
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export .md
        </>
      )}
    </button>
  );
}
