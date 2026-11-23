// Builds the published dataset from its sources. No network: safe to run anywhere.
//
//   node scripts/build-dataset.ts            write data/goals.json
//   node scripts/build-dataset.ts --report   also print the reconciliation tables
//
// Sources, in order of authority:
//   data/overrides.json            hand corrections (exclusions, neutral grounds, field fixes)
//   data/manual-goals.json         goals the feed does not carry
//   data/source/espn-goals.json    the sweep of the match feed
//   data/venues.json               curated stadiums with coordinates
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Goal, TeamKey, Venue } from "../lib/data/types.ts";
import type { GoalFact } from "./build-history.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = async <T>(rel: string, fallback?: T): Promise<T> => {
  const file = path.join(root, rel);
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${rel}`);
  }
  return JSON.parse(await readFile(file, "utf8")) as T;
};

type ManualGoal = {
  date: string;
  team: TeamKey;
  opponent: string;
  comp: string;
  compKey: string;
  round?: string;
  designated: "home" | "away";
  neutral?: boolean;
  venue: { name: string; city: string; country: string };
  minute: number;
  added?: number;
  penalty: boolean;
  score: [number, number];
  final: [number, number];
  decided?: "aet" | "pens";
  /** Set when official bodies disagree about the goal. See overrides.json, countDisputed. */
  disputed?: string;
  src: string[];
};

type Overrides = {
  /** Whether goals marked as disputed are included in the count. */
  countDisputed: boolean;
  /** Goals in the feed that are not counted, with the reason. */
  exclude: { eventId: string; clock: string; reason: string }[];
  /** Matches played on neutral ground (true) or wrongly flagged as such (false). */
  neutral: Record<string, boolean | string>;
  /** The stadium for matches where the feed names none, keyed by feed event id. */
  venueByEvent?: Record<string, string>;
  /** Field corrections keyed by goal id. */
  patch: Record<string, Partial<Goal> & { reason: string }>;
};

type VenueFile = { venues: (Venue & { feedIds?: string[]; manualNames?: string[] })[] };

const COMPETITIONS: Record<string, { name: string; group: "league" | "cup" | "leagueCup" | "continental" | "other" | "international" }> = {
  "por.1": { name: "Primeira Liga", group: "league" },
  "por.taca": { name: "Taça de Portugal", group: "cup" },
  "eng.1": { name: "Premier League", group: "league" },
  "eng.fa": { name: "FA Cup", group: "cup" },
  "eng.league_cup": { name: "League Cup", group: "leagueCup" },
  "eng.charity": { name: "Community Shield", group: "other" },
  "esp.1": { name: "La Liga", group: "league" },
  "esp.copa_del_rey": { name: "Copa del Rey", group: "cup" },
  "esp.super_cup": { name: "Supercopa de España", group: "other" },
  "ita.1": { name: "Serie A", group: "league" },
  "ita.coppa_italia": { name: "Coppa Italia", group: "cup" },
  "ita.super_cup": { name: "Supercoppa Italiana", group: "other" },
  "ksa.1": { name: "Saudi Pro League", group: "league" },
  "ksa.kings.cup": { name: "King's Cup", group: "cup" },
  "ksa.super_cup": { name: "Saudi Super Cup", group: "other" },
  "uafa.club_champions": { name: "Arab Club Champions Cup", group: "other" },
  "uefa.champions": { name: "UEFA Champions League", group: "continental" },
  "uefa.champions_qual": { name: "UEFA Champions League qualifying", group: "continental" },
  "uefa.europa": { name: "UEFA Europa League", group: "continental" },
  "uefa.super_cup": { name: "UEFA Super Cup", group: "other" },
  "fifa.cwc": { name: "FIFA Club World Cup", group: "other" },
  "afc.champions": { name: "AFC Champions League", group: "continental" },
  "afc.champions_qual": { name: "AFC Champions League qualifying", group: "continental" },
  "afc.cup": { name: "AFC Champions League Two", group: "continental" },
  "afc.cup_qual": { name: "AFC Champions League Two qualifying", group: "continental" },
  "fifa.friendly": { name: "International friendly", group: "international" },
  "uefa.euro": { name: "UEFA European Championship", group: "international" },
  "uefa.euroq": { name: "European Championship qualifying", group: "international" },
  "fifa.world": { name: "FIFA World Cup", group: "international" },
  "fifa.worldq.uefa": { name: "World Cup qualifying", group: "international" },
  "uefa.nations": { name: "UEFA Nations League", group: "international" },
  "fifa.confederations": { name: "FIFA Confederations Cup", group: "international" },
};

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** "2007–08" from the feed's season name, or from the date for one-off competitions. */
function clubSeason(date: string, seasonName: string | null): string {
  const m = /(\d{4})\s*[-/–]\s*(\d{2,4})/.exec(seasonName ?? "");
  let start: number;
  if (m) start = Number(m[1]);
  else {
    const y = Number(date.slice(0, 4));
    const mo = Number(date.slice(5, 7));
    // The 2019–20 season ran into August 2020.
    start = y === 2020 && (mo === 7 || mo === 8) ? 2019 : mo >= 7 ? y : y - 1;
  }
  return `${start}–${String(start + 1).slice(2)}`;
}

function intlSeason(date: string, league: string, seasonName: string | null): string {
  const year = /(\d{4})/.exec(seasonName ?? "")?.[1] ?? date.slice(0, 4);
  switch (league) {
    case "uefa.euro":
      return `UEFA Euro ${year}`;
    case "fifa.world":
      return `${year} FIFA World Cup`;
    case "fifa.confederations":
      return `${year} FIFA Confederations Cup`;
    default:
      return date.slice(0, 4);
  }
}

/** Rounds worth showing. League "rounds" in the feed are just the season name again. */
function tidyRound(round: string | null, league: string): string | undefined {
  if (!round) return undefined;
  if (/\d{4}/.test(round)) return undefined;
  if (COMPETITIONS[league]?.group === "league") return undefined;
  if (/quarter-?finals?/i.test(round)) return "Quarter-final";
  if (/semi-?finals?/i.test(round)) return "Semi-final";
  if (/^finals?$/i.test(round)) return "Final";
  if (/^group stage$/i.test(round)) return "Group stage";
  if (/^league stage$/i.test(round)) return "League stage";
  return round;
}

const NATIONS_ALIASES: Record<string, string[]> = {
  England: ["England", "United Kingdom"],
  Wales: ["Wales", "United Kingdom"],
  Scotland: ["Scotland", "United Kingdom"],
  "Northern Ireland": ["Northern Ireland", "United Kingdom"],
  "North Macedonia": ["North Macedonia", "Macedonia"],
  "South Korea": ["South Korea", "Korea Republic"],
  Netherlands: ["Netherlands"],
  USA: ["USA", "United States"],
  "United States": ["USA", "United States"],
  "Republic of Ireland": ["Ireland", "Republic of Ireland"],
  "Bosnia-Herzegovina": ["Bosnia and Herzegovina", "Bosnia-Herzegovina"],
  "Korea Republic": ["South Korea", "Korea Republic"],
  "North Korea": ["Korea DPR", "North Korea"],
  Türkiye: ["Turkey", "Türkiye"],
  Turkey: ["Turkey", "Türkiye"],
  Czechia: ["Czech Republic", "Czechia"],
  "Czech Republic": ["Czech Republic", "Czechia"],
};

/**
 * Home, away or neutral.
 * Internationals: by the country the match was played in.
 * Clubs: one-off finals and super cups abroad are neutral; the rest follow the fixture.
 * Anything unusual is settled in overrides.json.
 */
function homeAway(g: {
  team: TeamKey;
  league: string;
  designated: "home" | "away";
  opponent: string;
  venueCountry: string | null;
  round: string | null;
  date: string;
  override: boolean | undefined;
}): "H" | "A" | "N" {
  if (g.override === true) return "N";
  const byFixture = g.designated === "home" ? "H" : "A";
  if (g.override === false) return byFixture;
  if (g.team === "portugal") {
    if (!g.venueCountry) return byFixture;
    if (g.venueCountry === "Portugal") return "H";
    const opp = NATIONS_ALIASES[g.opponent] ?? [g.opponent];
    return opp.includes(g.venueCountry) ? "A" : "N";
  }
  const final = /^final$/i.test(g.round ?? "");
  if (["uefa.super_cup", "fifa.cwc", "ita.super_cup", "eng.charity", "ksa.super_cup"].includes(g.league)) return "N";
  if (g.league === "esp.super_cup") return g.date >= "2019-07-01" ? "N" : byFixture; // two legs until 2018
  if (final && ["uefa.champions", "esp.copa_del_rey", "eng.fa", "eng.league_cup", "ita.coppa_italia", "ksa.kings.cup"].includes(g.league)) return "N";
  if (g.league === "eng.fa" && /semi/i.test(g.round ?? "")) return "N";
  return byFixture;
}

// ---------- load ----------
const facts = await read<GoalFact[]>("data/source/espn-goals.json");
const manual = (await read<{ goals: ManualGoal[] }>("data/manual-goals.json")).goals;
const overrides = await read<Overrides>("data/overrides.json", { countDisputed: true, exclude: [], neutral: {}, patch: {} });
const venueFile = await read<VenueFile>("data/venues.json", { venues: [] });

const venueCountry = new Map(venueFile.venues.map((v) => [v.id, v.country]));
const venueByFeedId = new Map<string, string>();
const venueByManualName = new Map<string, string>();
for (const v of venueFile.venues) {
  for (const id of v.feedIds ?? []) venueByFeedId.set(id, v.id);
  for (const name of v.manualNames ?? []) venueByManualName.set(name, v.id);
}
const missingVenues = new Map<string, { name: string; city: string | null; country: string | null; goals: number }>();
const needVenue = (key: string, name: string, city: string | null, country: string | null) => {
  const m = missingVenues.get(key) ?? { name, city, country, goals: 0 };
  m.goals++;
  missingVenues.set(key, m);
  return key;
};

// ---------- assemble ----------
type Draft = Omit<Goal, "n" | "id"> & { sortKey: string; matchKey: string };
const drafts: Draft[] = [];
const excluded: { date: string; opponent: string; clock: string; reason: string }[] = [];
const neutralReview: string[] = [];

for (const f of facts) {
  const ex = overrides.exclude.find((e) => e.eventId === f.eventId && e.clock === f.clock);
  if (ex) {
    excluded.push({ date: f.kickoff.slice(0, 10), opponent: f.opponent.name, clock: f.clock, reason: ex.reason });
    continue;
  }
  const date = f.kickoff.slice(0, 10);
  const comp = COMPETITIONS[f.league];
  if (!comp) throw new Error(`No competition entry for ${f.league}`);
  const intl = f.team === "portugal";
  const feedVenueKey = f.venue.id ?? `name:${f.venue.name}`;
  const venue =
    overrides.venueByEvent?.[f.eventId] ??
    venueByFeedId.get(feedVenueKey) ??
    needVenue(`feed:${feedVenueKey}`, f.venue.name ?? "?", f.venue.city, f.venue.country);
  const ruling = overrides.neutral[f.eventId];
  const neutralRuling = typeof ruling === "boolean" ? ruling : undefined;
  const ha = homeAway({
    team: f.team,
    league: f.league,
    designated: f.designated,
    opponent: f.opponent.name,
    // The curated stadium record is more reliable than the feed's own country field.
    venueCountry: venueCountry.get(venue) ?? f.venue.country,
    round: f.round,
    date,
    override: neutralRuling,
  });
  if (!intl && (ha === "N" || /final/i.test(f.round ?? "")) && neutralRuling === undefined) {
    neutralReview.push(`${date} ${f.league} ${f.round ?? ""} v ${f.opponent.name} @ ${f.venue.name}, ${f.venue.city ?? "?"} (${f.designated}) -> ${ha}  [${f.eventId}]`);
  }
  const t = f.text;
  const direct = /free-?kick/i.test(f.typeRaw ?? "") || t?.situation === "direct free kick";
  const zone = t?.zone && t.zone !== "penalty spot" ? t.zone : undefined;
  const situation = t?.situation === "corner" || t?.situation === "set piece" || t?.situation === "fast break" ? t.situation : undefined;
  const header = /header/i.test(f.typeRaw ?? "");
  drafts.push({
    sortKey: `${f.kickoff}|${String(f.minute).padStart(3, "0")}|${String(f.added).padStart(2, "0")}|${f.seq}`,
    matchKey: `${date}|${f.team}|${slug(f.opponent.name)}`,
    date,
    team: f.team,
    opponent: f.opponent.name,
    comp: comp.name,
    compKey: f.league,
    season: intl ? intlSeason(date, f.league, f.seasonName) : clubSeason(date, f.seasonName),
    round: tidyRound(f.round, f.league),
    ha,
    venue,
    minute: f.minute,
    ...(f.added ? { added: f.added } : {}),
    ...(f.scoreAfter ? { score: f.scoreAfter } : {}),
    final: f.final,
    // A goal timed past 90 with no stoppage time can only have come in extra time.
    ...(/pen/i.test(f.statusDetail ?? "")
      ? { decided: "pens" as const }
      : /aet/i.test(f.statusDetail ?? "") || (f.minute > 90 && !f.added)
        ? { decided: "aet" as const }
        : {}),
    penalty: f.penalty,
    ...(direct ? { freeKick: true as const } : {}),
    ...(t?.body ? { body: t.body } : header ? { body: "head" as const } : {}),
    ...(zone ? { zone } : {}),
    ...(t?.placement && t.placement.side ? { placement: { ...(t.placement.height && t.placement.height !== "low" ? { height: t.placement.height } : {}), side: t.placement.side } } : {}),
    ...(situation ? { situation } : {}),
    ...(f.assist ? { assist: f.assist.name } : {}),
    ...(f.assist && t?.assistType ? { assistType: t.assistType } : {}),
    src: [`espn:${f.eventId}`],
  });
}

const disputedLeftOut: string[] = [];
for (const m of manual) {
  if (m.disputed && !overrides.countDisputed) {
    disputedLeftOut.push(`${m.date} v ${m.opponent}, ${m.minute}'`);
    continue;
  }
  const venue = venueByManualName.get(m.venue.name) ?? needVenue(`manual:${m.venue.name}`, m.venue.name, m.venue.city, m.venue.country);
  drafts.push({
    sortKey: `${m.date}T23:00Z|${String(m.minute).padStart(3, "0")}|${String(m.added ?? 0).padStart(2, "0")}|0`,
    matchKey: `${m.date}|${m.team}|${slug(m.opponent)}`,
    date: m.date,
    team: m.team,
    opponent: m.opponent,
    comp: m.comp,
    compKey: m.compKey,
    season: m.team === "portugal" ? intlSeason(m.date, m.compKey, null) : clubSeason(m.date, null),
    round: m.round,
    ha: m.neutral ? "N" : m.designated === "home" ? "H" : "A",
    venue,
    minute: m.minute,
    ...(m.added ? { added: m.added } : {}),
    score: m.score,
    final: m.final,
    ...(m.decided ? { decided: m.decided } : {}),
    penalty: m.penalty,
    ...(m.disputed ? { disputed: m.disputed } : {}),
    src: m.src,
  });
}

drafts.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

const perMatch = new Map<string, number>();
const goals: Goal[] = drafts.map((d, i) => {
  const seq = (perMatch.get(d.matchKey) ?? 0) + 1;
  perMatch.set(d.matchKey, seq);
  const { sortKey: _s, matchKey, ...rest } = d;
  const id = `${matchKey.replace(/\|/g, "-")}-${seq}`;
  const patch = overrides.patch[id];
  const { reason: _r, ...fields } = patch ?? { reason: "" };
  return { n: i + 1, id, ...rest, ...fields };
});

// ---------- reconcile against the reference ----------
type Ref = {
  club: { team: TeamKey; season: string; league: number; cup: number; leagueCup: number; continental: number; other: number; total: number }[];
  clubTotals: Record<string, number>;
  portugalByYear: Record<string, number>;
  portugalTotal: number;
  careerTotal: number;
};
const ref = await read<Ref>("data/reference/season-totals.json");
const diffs: string[] = [];
const groups = ["league", "cup", "leagueCup", "continental", "other"] as const;
for (const row of ref.club) {
  const mine = goals.filter((g) => g.team === row.team && g.season === row.season);
  for (const grp of groups) {
    const n = mine.filter((g) => (COMPETITIONS[g.compKey]?.group ?? "other") === grp).length;
    if (n !== row[grp]) diffs.push(`${row.team} ${row.season} ${grp}: dataset ${n}, reference ${row[grp]}`);
  }
}
const refSeasons = new Set(ref.club.map((r) => `${r.team}|${r.season}`));
for (const g of goals) {
  if (g.team !== "portugal" && !refSeasons.has(`${g.team}|${g.season}`)) diffs.push(`goal ${g.n} (${g.date} ${g.team}) falls in a season the reference does not list: ${g.season}`);
}
for (const [year, n] of Object.entries(ref.portugalByYear)) {
  const mine = goals.filter((g) => g.team === "portugal" && g.date.startsWith(year)).length;
  if (mine !== n) diffs.push(`portugal ${year}: dataset ${mine}, reference ${n}`);
}

// A counted disputed goal is, by definition, one the reference does not have.
const disputedCounted = goals.filter((g) => g.disputed);
const expectedTotal = ref.careerTotal + disputedCounted.length;
const explained: string[] = [];
for (const g of disputedCounted) {
  const grp = COMPETITIONS[g.compKey]?.group ?? "other";
  const i = diffs.findIndex((d) => d.startsWith(`${g.team} ${g.season} ${grp}:`));
  if (i >= 0) explained.push(`${diffs.splice(i, 1)[0]} (disputed goal ${g.n}, counted by rule)`);
}

const byTeam: Record<string, number> = {};
for (const g of goals) byTeam[g.team] = (byTeam[g.team] ?? 0) + 1;

await writeFile(
  path.join(root, "data/goals.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), asOf: goals[goals.length - 1]?.date ?? null, total: goals.length, goals }, null, 1) + "\n",
);
await writeFile(
  path.join(root, "data/source/reconcile-report.json"),
  JSON.stringify(
    {
      total: goals.length,
      byTeam,
      referenceTotal: ref.careerTotal,
      expectedTotal,
      countDisputed: overrides.countDisputed,
      disputedLeftOut,
      explainedDifferences: explained,
      differences: diffs,
      excluded,
      missingVenues: [...missingVenues.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.goals - a.goals),
      neutralReview,
    },
    null,
    1,
  ) + "\n",
);

console.log(`${goals.length} goals written to data/goals.json (reference ${ref.careerTotal}, plus ${disputedCounted.length} disputed counted = ${expectedTotal}).`);
for (const e of explained) console.log("  explained: " + e);
console.log("By team:", byTeam);
console.log(`Differences from the reference: ${diffs.length}`);
for (const d of diffs) console.log("  " + d);
if (excluded.length) console.log(`Excluded by override: ${excluded.length}`);
console.log(`Venues still to curate: ${missingVenues.size}`);
if (process.argv.includes("--report")) {
  console.log("\nNeutral-ground review:");
  for (const l of neutralReview) console.log("  " + l);
}
