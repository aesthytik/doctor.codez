import type { MetadataRoute } from "next";
import { facts } from "@/lib/data/career";
import { SITE_NAME, summary } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: every Cristiano Ronaldo goal, on the map`,
    short_name: SITE_NAME,
    description: summary(facts),
    start_url: "/",
    display: "standalone",
    background_color: "#04060b",
    theme_color: "#04060b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
