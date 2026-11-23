import type { MetadataRoute } from "next";
import { facts } from "@/lib/data/career";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// One page, changed whenever a goal is added: the date of the latest goal says when.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, lastModified: facts.asOf, changeFrequency: "daily", priority: 1 }];
}
