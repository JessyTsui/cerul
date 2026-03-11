"use client";

import { createAuthClient } from "better-auth/react";

const configuredBaseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const authClient = createAuthClient({
  ...(configuredBaseUrl ? { baseURL: configuredBaseUrl } : {}),
  fetchOptions: {
    credentials: "include",
  },
});
