import type { MetadataRoute } from "next";
import { SITE_URL } from "@/constant";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}