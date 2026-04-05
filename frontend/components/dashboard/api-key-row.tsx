"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardApiKey } from "@/lib/api";
import { formatDashboardDateTime } from "@/lib/dashboard";

type ApiKeyRowProps = {
  apiKey: DashboardApiKey;
  isPending: boolean;
  onRevoke: (apiKey: DashboardApiKey) => void;
  compact?: boolean;
  isLastKey?: boolean;
};

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="M2.036 12.322a1 1 0 0 1 0-.644C3.423 7.51 7.36 4.5 12 4.5s8.577 3.01 9.964 7.178a1 1 0 0 1 0 .644C20.577 16.49 16.64 19.5 12 19.5s-8.577-3.01-9.964-7.178Z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function IconEyeSlash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="m3 3 18 18M10.585 10.587A2 2 0 0 0 13.414 13.4M9.88 5.09A10.97 10.97 0 0 1 12 4.5c4.64 0 8.577 3.01 9.964 7.178a1 1 0 0 1 0 .644 11.052 11.052 0 0 1-4.293 5.226M6.228 6.228A11.053 11.053 0 0 0 2.036 11.68a1 1 0 0 0 0 .644C3.423 16.49 7.36 19.5 12 19.5c1.617 0 3.156-.365 4.534-1.02"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.334a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function maskedKey(prefix: string): string {
  return `${prefix}${"*".repeat(28)}`;
}

function ActionButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--foreground-tertiary)] transition hover:bg-[rgba(36,29,21,0.06)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function CopyFeedback({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-full bg-[var(--foreground)] px-2 py-1 text-[10px] font-medium text-white shadow-sm">
      Copied!
    </span>
  );
}

export function ApiKeyRow({
  apiKey,
  isPending,
  onRevoke,
  compact,
  isLastKey,
}: ApiKeyRowProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const revealTimeoutRef = useRef<number | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const canAccessRawKey = Boolean(apiKey.rawKey);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  function handleReveal() {
    if (!apiKey.rawKey) {
      return;
    }
    if (isVisible) {
      setIsVisible(false);
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      return;
    }
    setIsVisible(true);
    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current);
    }
    revealTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
      revealTimeoutRef.current = null;
    }, 4000);
  }

  async function handleCopy() {
    if (!apiKey.rawKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(apiKey.rawKey);
      setIsCopied(true);

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setIsCopied(false);
    }
  }

  const displayKey = isVisible && apiKey.rawKey ? apiKey.rawKey : maskedKey(apiKey.prefix);
  const rawKeyTitle = canAccessRawKey ? "Plaintext key will auto-hide in 4 seconds." : "Plaintext unavailable for this key.";
  const deleteTitle = isLastKey
    ? "Cannot delete last key"
    : isPending
      ? "Revoking..."
      : apiKey.isActive
        ? "Delete key"
        : "Already revoked";

  const actions = (
    <div className="flex items-center justify-end gap-1">
      <ActionButton
        title={isVisible ? "Visible now" : rawKeyTitle}
        disabled={!canAccessRawKey}
        onClick={handleReveal}
      >
        {isVisible ? <IconEyeSlash className="h-[18px] w-[18px]" /> : <IconEye className="h-[18px] w-[18px]" />}
      </ActionButton>
      <div className="relative">
        <CopyFeedback visible={isCopied} />
        <ActionButton
          title={isCopied ? "Copied!" : canAccessRawKey ? "Copy key" : "Plaintext unavailable for this key."}
          disabled={!canAccessRawKey}
          onClick={() => void handleCopy()}
        >
          {isCopied ? <IconCheck className="h-[18px] w-[18px]" /> : <IconCopy className="h-[18px] w-[18px]" />}
        </ActionButton>
      </div>
      <ActionButton
        title={deleteTitle}
        disabled={isPending || !apiKey.isActive || isLastKey}
        onClick={() => onRevoke(apiKey)}
      >
        <IconTrash className="h-[18px] w-[18px]" />
      </ActionButton>
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--foreground)]">{apiKey.name}</p>
          <p className="break-all font-mono text-xs text-[var(--foreground-tertiary)]">{displayKey}</p>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <tr className="border-t border-[var(--border)] text-[var(--foreground-secondary)]">
      <td className="px-5 py-4">
        <p className="font-medium text-[var(--foreground)]">{apiKey.name}</p>
      </td>
      <td className="px-5 py-4">
        <div className="inline-flex max-w-full items-center gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--background-elevated,rgba(255,250,242,1))] px-3 py-1.5">
          <code className="max-w-[360px] break-all whitespace-normal font-mono text-[13px] text-[var(--foreground)]">
            {displayKey}
          </code>
        </div>
      </td>
      <td className="px-5 py-4 text-sm">{formatDashboardDateTime(apiKey.createdAt)}</td>
      <td className="px-5 py-4 text-sm">{formatDashboardDateTime(apiKey.lastUsedAt)}</td>
      <td className="px-5 py-4 text-right">{actions}</td>
    </tr>
  );
}
