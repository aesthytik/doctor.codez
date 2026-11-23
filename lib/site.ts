// The site's name and address, and the words search engines and link previews are given.
// The numbers in them come from the dataset, so every build after a goal says the new count.
import type { CareerFacts } from "./data/facts";

export const SITE_NAME = "A Thousand Lights";
export const TAGLINE = "Every Cristiano Ronaldo goal, where it happened.";

const DEFAULT_URL = "https://a-thousand-lights.vercel.app";
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
/**
 * Where the site is published, without a trailing slash. Set SITE_URL to move it to a
 * domain of its own; on Vercel the project's production domain is used automatically.
 */
export const SITE_URL = (process.env.SITE_URL ?? (vercelDomain ? `https://${vercelDomain}` : DEFAULT_URL)).replace(/\/+$/, "");

export const MAKER = { name: "aesthytik", url: "https://github.com/aesthytik" };

/** The picture for link previews, drawn by app/og.png/route.tsx. */
export const OG_IMAGE = { width: 1200, height: 630 };
export const OG_ALT = `${SITE_NAME}: every Cristiano Ronaldo goal as a point of light on the globe`;

const num = (n: number) => n.toLocaleString("en-GB");

/** The page title, without the site's name. */
export function headline(f: CareerFacts): string {
  const tail = f.remaining > 0 ? `${f.remaining} to go to ${num(f.target)}` : "every one, where it was scored";
  return `Cristiano Ronaldo's ${num(f.total)} goals, mapped: ${tail}`;
}

/** The description shown under the title in search results and link previews. */
export function summary(f: CareerFacts): string {
  const count = f.remaining > 0 ? `${num(f.total)} so far, ${f.remaining} to go to ${num(f.target)}.` : `All ${num(f.total)} of them, past ${num(f.target)}.`;
  return `Every Cristiano Ronaldo career goal as a point of light on a 3D globe, at the stadium where it was scored. ${count} An unofficial fan tribute.`;
}
