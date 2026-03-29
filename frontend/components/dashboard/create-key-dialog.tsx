"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiKeys,
  getApiErrorMessage,
  type CreateApiKeyResponse,
} from "@/lib/api";

type CreateKeyDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => Promise<void> | void;
};

export function CreateKeyDialog({
  isOpen,
  onClose,
  onCreated,
}: CreateKeyDialogProps) {
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
      setName("");
      setCreatedKey(null);
      setError(null);
      setIsSubmitting(false);
      setIsCopied(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Key name is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await apiKeys.create({ name: trimmedName });
      setCreatedKey(result);

      if (onCreated) {
        try {
          await onCreated();
        } catch {
          setError("Key created, but the list could not be refreshed.");
        }
      }
    } catch (nextError) {
      setError(getApiErrorMessage(nextError, "Failed to create API key."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdKey.rawKey);
      setIsCopied(true);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyResetTimeoutRef.current = null;
      }, 2000);
    } catch {
      setError("Copy failed. Store the key securely before closing this dialog.");
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      onClick={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="surface-elevated w-full max-w-[560px] px-6 py-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
              API key
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              {createdKey ? "Store this key now" : "Create a new API key"}
            </h2>
          </div>
          <button
            aria-label="Close dialog"
            className="button-ghost h-11 w-11 px-0"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            X
          </button>
        </div>

        {createdKey ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-[20px] border border-[var(--border-brand)] bg-[var(--brand-subtle)] px-5 py-5">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--brand-bright)]">
                Visible once
              </p>
              <p className="mt-3 font-mono text-sm leading-7 break-all text-[var(--foreground)]">
                {createdKey.rawKey}
              </p>
            </div>

            <p className="text-sm leading-6 text-[var(--foreground-secondary)]">
              Cerul only returns the raw key once. Copy it now and store it in your
              secrets manager before closing this dialog.
            </p>

            {error ? (
              <div className="rounded-[18px] border border-[rgba(177,132,24,0.18)] bg-[rgba(177,132,24,0.1)] px-4 py-3 text-sm text-[var(--warning)]">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                className="button-secondary"
                onClick={handleCopy}
                type="button"
              >
                {isCopied ? "Copied" : "Copy key"}
              </button>
              <button className="button-primary" onClick={onClose} type="button">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label
                className="mb-2 block text-sm font-medium text-[var(--foreground)]"
                htmlFor="dashboard-key-name"
              >
                Key name
              </label>
              <input
                autoFocus
                className="h-12 w-full rounded-[14px] border border-[var(--border)] bg-white/78 px-4 text-[var(--foreground)] outline-none transition placeholder:text-[var(--foreground-tertiary)] focus:border-[var(--border-brand)]"
                id="dashboard-key-name"
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production automation"
                value={name}
              />
              <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
                Use a descriptive name so admins can revoke the correct key later.
              </p>
            </div>

            {error ? (
              <div className="rounded-[18px] border border-[rgba(191,91,70,0.2)] bg-[rgba(191,91,70,0.08)] px-4 py-3 text-sm text-[var(--error)]">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                className="button-secondary"
                disabled={isSubmitting}
                onClick={onClose}
                type="button"
              >
                Cancel
              </button>
              <button className="button-primary" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Creating..." : "Create key"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
