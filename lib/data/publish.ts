// What the browser is sent: the dataset trimmed to what the page draws, and a short
// version stamp for it. Used by the page itself (app/page.tsx) and by the build step
// that writes the same data as files for pages that are already open
// (scripts/prepare-assets.ts), so the two can never drift apart.
import type { Goal, Venue } from "./types";

export type Published = { goals: Goal[]; venues: Venue[] };

/** The published status file: small enough to ask for every minute. */
export type Status = {
  /** Version stamp of the data. A page compares it with the stamp it was built with. */
  v: string;
  total: number;
  asOf: string | null;
  /** "hold" keeps the goal-1,000 celebration from playing. */
  celebration: "auto" | "hold";
  /** Kick-off times of the next fixtures (ISO, UTC), so open pages know when to look often. */
  next?: string[];
};

const MINUTE = 60_000;
/** Around a match an open page looks for news every minute; the rest of the time, every ten. */
export function pollDelay(next: readonly string[] | undefined, now: number): number {
  const matchOn = (next ?? []).some((kickoff) => {
    const t = Date.parse(kickoff);
    return Number.isFinite(t) && now >= t - 15 * MINUTE && now <= t + 4 * 60 * MINUTE;
  });
  return (matchOn ? 1 : 10) * MINUTE;
}

export function forBrowser(goals: readonly unknown[], venues: readonly unknown[]): Published {
  return {
    goals: (goals as (Goal & { src: string[] })[]).map(({ src: _src, ...g }) => ({ ...g, src: [] }) as Goal),
    venues: (venues as (Venue & Record<string, unknown>)[]).map(
      ({ id, name, city, country, lat, lng, periodNames, demolished }) => ({ id, name, city, country, lat, lng, periodNames, demolished }) as Venue,
    ),
  };
}

/** A short, stable stamp for a payload: the same data always gives the same stamp. */
export function versionOf(data: Published): string {
  const text = JSON.stringify(data);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export const celebrationSetting = (overrides: { celebration?: string }): Status["celebration"] => (overrides.celebration === "hold" ? "hold" : "auto");
