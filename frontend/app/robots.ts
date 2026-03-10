import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs", "/pricing"],
        disallow: [
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
