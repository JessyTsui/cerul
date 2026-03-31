"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { authClient, getOneTapAuthClient } from "@/lib/auth";
import type { AuthSocialProviderId } from "@/lib/auth-providers";
import {
  buildSocialAuthRedirectOptions,
  getAuthErrorMessage,
} from "@/lib/auth-shared";

type AuthSocialSectionProps = {
  mode: "login" | "signup";
  nextPath: string;
  enabledProviders: AuthSocialProviderId[];
  googleOneTapClientId: string | null;
  onErrorChange: (message: string | null) => void;
};

const PROVIDER_LABELS: Record<AuthSocialProviderId, string> = {
  github: "GitHub",
  google: "Google",
};

type SocialProviderButtonProps = {
  disabled: boolean;
  isPending: boolean;
  providerId: AuthSocialProviderId;
  onClick: (providerId: AuthSocialProviderId) => void;
};

function SocialProviderButton({
  disabled,
  isPending,
  providerId,
  onClick,
}: SocialProviderButtonProps) {
  const label = PROVIDER_LABELS[providerId];

  return (
    <button
      type="button"
      className="focus-ring flex w-full items-center justify-center gap-3 rounded-[18px] border border-[var(--border)] bg-white/78 px-4 py-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={() => onClick(providerId)}
    >
      {providerId === "github" ? (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.31 6.84 9.66.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.05 1.53 1.05.9 1.56 2.35 1.11 2.92.85.09-.67.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.09 0-1.13.39-2.05 1.03-2.77-.1-.26-.45-1.31.1-2.73 0 0 .84-.27 2.75 1.06A9.37 9.37 0 0 1 12 6.84c.85 0 1.71.12 2.51.36 1.91-1.33 2.75-1.06 2.75-1.06.55 1.42.2 2.47.1 2.73.64.72 1.03 1.64 1.03 2.77 0 3.96-2.34 4.82-4.57 5.08.36.32.68.94.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M21.64 12.2c0-.64-.06-1.26-.17-1.84H12v3.48h5.41a4.63 4.63 0 0 1-2 3.04v2.52h3.24c1.9-1.78 2.99-4.4 2.99-7.2Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.97-.91 6.63-2.47l-3.24-2.52c-.9.62-2.05.99-3.39.99-2.6 0-4.8-1.8-5.58-4.21H3.08v2.6A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC04" d="M6.42 13.79A6.08 6.08 0 0 1 6.11 12c0-.62.11-1.22.31-1.79v-2.6H3.08A10.16 10.16 0 0 0 2 12c0 1.64.39 3.19 1.08 4.39l3.34-2.6Z" />
          <path fill="#EA4335" d="M12 5.99c1.47 0 2.8.52 3.84 1.54l2.88-2.95C16.96 2.91 14.7 2 12 2a10 10 0 0 0-8.92 5.61l3.34 2.6C7.2 7.79 9.4 5.99 12 5.99Z" />
        </svg>
      )}
      <span>
        {isPending ? `Connecting to ${label}...` : `Continue with ${label}`}
      </span>
    </button>
  );
}

export function AuthSocialSection({
  mode,
  nextPath,
  enabledProviders,
  googleOneTapClientId,
  onErrorChange,
}: AuthSocialSectionProps) {
  const [pendingProvider, setPendingProvider] = useState<AuthSocialProviderId | null>(null);
  const hasTriggeredOneTap = useRef(false);
  const googleEnabled = enabledProviders.includes("google");

  useEffect(() => {
    if (!googleEnabled || !googleOneTapClientId || hasTriggeredOneTap.current) {
      return;
    }

    hasTriggeredOneTap.current = true;

    void getOneTapAuthClient(googleOneTapClientId)
      .oneTap({
        callbackURL: nextPath,
        context: mode === "signup" ? "signup" : "signin",
        onPromptNotification: () => {
          // Prompt dismissal is expected, so we keep the fallback buttons visible.
        },
      })
      .catch(() => {
        // The manual Google button remains available, so we fail open here.
      });
  }, [googleEnabled, googleOneTapClientId, mode, nextPath]);

  if (enabledProviders.length === 0) {
    return null;
  }

  async function handleSocialSignIn(providerId: AuthSocialProviderId) {
    onErrorChange(null);
    setPendingProvider(providerId);

    try {
      const result = await authClient.signIn.social({
        provider: providerId,
        ...buildSocialAuthRedirectOptions(
          mode === "login" ? "/login" : "/signup",
          nextPath,
        ),
      });

      if (result.error) {
        startTransition(() => {
          onErrorChange(
            getAuthErrorMessage(
              result.error,
              `Unable to continue with ${PROVIDER_LABELS[providerId]}.`,
            ),
          );
        });
      }
    } catch (error) {
      startTransition(() => {
        onErrorChange(
          getAuthErrorMessage(
            error,
            `Unable to continue with ${PROVIDER_LABELS[providerId]}.`,
          ),
        );
      });
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {enabledProviders.map((providerId) => (
          <SocialProviderButton
            key={providerId}
            providerId={providerId}
            disabled={pendingProvider !== null}
            isPending={pendingProvider === providerId}
            onClick={handleSocialSignIn}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
        <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
        <span>Or continue with email</span>
        <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
      </div>
    </div>
  );
}
