"use client";

import { useEffect, useRef } from "react";
import { getOneTapAuthClient } from "@/lib/auth";

type GoogleOneTapProps = {
  clientId: string;
};

export function GoogleOneTap({ clientId }: GoogleOneTapProps) {
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;

    void getOneTapAuthClient(clientId)
      .oneTap({
        callbackURL: "/dashboard",
        context: "signin",
        onPromptNotification: () => {},
      })
      .catch(() => {});
  }, [clientId]);

  return null;
}
