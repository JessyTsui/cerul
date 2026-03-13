import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/search", "/docs", "/pricing"],
        disallow: [
          "/admin",
          "/dashboard",
          "/settings",
          "/billing",
          "/search/results",
          "/login",
          "/signup",
        ],
      },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
