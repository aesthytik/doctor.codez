import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { facts } from "@/lib/data/career";
import { GOOGLE_VERIFICATION, MAKER, OG_ALT, OG_IMAGE, SITE_NAME, SITE_URL, headline, summary } from "@/lib/site";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Big_Shoulders({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

const title = headline(facts);
const description = summary(facts);
// The count is part of the picture, so its address changes with the count and link
// previews cached by other sites pick up the new one.
const image = { url: `/og.png?n=${facts.total}`, ...OG_IMAGE, alt: OG_ALT, type: "image/png" };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${title} | ${SITE_NAME}`, template: `%s | ${SITE_NAME}` },
  description,
  applicationName: SITE_NAME,
  authors: [{ name: MAKER.name, url: MAKER.url }],
  creator: MAKER.name,
  category: "sports",
  // Every address of the page (?venue=, ?goal=, ?t= and the rest) is the same page.
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: SITE_NAME, title, description, locale: "en_GB", images: [image] },
  twitter: { card: "summary_large_image", title, description, images: [image] },
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  // Proof of ownership for Google Search Console and, when set, Bing Webmaster Tools.
  verification: { google: GOOGLE_VERIFICATION, other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined },
};

export const viewport: Viewport = {
  themeColor: "#04060b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
