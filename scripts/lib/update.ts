// The post-match update, as a plan: given what the feed says about this season's
// finished matches, work out what the dataset should become, and whether it is safe
// to publish. Nothing here touches the network or the disk, so every rule can be
// tested against saved match records. scripts/update-latest.ts does the fetching
// and the writing.
import type { Goal } from "../../lib/data/types.ts";
import { inCountry, validateDataset, type CountryOutline } from "./checks.ts";
import { buildDataset, clubSeason, feedVenueKey, slug, type Built, type ManualGoal, type Overrides, type Reference, type VenueRecord } from "./dataset.ts";
import type { FeedEvent, FeedFixture, FeedSeasonTotal, FeedSummary } from "./espn.ts";
import type { Located, VenueQuery } from "./geocode.ts";
import { byMoment, enrichFromSummary, goalsFromEvent, newReport, type GoalFact, type Match } from "./sweep.ts";

/** The season a date falls in, by the year it starts: August 2026 to May 2027 is 2026. */
export const seasonOf = (d: Date) => (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

export type Reading = { status: "ok"; goals: GoalFact[] } | { status: "hold"; reason: string };

const hold = (reason: string): Reading => ({ status: "hold", reason });

/**
 * What one finished match's record says he scored, or why it cannot be trusted yet.
 * Shoot-out kicks and own goals are never his goals.
 */
export function readRecord(match: Match, event: FeedEvent | null): Reading {
  const us = match.competitors.find((c) => c.id === match.espnTeam);
  if (!us) return hold("his team is not listed in the match");
  if (us.score === 0) return { status: "ok", goals: [] };
  const report = newReport();
  const goals = goalsFromEvent(match, event, report);
  if (report.missingEvents.length) return hold("the match record is not available yet");
  if (report.noDetails.length) return hold("the match record lists no scorers yet");
  if (report.scoreMismatch.length) return hold("the scorers listed do not add up to the final score");
  if (report.nameWithoutId.length) return hold("a goal is listed under his name but not under his player number");
  return { status: "ok", goals };
}

/** How long to wait for the match summary before accepting the match record on its own. */
const SUMMARY_GRACE_HOURS = 6;

/**
 * The feed describes each match twice: the match record and the summary. A new goal
 * is accepted only when both agree on how many he scored. Fills in assist and
 * how-it-was-scored from the summary as it goes.
 */
export function confirmWithSummary(goals: GoalFact[], summary: FeedSummary | null, now: Date): Reading {
  if (goals.length === 0) return { status: "ok", goals };
  if (!summary) {
    const hours = (now.getTime() - Date.parse(goals[0].kickoff)) / 3_600_000;
    return hours < SUMMARY_GRACE_HOURS ? hold("the match summary is not available yet") : { status: "ok", goals };
  }
  const report = newReport();
  const agree = enrichFromSummary(goals, summary, report);
  if (!agree) {
    const m = report.summaryMismatch[0];
    return hold(`the feed's two accounts of the match disagree: the match record gives him ${m.feed}, the summary ${m.summary}`);
  }
  return { status: "ok", goals };
}

export type SeasonMatch = {
  id: string;
  date: string;
  league: string;
  opponent: string;
  ha: "H" | "A";
  /** Final score, his team first. */
  score: [number, number];
  /** How many goals the feed credits him with in this match. */
  goals: number;
  /** Why this match's goals are on hold, when they are. */
  pending?: string;
  pendingSince?: string;
};

export type SeasonState = {
  note: string;
  team: string;
  season: number;
  /** Every finished official match of the season that has been read. */
  matches: SeasonMatch[];
  /** The next fixtures, soonest first. */
  next: { id: string; kickoff: string; league: string | null; opponent: string; ha: "H" | "A"; venue: string | null }[];
};

const STATE_NOTE = "Written by scripts/update-latest.ts: the matches of the current season it has read. Not edited by hand.";

export type UpdateInput = {
  now: Date;
  facts: GoalFact[];
  manual: ManualGoal[];
  overrides: Overrides;
  venues: VenueRecord[];
  ref: Reference;
  /** The dataset as it is published now. */
  published: { total: number; goals: Goal[] };
  season: number;
  team: { key: string; espnId: string };
  /** Every finished official match of the season; `reading` is null where it was not re-read this run. */
  matches: { match: Match; reading: Reading | null }[];
  previousState: SeasonState | null;
  fixtures: FeedFixture[] | null;
  /** The feed's own season totals for him, by competition. */
  seasonTotals: Record<string, FeedSeasonTotal | null>;
  countries: CountryOutline[];
  locate: (q: VenueQuery) => Promise<Located | null>;
  allowDecrease: boolean;
  maxNew: number;
};

export type UpdatePlan = {
  /** Reasons nothing may be published. Empty means safe. */
  blocked: string[];
  /** Things a person should look at. They do not stop publication. */
  alerts: string[];
  notes: string[];
  facts: GoalFact[];
  venues: VenueRecord[];
  built: Built;
  state: SeasonState;
  added: Goal[];
  removed: Goal[];
  venuesAdded: VenueRecord[];
  title: string;
  changed: { facts: boolean; venues: boolean; goals: boolean; state: boolean };
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const minuteText = (g: { minute: number; added?: number }) => `${g.minute}'${g.added ? `+${g.added}` : ""}`;

/**
 * Find or create the curated stadium for a ground the dataset has not seen under this
 * name. Order: a curated stadium of the same name; then Wikidata; then the city, marked
 * approximate. Returns null when even the city cannot be placed. A new stadium is added
 * to `venues`; linking it to the feed id or hand-entered name is left to the caller.
 */
export async function resolveVenue(
  q: VenueQuery,
  venues: VenueRecord[],
  countries: CountryOutline[],
  locate: (q: VenueQuery) => Promise<Located | null>,
): Promise<{ venue: VenueRecord; created: boolean; how: string } | null> {
  if (!q.name) return null;
  const wanted = norm(q.name);
  const sameName = venues.filter(
    (v) => [v.name, ...(v.periodNames ?? []).map((p) => p.name), ...(v.manualNames ?? []), ...(v.feedNames ?? [])].some((n) => norm(n) === wanted) && (!q.country || v.country === q.country),
  );
  if (sameName.length === 1) return { venue: sameName[0], created: false, how: "matched by name to a stadium already on file" };
  if (!q.country) return null;
  const found = await locate(q);
  if (!found) return null;
  if (inCountry(countries, found.lng, found.lat, q.country) === false) return null;
  let id = slug(q.name);
  if (!id || venues.some((v) => v.id === id)) id = `${id || "stadium"}-${slug(q.city ?? q.country)}`;
  if (venues.some((v) => v.id === id)) return null;
  const round = (x: number) => Math.round(x * 1e5) / 1e5;
  const venue: VenueRecord = {
    id,
    name: q.name,
    city: found.kind === "city" ? found.label : (q.city ?? q.country),
    country: q.country,
    lat: round(found.lat),
    lng: round(found.lng),
    ...(found.kind === "stadium" ? { wikidata: found.wikidata } : { approx: true }),
    reviewed: false,
  };
  venues.push(venue);
  return {
    venue,
    created: true,
    how: found.kind === "stadium" ? `position from Wikidata item ${found.wikidata} ("${found.label}")` : `only the city could be placed (${found.label}), so the position is approximate`,
  };
}

export async function planUpdate(input: UpdateInput): Promise<UpdatePlan> {
  const { now, overrides, manual, ref, published, season, team } = input;
  const blocked: string[] = [];
  const alerts: string[] = [];
  const notes: string[] = [];
  const venues: VenueRecord[] = structuredClone(input.venues);
  const venuesAdded: VenueRecord[] = [];
  const venuesBefore = JSON.stringify(input.venues);

  const knownVenue = (f: GoalFact) => Boolean(overrides.venueByEvent?.[f.eventId]) || venues.some((v) => (v.feedIds ?? []).includes(feedVenueKey(f.venue)));

  // ---------- settle each match: take the new reading, or keep what was there ----------
  const previous = new Map((input.previousState?.season === season ? input.previousState.matches : []).map((m) => [m.id, m]));
  const replaced = new Map<string, GoalFact[]>();
  const stateMatches: SeasonMatch[] = [];
  const label = (m: Match) => {
    const them = m.competitors.find((c) => c.id !== m.espnTeam);
    return `${m.date.slice(0, 10)} v ${them?.name ?? "?"}`;
  };

  for (const { match, reading } of [...input.matches].sort((a, b) => a.match.date.localeCompare(b.match.date))) {
    const us = match.competitors.find((c) => c.id === match.espnTeam);
    const them = match.competitors.find((c) => c.id !== match.espnTeam);
    if (!us || !them) continue;
    const before = previous.get(match.id);
    let settled = reading;

    // A goal at a ground the dataset has not seen: place the stadium first.
    if (settled?.status === "ok" && settled.goals.length && !knownVenue(settled.goals[0])) {
      const feedVenue = settled.goals[0].venue;
      const resolved = feedVenue.name ? await resolveVenue({ name: feedVenue.name, city: feedVenue.city, country: feedVenue.country }, venues, input.countries, input.locate) : null;
      if (resolved) resolved.venue.feedIds = [...(resolved.venue.feedIds ?? []), feedVenueKey(feedVenue)];
      if (!resolved) settled = hold(`the stadium could not be placed on the map ("${feedVenue.name ?? "unnamed"}", ${feedVenue.city ?? "city unknown"})`);
      else if (resolved.created) {
        venuesAdded.push(resolved.venue);
        alerts.push(`A stadium was added automatically: ${resolved.venue.name}, ${resolved.venue.city} (${resolved.venue.country}); ${resolved.how}. Please check its position (${resolved.venue.lat}, ${resolved.venue.lng}).`);
      } else notes.push(`${feedVenue.name}: ${resolved.how}.`);
    }

    const entry: SeasonMatch = {
      id: match.id,
      date: match.date.slice(0, 10),
      league: match.league,
      opponent: them.name,
      ha: us.homeAway === "home" ? "H" : "A",
      score: [us.score ?? 0, them.score ?? 0],
      goals: 0,
    };
    if (settled === null) {
      // Not re-read this run: whatever is on file stands.
      if (before?.pending) Object.assign(entry, { pending: before.pending, pendingSince: before.pendingSince });
    } else if (settled.status === "hold") {
      entry.pending = settled.reason;
      entry.pendingSince = before?.pending ? before.pendingSince : now.toISOString().slice(0, 16) + "Z";
      alerts.push(`${label(match)} (${entry.score.join("–")}): ${settled.reason}. Any goal of his in this match is on hold until that is settled, or until it is entered by hand.`);
    } else {
      replaced.set(match.id, settled.goals);
    }
    stateMatches.push(entry);
  }

  const facts = [...input.facts.filter((f) => !replaced.has(f.eventId)), ...[...replaced.values()].flat()].sort(byMoment);
  for (const m of stateMatches) m.goals = facts.filter((f) => f.eventId === m.id).length;

  // ---------- build and check ----------
  const built = buildDataset({ facts, manual, overrides, venues, ref });
  for (const v of built.report.missingVenues) blocked.push(`No stadium on file for "${v.name}" (${v.goals} goal${v.goals === 1 ? "" : "s"}).`);
  const checks = validateDataset({ goals: built.goals, total: built.total, venues, countDisputed: overrides.countDisputed, ref, countries: input.countries });
  for (const e of checks.errors) blocked.push(`Check failed: ${e}`);
  for (const s of built.report.superseded) notes.push(`A hand entry stepped aside: ${s}.`);

  // ---------- what changed ----------
  const beforeIds = new Set(published.goals.map((g) => g.id));
  const afterIds = new Set(built.goals.map((g) => g.id));
  const added = built.goals.filter((g) => !beforeIds.has(g.id));
  const removed = published.goals.filter((g) => !afterIds.has(g.id));
  const delta = built.total - published.total;

  if (delta < 0 && !input.allowDecrease) {
    blocked.push(
      `The count would fall from ${published.total} to ${built.total}. Goals that would go: ${removed.map((g) => `No. ${g.n} (${g.date} v ${g.opponent}, ${minuteText(g)})`).join("; ")}. A falling count is never published automatically: confirm it by running the update by hand with "allow a lower count" switched on, or correct the data.`,
    );
  }
  if (delta > input.maxNew) blocked.push(`${delta} new goals in one update is more than the limit of ${input.maxNew}. Run the update by hand with a higher limit if this is right.`);

  // ---------- the feed's own season totals ----------
  const seasonLabel = clubSeason(`${season}-08-01`, null);
  const inSeason = facts.filter((f) => f.team === team.key && clubSeason(f.kickoff.slice(0, 10), f.seasonName) === seasonLabel);
  for (const [league, total] of Object.entries(input.seasonTotals)) {
    if (!total || total.goals === null) continue;
    if (stateMatches.some((m) => m.league === league && m.pending)) continue;
    const mine = inSeason.filter((f) => f.league === league);
    if (mine.length === total.goals) notes.push(`${league}: the feed's own season total for him agrees with its match records (${total.goals}).`);
    else if (mine.length < total.goals) {
      alerts.push(`${league}: the feed's own season total for him is ${total.goals}, but its match records add up to ${mine.length}. A goal may be missing from a match record: check the latest matches, and enter it by hand if so.`);
    } else {
      const latest = mine.map((f) => Date.parse(f.kickoff)).sort((a, b) => b - a)[0];
      const hours = (now.getTime() - latest) / 3_600_000;
      if (hours > 36) alerts.push(`${league}: the feed's match records give him ${mine.length} goals this season, but its own season total still says ${total.goals}, ${Math.round(hours)} hours after his latest goal there. One of the two is wrong.`);
      else notes.push(`${league}: the feed's season total (${total.goals}) has not caught up with its match records (${mine.length}) yet.`);
    }
  }

  // ---------- the season file ----------
  const opponentOf = (f: FeedFixture) => f.competitors.find((c) => c.id !== team.espnId);
  const next = (input.fixtures ?? (input.previousState?.season === season ? null : []))
    ?.filter((f) => f.state === "pre" && Date.parse(f.kickoff) > now.getTime() - 3 * 3_600_000)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .slice(0, 3)
    .map((f) => ({
      id: f.id,
      kickoff: f.kickoff,
      league: f.league,
      opponent: opponentOf(f)?.name ?? "?",
      ha: (f.competitors.find((c) => c.id === team.espnId)?.homeAway === "home" ? "H" : "A") as "H" | "A",
      venue: f.venue,
    }));
  const state: SeasonState = { note: STATE_NOTE, team: team.key, season, matches: stateMatches, next: next ?? input.previousState?.next ?? [] };

  // ---------- a title for the change ----------
  const newMatches = stateMatches.filter((m) => !previous.has(m.id));
  let title: string;
  if (delta > 0) {
    const tail = built.goals.slice(-delta);
    const allNewAtEnd = tail.every((g) => !beforeIds.has(g.id)) && added.length === delta;
    const oneMatch = new Set(tail.map((g) => `${g.date}|${g.opponent}`)).size === 1;
    if (allNewAtEnd && oneMatch) {
      const first = tail[0];
      const numbers = delta === 1 ? `Goal ${first.n}` : `Goals ${first.n}–${tail[tail.length - 1].n}`;
      title = `${numbers}: v ${first.opponent}, ${longDate(first.date)} (${tail.map(minuteText).join(", ")})`;
    } else title = `Add ${delta} goal${delta === 1 ? "" : "s"}: the count is now ${built.total}`;
  } else if (delta < 0) title = `Remove ${-delta} goal${delta === -1 ? "" : "s"} after a correction: the count is now ${built.total}`;
  else if (newMatches.length === 1) title = `v ${newMatches[0].opponent}, ${longDate(newMatches[0].date)}: no goal, still ${built.total}`;
  else if (newMatches.length > 1) title = `${newMatches.length} matches read: no goal, still ${built.total}`;
  else title = `Refresh the goal records: still ${built.total}`;

  return {
    blocked,
    alerts,
    notes,
    facts,
    venues,
    built,
    state,
    added,
    removed,
    venuesAdded,
    title,
    changed: {
      facts: JSON.stringify(facts) !== JSON.stringify(input.facts),
      venues: JSON.stringify(venues) !== venuesBefore,
      goals: JSON.stringify(built.goals) !== JSON.stringify(published.goals),
      state: JSON.stringify(state) !== JSON.stringify(input.previousState),
    },
  };
}
