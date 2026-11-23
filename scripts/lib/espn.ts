// Thin, polite client for the public ESPN soccer feed.
// Every response is trimmed and cached on disk so a rerun costs no requests.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
export const RONALDO_ID = "22774";

const CACHE_DIR = path.resolve(import.meta.dirname, "../../.cache/espn");
const MIN_GAP_MS = Number(process.env.ESPN_GAP_MS ?? 700);

let lastCall = 0;
export const stats = { network: 0, cached: 0, failed: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(): Promise<void> {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

/** Fetch JSON with retries. Returns null on a definitive 4xx. Throws after repeated failures. */
export async function fetchJson(url: string): Promise<unknown | null> {
  let delay = 2000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await throttle();
    stats.network++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (res.status === 404 || res.status === 400) return null;
      if (res.ok) return await res.json();
      // 429 / 5xx: back off and retry
    } catch {
      // network error or timeout: retry
    }
    await sleep(delay);
    delay *= 2;
  }
  stats.failed++;
  throw new Error(`Giving up on ${url}`);
}

/**
 * Cached fetch. `trim` reduces the payload to what we keep. A definitive
 * "not found" is cached too, so it is not asked for again.
 */
export async function cached<T>(
  key: string,
  url: string,
  trim: (raw: any) => T,
  opts: { refresh?: boolean } = {},
): Promise<T | null> {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!opts.refresh) {
    try {
      const hit = JSON.parse(await readFile(file, "utf8"));
      stats.cached++;
      return hit.__missing ? null : (hit as T);
    } catch {
      // not cached yet
    }
  }
  const raw = await fetchJson(url);
  await mkdir(path.dirname(file), { recursive: true });
  if (raw === null) {
    await writeFile(file, JSON.stringify({ __missing: true }));
    return null;
  }
  const trimmed = trim(raw);
  await writeFile(file, JSON.stringify(trimmed));
  return trimmed;
}

// ---------- shapes we keep ----------

export type FeedCompetitor = {
  id: string;
  name: string;
  homeAway: "home" | "away";
  score: number | null;
  shootout: number | null;
};

export type FeedScheduleEvent = {
  id: string;
  date: string;
  league: string | null;
  seasonName: string | null;
  round: string | null;
  completed: boolean;
  statusDetail: string | null;
  neutral: boolean;
  venue: { name: string | null; city: string | null; country: string | null };
  competitors: FeedCompetitor[];
};

export type FeedDetail = {
  typeId: string | null;
  type: string | null;
  clock: string | null;
  clockValue: number | null;
  team: string | null;
  scoring: boolean;
  shootout: boolean;
  penalty: boolean;
  ownGoal: boolean;
  athletes: { id: string; name: string }[];
};

export type FeedEvent = {
  id: string;
  date: string;
  seasonYear: number | null;
  seasonSlug: string | null;
  note: string | null;
  notes: string[];
  statusName: string | null;
  statusDetail: string | null;
  completed: boolean;
  neutral: boolean | null;
  venue: { id: string | null; name: string | null; city: string | null; country: string | null };
  competitors: FeedCompetitor[];
  details: FeedDetail[];
};

export type FeedKeyEvent = {
  type: string | null;
  clock: string | null;
  period: number | null;
  text: string | null;
  team: string | null;
  shootout: boolean;
  participants: { id: string; name: string }[];
};

export type FeedSummary = {
  league: string | null;
  seasonName: string | null;
  goals: FeedKeyEvent[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "object" ? (v as any).value ?? (v as any).displayValue : v);
  return Number.isFinite(n) ? n : null;
};

function competitors(list: any[]): FeedCompetitor[] {
  return (list ?? []).map((t) => ({
    id: String(t.team?.id ?? t.id),
    name: t.team?.displayName ?? t.team?.name ?? "",
    homeAway: t.homeAway,
    score: num(t.score),
    shootout: num(t.shootoutScore ?? t.score?.shootoutScore),
  }));
}

export function trimSchedule(raw: any): FeedScheduleEvent[] {
  return (raw.events ?? []).map((e: any): FeedScheduleEvent => {
    const c = e.competitions?.[0] ?? {};
    const st = c.status?.type ?? e.status?.type ?? {};
    return {
      id: String(e.id),
      date: e.date,
      league: e.league?.slug ?? null,
      seasonName: e.season?.displayName ?? null,
      round: e.seasonType?.name ?? null,
      completed: Boolean(st.completed),
      statusDetail: st.detail ?? st.description ?? null,
      neutral: Boolean(c.neutralSite),
      venue: {
        name: c.venue?.fullName ?? null,
        city: c.venue?.address?.city ?? null,
        country: c.venue?.address?.country ?? null,
      },
      competitors: competitors(c.competitors),
    };
  });
}

export function trimEvent(raw: any): FeedEvent {
  const c = raw.competitions?.[0] ?? {};
  const st = c.status?.type ?? raw.status?.type ?? {};
  return {
    id: String(raw.id),
    date: raw.date,
    seasonYear: raw.season?.year ?? null,
    seasonSlug: raw.season?.slug ?? null,
    note: c.altGameNote ?? null,
    notes: (c.notes ?? []).map((n: any) => n.text ?? n.headline).filter(Boolean),
    statusName: st.name ?? null,
    statusDetail: st.detail ?? null,
    completed: Boolean(st.completed),
    neutral: typeof c.neutralSite === "boolean" ? c.neutralSite : null,
    venue: {
      id: c.venue?.id ? String(c.venue.id) : null,
      name: c.venue?.fullName ?? null,
      city: c.venue?.address?.city ?? null,
      country: c.venue?.address?.country ?? null,
    },
    competitors: competitors(c.competitors),
    details: (c.details ?? []).map(
      (d: any): FeedDetail => ({
        typeId: d.type?.id ?? null,
        type: d.type?.text ?? null,
        clock: d.clock?.displayValue ?? null,
        clockValue: typeof d.clock?.value === "number" ? d.clock.value : null,
        team: d.team?.id ? String(d.team.id) : null,
        scoring: Boolean(d.scoringPlay),
        shootout: Boolean(d.shootout),
        penalty: Boolean(d.penaltyKick),
        ownGoal: Boolean(d.ownGoal),
        athletes: (d.athletesInvolved ?? []).map((a: any) => ({
          id: String(a.id),
          name: a.displayName ?? a.fullName ?? "",
        })),
      }),
    ),
  };
}

export function trimSummary(raw: any): FeedSummary {
  return {
    league: raw.header?.league?.slug ?? null,
    seasonName: raw.header?.season?.name ?? null,
    goals: (raw.keyEvents ?? [])
      .filter((k: any) => k.scoringPlay)
      .map(
        (k: any): FeedKeyEvent => ({
          type: k.type?.text ?? null,
          clock: k.clock?.displayValue ?? null,
          period: k.period?.number ?? null,
          text: k.text ?? null,
          team: k.team?.id ? String(k.team.id) : null,
          shootout: Boolean(k.shootout),
          participants: (k.participants ?? []).map((p: any) => ({
            id: String(p.athlete?.id ?? ""),
            name: p.athlete?.displayName ?? "",
          })),
        }),
      ),
  };
}

export const scheduleUrl = (league: string, team: string, season: number, fixtures = false) =>
  `${SITE}/${league}/teams/${team}/schedule?season=${season}${fixtures ? "&fixture=true" : ""}`;
export const eventUrl = (league: string, id: string) => `${SITE}/${league}/scoreboard/${id}`;
export const summaryUrl = (league: string, id: string) => `${SITE}/${league}/summary?event=${id}`;
