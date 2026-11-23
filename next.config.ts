import type { NextConfig } from "next";

// The site is exported as plain static files (HTML, CSS, JS, JSON) so it can sit
// on any static host and ride out a traffic spike without a server.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
