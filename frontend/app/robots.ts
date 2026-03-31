import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs", "/pricing"],
        disallow: [
          "/admin",
          "/dashboard",
          "/settings",
          "/billing",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
