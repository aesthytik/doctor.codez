// Reading Cristiano Ronaldo's goals out of the match feed: which matches to look at,
// and how one match record becomes goal facts. Shared by the full history sweep
// (scripts/build-history.ts) and the post-match updater (scripts/update-latest.ts).
//
// Nothing here decides the official count: scripts/build-dataset.ts merges these
// facts with the hand-entered goals and corrections.
import {
  RONALDO_ID,
  cached,
  eventUrl,
  scheduleUrl,
  summaryUrl,
  trimEvent,
  trimSchedule,
  trimSummary,
  type FeedDetail,
  type FeedEvent,
  type FeedKeyEvent,
  type FeedScheduleEvent,
  type FeedSummary,
} from "./espn.ts";
import { parseGoalText, type GoalTextFacts } from "./goal-text.ts";

export type TeamKey = "manutd" | "realmadrid" | "juventus" | "alnassr" | "portugal";

const TODAY = new Date().toISOString().slice(0, 10);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export type Stint = { team: TeamKey; espnTeam: string; from: string; to: string; seasons: number[] };

/** The spells he spent at each club, with the feed's team id and season keys. */
export const CLUB_STINTS: Stint[] = [
  { team: "manutd", espnTeam: "360", from: "2003-08-12", to: "2009-06-30", seasons: range(2003, 2008) },
  { team: "realmadrid", espnTeam: "86", from: "2009-07-01", to: "2018-07-09", seasons: range(2009, 2017) },
  { team: "juventus", espnTeam: "111", from: "2018-07-10", to: "2021-08-30", seasons: range(2018, 2021) },
  { team: "manutd", espnTeam: "360", from: "2021-08-31", to: "2022-11-22", seasons: [2021, 2022] },
  { team: "alnassr", espnTeam: "817", from: "2022-12-30", to: TODAY, seasons: range(2022, new Date().getUTCFullYear()) },
];

/** The club he plays for now. Every goal still to come is scored here. */
export const CURRENT_STINT = CLUB_STINTS[CLUB_STINTS.length - 1];

/** Portugal: debut 20 Aug 2003, international retirement announced 5 Nov 2026. */
export const PORTUGAL = { team: "portugal" as TeamKey, espnTeam: "482", from: "2003-08-20", to: "2026-11-05" };
export const INTL_LEAGUES = [
  "fifa.friendly",
  "uefa.euro",
  "uefa.euroq",
  "fifa.world",
  "fifa.worldq.uefa",
  "uefa.nations",
  "fifa.confederations",
];
export const INTL_SEASONS = range(2003, 2026);

/**
 * Club competitions that count. The feed files pre-season tours and exhibition
 * trophies (International Champions Cup, Joan Gamper, the MLS All-Star game…)
 * next to real fixtures, so anything not named here is skipped and listed in the
 * report for a human to classify.
 */
export const OFFICIAL_CLUB_LEAGUES = new Set([
  "eng.1",
  "eng.fa",
  "eng.league_cup",
  "eng.charity",
  "esp.1",
  "esp.copa_del_rey",
  "esp.super_cup",
  "ita.1",
  "ita.coppa_italia",
  "ita.super_cup",
  "ksa.1",
  "ksa.kings.cup",
  "uefa.champions",
  "uefa.champions_qual",
  "uefa.europa",
  "uefa.super_cup",
  "fifa.cwc",
  "afc.champions",
  "afc.champions_qual",
  "afc.cup",
  "afc.cup_qual",
]);
export const isExhibition = (league: string) => !OFFICIAL_CLUB_LEAGUES.has(league);

/**
 * Matches that exist in the feed but are missing from its season schedules.
 * Found by comparing the sweep against the published list of his international goals.
 */
export const EXTRA_EVENTS: { id: string; league: string; team: TeamKey; espnTeam: string; why: string }[] = [
  { id: "334595", league: "fifa.worldq.uefa", team: "portugal", espnTeam: "482", why: "Luxembourg v Portugal, 7 Sep 2012" },
  { id: "360180", league: "fifa.friendly", team: "portugal", espnTeam: "482", why: "Portugal v Ecuador, 6 Feb 2013" },
];

export type Match = FeedScheduleEvent & { teamKey: TeamKey; espnTeam: string; league: string };

export type GoalFact = {
  eventId: string;
  league: string;
  team: TeamKey;
  kickoff: string;
  seasonName: string | null;
  round: string | null;
  note: string | null;
  opponent: { id: string; name: string };
  designated: "home" | "away";
  venue: { id: string | null; name: string | null; city: string | null; country: string | null };
  clock: string;
  minute: number;
  added: number;
  typeRaw: string | null;
  penalty: boolean;
  /** Ronaldo's team first. Null when the feed's scoring plays do not add up to the final score. */
  scoreBefore: [number, number] | null;
  scoreAfter: [number, number] | null;
  final: [number, number];
  shootout: [number, number] | null;
  statusDetail: string | null;
  /** 1-based position among his goals in this match. */
  seq: number;
  assist: { id: string; name: string } | null;
  text: GoalTextFacts | null;
};

export type SweepReport = ReturnType<typeof newReport>;

export function newReport() {
  return {
    generatedAt: new Date().toISOString(),
    coverage: [] as { team: TeamKey; season: number | string; matches: number; leagues: Record<string, number> }[],
    exhibitionSkipped: {} as Record<string, number>,
    noDetails: [] as { eventId: string; league: string; date: string; name: string; score: string }[],
    scoreMismatch: [] as { eventId: string; league: string; date: string; name: string; score: string; plays: number }[],
    nameWithoutId: [] as { eventId: string; date: string; athlete: string }[],
    missingEvents: [] as { eventId: string; league: string; date: string }[],
    summaryMismatch: [] as { eventId: string; date: string; feed: number; summary: number }[],
    listedScoreless: 0,
    totals: {} as Record<string, number>,
    requests: { network: 0, cached: 0 },
  };
}

const inWindow = (iso: string, from: string, to: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

/** The order goals are stored in: by kick-off, then by the moment they were scored. */
export const byMoment = (a: GoalFact, b: GoalFact) =>
  a.kickoff.localeCompare(b.kickoff) || a.minute - b.minute || a.added - b.added || a.seq - b.seq;

/**
 * The finished, official matches of one club spell in one season of the feed.
 * `refresh` re-reads the schedule instead of trusting the copy on disk.
 */
export async function clubSeasonMatches(
  stint: Stint,
  season: number,
  report: SweepReport,
  opts: { refresh?: boolean; maxAgeMs?: number } = {},
): Promise<{ matches: Match[]; leagues: Record<string, number>; schedule: FeedScheduleEvent[] }> {
  const schedule = (await cached(`schedule/all-${stint.espnTeam}-${season}`, scheduleUrl("all", stint.espnTeam, season), trimSchedule, opts)) ?? [];
  const leagues: Record<string, number> = {};
  const matches: Match[] = [];
  for (const e of schedule) {
    const league = e.league ?? "unknown";
    if (!e.completed || !inWindow(e.date, stint.from, stint.to)) continue;
    if (isExhibition(league)) {
      report.exhibitionSkipped[league] = (report.exhibitionSkipped[league] ?? 0) + 1;
      continue;
    }
    leagues[league] = (leagues[league] ?? 0) + 1;
    matches.push({ ...e, league, teamKey: stint.team, espnTeam: stint.espnTeam });
  }
  return { matches, leagues, schedule };
}

/** Every finished official match of his career that the feed lists, oldest first. */
export async function discover(only: string | undefined, report: SweepReport): Promise<Match[]> {
  const byId = new Map<string, Match>();

  for (const stint of CLUB_STINTS) {
    if (only && only !== stint.team) continue;
    for (const season of stint.seasons) {
      const { matches, leagues } = await clubSeasonMatches(stint, season, report, {
        refresh: season >= new Date().getUTCFullYear() - 1 && stint.to === TODAY,
      });
      let kept = 0;
      for (const m of matches) {
        if (!byId.has(m.id)) {
          byId.set(m.id, m);
          kept++;
        }
      }
      report.coverage.push({ team: stint.team, season, matches: kept, leagues });
      console.log(`discover ${stint.team} ${season}: ${kept} matches ${JSON.stringify(leagues)}`);
    }
  }

  if (!only || only === "portugal") {
    for (const league of INTL_LEAGUES) {
      const perLeague: Record<string, number> = {};
      for (const season of INTL_SEASONS) {
        const events =
          (await cached(`schedule/${league}-${PORTUGAL.espnTeam}-${season}`, scheduleUrl(league, PORTUGAL.espnTeam, season), trimSchedule, {
            refresh: season >= new Date().getUTCFullYear(),
          })) ?? [];
        let kept = 0;
        for (const e of events) {
          if (!e.completed || !inWindow(e.date, PORTUGAL.from, PORTUGAL.to)) continue;
          if (!byId.has(e.id)) {
            byId.set(e.id, { ...e, league, teamKey: "portugal", espnTeam: PORTUGAL.espnTeam });
            kept++;
          }
        }
        if (kept) perLeague[season] = kept;
      }
      report.coverage.push({
        team: "portugal",
        season: league,
        matches: Object.values(perLeague).reduce((a, b) => a + b, 0),
        leagues: perLeague,
      });
      console.log(`discover portugal ${league}: ${JSON.stringify(perLeague)}`);
    }
  }

  for (const x of EXTRA_EVENTS) {
    if ((only && only !== x.team) || byId.has(x.id)) continue;
    const ev = await cached(`event/${x.id}`, eventUrl(x.league, x.id), trimEvent);
    if (!ev) {
      report.missingEvents.push({ eventId: x.id, league: x.league, date: x.why });
      continue;
    }
    byId.set(x.id, {
      id: x.id,
      date: ev.date,
      league: x.league,
      seasonName: null,
      round: null,
      completed: true,
      statusDetail: ev.statusDetail,
      neutral: false,
      venue: { name: ev.venue.name, city: ev.venue.city, country: ev.venue.country },
      competitors: ev.competitors,
      teamKey: x.team,
      espnTeam: x.espnTeam,
    });
    console.log(`discover extra: ${x.why}`);
  }

  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function parseClock(s: string | null): { minute: number; added: number } | null {
  const m = /^(\d+)'(?:\s*\+\s*(\d+)')?$/.exec((s ?? "").trim());
  return m ? { minute: Number(m[1]), added: m[2] ? Number(m[2]) : 0 } : null;
}

/**
 * Walk the scoring plays in order and return the score after each one, with
 * Ronaldo's team first. The feed is ambiguous about which side an own goal is
 * filed under, so both readings are tried and the one that reproduces the final
 * score wins. Returns null if neither does.
 */
export function runningScores(plays: FeedDetail[], teamId: string, final: [number, number]): [number, number][] | null {
  for (const ownGoalFiledUnderScorer of [true, false]) {
    let us = 0;
    let them = 0;
    const out: [number, number][] = [];
    for (const p of plays) {
      const filedUs = p.team === teamId;
      const forUs = p.ownGoal && ownGoalFiledUnderScorer ? !filedUs : filedUs;
      if (forUs) us++;
      else them++;
      out.push([us, them]);
    }
    if (us === final[0] && them === final[1]) return out;
  }
  return null;
}

/**
 * His goals in one match, from the match record. Pure: no network, so it can be
 * tested against saved records. Shoot-out kicks and own goals are never his goals.
 */
export function goalsFromEvent(match: Match, ev: FeedEvent | null, report: SweepReport): GoalFact[] {
  const us = match.competitors.find((c) => c.id === match.espnTeam);
  const them = match.competitors.find((c) => c.id !== match.espnTeam);
  if (!us || !them) return [];
  const name = `${match.competitors.map((c) => c.name).join(" v ")}`;
  const scoreText = `${us.score ?? "?"}-${them.score ?? "?"}`;
  if (!ev) {
    report.missingEvents.push({ eventId: match.id, league: match.league, date: match.date.slice(0, 10) });
    return [];
  }

  const plays = ev.details
    .filter((d) => d.scoring && !d.shootout)
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.clockValue ?? 0) - (b.d.clockValue ?? 0) || a.i - b.i)
    .map((x) => x.d);

  const final: [number, number] = [us.score ?? 0, them.score ?? 0];
  if ((us.score ?? 0) > 0 && plays.length === 0) {
    report.noDetails.push({ eventId: match.id, league: match.league, date: match.date.slice(0, 10), name, score: scoreText });
    return [];
  }
  const running = runningScores(plays, match.espnTeam, final);
  if (!running) {
    report.scoreMismatch.push({
      eventId: match.id,
      league: match.league,
      date: match.date.slice(0, 10),
      name,
      score: scoreText,
      plays: plays.length,
    });
  }

  for (const d of ev.details) {
    for (const a of d.athletes) {
      if (d.scoring && a.id !== RONALDO_ID && /cristiano ronaldo/i.test(a.name)) {
        report.nameWithoutId.push({ eventId: match.id, date: match.date.slice(0, 10), athlete: `${a.name}#${a.id}` });
      }
    }
  }

  const goals: GoalFact[] = [];
  plays.forEach((d, idx) => {
    if (d.ownGoal) return;
    if (!d.athletes.some((a) => a.id === RONALDO_ID)) return;
    const clock = parseClock(d.clock);
    const after = running ? running[idx] : null;
    const before: [number, number] | null = after ? (idx === 0 ? [0, 0] : running![idx - 1]) : null;
    goals.push({
      eventId: match.id,
      league: match.league,
      team: match.teamKey,
      kickoff: ev.date ?? match.date,
      seasonName: match.seasonName,
      round: match.round,
      note: ev.note,
      opponent: { id: them.id, name: them.name },
      designated: us.homeAway,
      venue: {
        id: ev.venue.id,
        name: ev.venue.name ?? match.venue.name,
        city: ev.venue.city ?? match.venue.city,
        country: ev.venue.country ?? match.venue.country,
      },
      clock: d.clock ?? "",
      minute: clock?.minute ?? -1,
      added: clock?.added ?? 0,
      typeRaw: d.type,
      penalty: d.penalty || /penalty/i.test(d.type ?? ""),
      scoreBefore: before,
      scoreAfter: after,
      final,
      shootout: us.shootout !== null && them.shootout !== null ? [us.shootout, them.shootout] : null,
      statusDetail: ev.statusDetail ?? match.statusDetail,
      seq: goals.length + 1,
      assist: null,
      text: null,
    });
  });
  return goals;
}

/** Fetch one match record and read his goals from it. */
export async function extract(match: Match, report: SweepReport, opts: { refresh?: boolean } = {}): Promise<GoalFact[]> {
  const us = match.competitors.find((c) => c.id === match.espnTeam);
  const them = match.competitors.find((c) => c.id !== match.espnTeam);
  if (!us || !them) return [];
  if (us.score === 0) {
    // His team is listed as not scoring, so there is nothing to fetch. A few of these
    // records are simply empty in the feed (a 5–1 win listed as 0–0), which is why the
    // dataset is also checked against published season totals.
    report.listedScoreless++;
    return [];
  }
  const ev: FeedEvent | null = await cached(`event/${match.id}`, eventUrl(match.league, match.id), trimEvent, opts);
  return goalsFromEvent(match, ev, report);
}

/** His goals as the match summary lists them: the feed's second, independent view of a match. */
export const summaryGoals = (summary: FeedSummary): FeedKeyEvent[] =>
  summary.goals.filter((k) => !k.shootout && k.participants[0]?.id === RONALDO_ID && !/own goal/i.test(k.type ?? ""));

/**
 * Add assist and "how it was scored" from the match summary. Pure.
 * Returns whether the summary agrees with the match record on how many he scored.
 */
export function enrichFromSummary(goals: GoalFact[], summary: FeedSummary | null, report: SweepReport): boolean {
  if (goals.length === 0 || !summary) return true;
  const { eventId } = goals[0];
  const his = summaryGoals(summary);
  let agree = true;
  if (his.length !== goals.length) {
    agree = false;
    report.summaryMismatch.push({ eventId, date: goals[0].kickoff.slice(0, 10), feed: goals.length, summary: his.length });
    if (his.length < goals.length) return agree;
  }
  for (const g of goals) {
    const k = his.find((x) => x.clock === g.clock) ?? his[g.seq - 1];
    if (!k) continue;
    const facts = parseGoalText(k.text);
    g.text = facts;
    const second = k.participants[1];
    if (second && second.id && second.id !== RONALDO_ID && facts?.assisted) {
      g.assist = { id: second.id, name: second.name };
    }
  }
  return agree;
}

/** Add assist and "how it was scored" from the match summary, where the feed has commentary. */
export async function enrich(goals: GoalFact[], report: SweepReport, opts: { refresh?: boolean } = {}): Promise<boolean> {
  if (goals.length === 0) return true;
  const { eventId, league } = goals[0];
  const summary = await cached(`summary/${eventId}`, summaryUrl(league, eventId), trimSummary, opts);
  return enrichFromSummary(goals, summary, report);
}
