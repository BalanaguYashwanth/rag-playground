import type { MetadataRoute } from "next";
import { SITE_URL } from "@/constant";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL }];
}