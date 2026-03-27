import type { MiddlewareHandler } from "hono";

import { allowedWebOrigins, getConfig } from "../config";

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return allowedOrigins.includes(normalizedOrigin);
}

export function corsMiddleware(): MiddlewareHandler {
  return async (c: any, next: () => Promise<void>) => {
    const origin = c.req.header("origin");
    const config = getConfig(c.env);
    const allowedOrigins = allowedWebOrigins(c.env);

    if (origin && isAllowedOrigin(origin, allowedOrigins)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }

    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Authorization,Content-Type,Stripe-Signature");

    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Max-Age", "86400");
      return c.body(null, 204);
    }

    c.set("config", config);
    await next();
  };
}
