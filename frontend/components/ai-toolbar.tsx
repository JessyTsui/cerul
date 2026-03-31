"use client";

import { useEffect, useId, useRef, useState } from "react";

type AIToolbarProps = {
  pageUrl?: string;
  pageTitle?: string;
  className?: string;
  copyRootSelector?: string;
};

type OpenPlatform = "github" | "chatgpt" | "claude";

interface OpenOption {
  id: OpenPlatform;
  label: string;
  icon: React.ReactNode;
  href: string;
  accent: string;
}

export function AIToolbar({
  pageUrl,
  pageTitle = "Document",
  className = "",
  copyRootSelector,
}: AIToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const menuId = useId();

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);

    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);

      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const getFullUrl = () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://cerul.ai";

    return pageUrl ? new URL(pageUrl, origin).toString() : origin;
  };

  const fullUrl = getFullUrl();
  const englishPrompt = encodeURIComponent(
    `Read ${fullUrl} titled "${pageTitle}". I want to ask questions about it.`,
  );

  const openOptions: OpenOption[] = [
    {
      id: "github",
      label: "Open in GitHub",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      ),
      href: "https://github.com/cerul-ai/cerul",
      accent: "bg-slate-700 text-slate-100",
    },
    {
      id: "chatgpt",
      label: "Open in ChatGPT",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      href: `https://chatgpt.com/?hints=search&q=${englishPrompt}`,
      accent: "bg-emerald-500/20 text-emerald-400",
    },
    {
      id: "claude",
      label: "Open in Claude",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      ),
      href: `https://claude.ai/new?q=${englishPrompt}`,
      accent: "bg-amber-500/20 text-amber-400",
    },
  ];

  const copyContent = async () => {
    try {
      const article = document.querySelector(
        copyRootSelector || "[data-ai-copy-root='true'], article, main, [role='main']",
      );
      const safeTitle = pageTitle.trim() || "Document";
      const clonedArticle =
        article instanceof HTMLElement
          ? (article.cloneNode(true) as HTMLElement)
          : null;

      clonedArticle?.querySelectorAll("[data-ai-copy-ignore='true']").forEach((node) => {
        node.remove();
      });

      const textContent =
        clonedArticle?.textContent
          ?.replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim() || "";
      const content = textContent
        ? `# ${safeTitle}\n\n${textContent}`
        : fullUrl;

      await navigator.clipboard.writeText(content);

      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const handleOpen = (option: OpenOption) => {
    window.open(option.href, "_blank", "noopener,noreferrer");
    setMenuOpen(false);
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      data-ai-copy-ignore="true"
    >
      <button
        onClick={copyContent}
        className="focus-ring inline-flex items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-subtle)] px-3 py-2 text-sm font-medium text-[var(--accent-bright)] transition hover:bg-[var(--accent)]/20"
        title="Copy page content"
        type="button"
      >
        {copied ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </>
        )}
      </button>

      <div className="relative" ref={menuRef}>
        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="focus-ring inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--foreground-secondary)] transition hover:bg-[var(--surface-hover)]"
        >
          Open with AI
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] p-2 shadow-xl"
            id={menuId}
            role="menu"
          >
            {openOptions.map((option) => (
              <button
                aria-label={option.label}
                key={option.id}
                type="button"
                onClick={() => handleOpen(option)}
                className="focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--foreground-secondary)] transition hover:bg-[var(--surface)]"
                role="menuitem"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${option.accent}`}>
                  {option.icon}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
