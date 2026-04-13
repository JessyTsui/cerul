"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ApiReferenceEndpoint = {
  id: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  title: string;
};

type ApiReferenceSidebarProps = {
  groups: Array<[string, ApiReferenceEndpoint[]]>;
};

export function ApiReferenceSidebar({
  groups,
}: ApiReferenceSidebarProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center justify-between rounded-[16px] border border-[var(--border)] bg-[rgba(255,252,247,0.76)] px-4 py-3 text-left text-sm text-[var(--foreground-secondary)] shadow-[0_12px_28px_rgba(36,29,21,0.05)] lg:hidden"
      >
        <span>API navigation</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--brand-bright)]">
          Open
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[135] lg:hidden">
          <button
            type="button"
            aria-label="Close API navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(36,29,21,0.32)] backdrop-blur-sm"
          />

          <aside className="absolute inset-y-0 left-0 w-[min(88vw,360px)] max-w-full overflow-y-auto border-r border-[var(--border)] bg-[rgba(255,252,247,0.98)] p-5 shadow-[0_24px_80px_rgba(36,29,21,0.18)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <Link
                  href="/docs"
                  onClick={() => setOpen(false)}
                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]"
                >
                  Documentation
                </Link>
                <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                  API Reference
                </p>
              </div>
              <button
                type="button"
                aria-label="Close API navigation"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-white/80 text-[var(--foreground-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 space-y-5">
              {groups.map(([groupName, endpoints]) => (
                <section key={groupName}>
                  <h2 className="px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                    {groupName}
                  </h2>
                  <div className="mt-2 space-y-1">
                    {endpoints.map((endpoint) => (
                      <a
                        key={endpoint.id}
                        href={`#${endpoint.id}`}
                        onClick={() => setOpen(false)}
                        className="block rounded-[14px] border-l-2 border-l-transparent px-3 py-2.5 transition hover:bg-white/70"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getMethodClasses(endpoint.method)}`}
                          >
                            {endpoint.method}
                          </span>
                          <span className="truncate text-sm text-[var(--foreground)]">
                            {endpoint.path}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--foreground-secondary)]">
                          {endpoint.title}
                        </p>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

      <aside className="hidden lg:block">
        <div className="sticky top-20 h-fit max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-[24px] border border-[var(--border)] bg-[rgba(255,252,247,0.78)] p-4 shadow-[0_18px_40px_rgba(36,29,21,0.06)] backdrop-blur-xl">
          <div className="border-b border-[var(--border)] pb-4">
            <Link
              href="/docs"
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--brand-bright)]"
            >
              Documentation
            </Link>
            <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
              API Reference
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--foreground-secondary)]">
              Stable public routes only.
            </p>
          </div>

          <div className="mt-4 space-y-5">
            {groups.map(([groupName, endpoints]) => (
              <section key={groupName}>
                <h2 className="px-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--foreground-tertiary)]">
                  {groupName}
                </h2>
                <div className="mt-2 space-y-1">
                  {endpoints.map((endpoint) => (
                    <a
                      key={endpoint.id}
                      href={`#${endpoint.id}`}
                      className="block rounded-[14px] border-l-2 border-l-transparent px-3 py-2.5 transition hover:bg-white/70"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getMethodClasses(endpoint.method)}`}
                        >
                          {endpoint.method}
                        </span>
                        <span className="truncate text-sm text-[var(--foreground)]">
                          {endpoint.path}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--foreground-secondary)]">
                        {endpoint.title}
                      </p>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

function getMethodClasses(method: "GET" | "POST" | "DELETE") {
  if (method === "GET") {
    return "border-[rgba(31,141,74,0.18)] bg-[rgba(31,141,74,0.12)] text-[var(--success)]";
  }

  if (method === "DELETE") {
    return "border-[rgba(191,91,70,0.18)] bg-[rgba(191,91,70,0.12)] text-[var(--error)]";
  }

  return "border-[var(--border-brand)] bg-[var(--brand-subtle)] text-[var(--brand-bright)]";
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}
