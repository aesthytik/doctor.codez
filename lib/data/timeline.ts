// Time helpers for the scrubber: which goal the career had reached on a given day.
import type { Goal, TeamKey } from "./types";

export type Stint = { team: TeamKey; from: string; to: string | null };

/** His club spells. Portugal runs alongside from 2003 to 2026. */
export const STINTS: Stint[] = [
  { team: "sporting", from: "2002-08-14", to: "2003-08-12" },
  { team: "manutd", from: "2003-08-12", to: "2009-07-01" },
  { team: "realmadrid", from: "2009-07-01", to: "2018-07-10" },
  { team: "juventus", from: "2018-07-10", to: "2021-08-31" },
  { team: "manutd", from: "2021-08-31", to: "2022-11-22" },
  { team: "alnassr", from: "2023-01-01", to: null },
];
export const PORTUGAL_SPAN = { from: "2003-08-20", to: "2026-11-05" };

const DAY = 86_400_000;
export const ms = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

export type Clock = {
  start: number;
  end: number;
  times: number[];
  /** Goals scored up to and including this moment. */
  countAt: (t: number) => number;
  /** The moment the n-th goal was scored (n = 0 gives the start). */
  timeOf: (n: number) => number;
  /** Goals per bucket, for the little histogram over the track. */
  buckets: { t0: number; t1: number; n: number }[];
};

export function buildClock(goals: Goal[], bucketDays = 61): Clock {
  const times = goals.map((g) => ms(g.date));
  const first = times[0] ?? Date.now();
  const last = times[times.length - 1] ?? Date.now();
  const start = first - 150 * DAY;
  const end = Math.max(last + 200 * DAY, Date.UTC(2027, 5, 30));
  const countAt = (t: number) => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const buckets: Clock["buckets"] = [];
  for (let t0 = start; t0 < end; t0 += bucketDays * DAY) {
    const t1 = t0 + bucketDays * DAY;
    buckets.push({ t0, t1, n: countAt(t1) - countAt(t0) });
  }
  return { start, end, times, countAt, timeOf: (n) => (n <= 0 ? start : times[Math.min(n, times.length) - 1]), buckets };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYear = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
