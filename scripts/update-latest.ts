// Brings the dataset up to date after a match.
//
//   node scripts/update-latest.ts --check      is there anything new to read? (one request, no dependencies)
//   node scripts/update-latest.ts              read this season's new results and update the data files
//   node scripts/update-latest.ts --dry-run    work everything out and print it, but write nothing
//   node scripts/update-latest.ts --full       re-read every match of the season, not only the recent ones
//
// Safety, in order:
//   - only finished matches are read, so a goal later ruled out during play is never counted;
//   - a new goal is accepted only when the feed's two accounts of the match agree;
//   - the result must pass every check in scripts/lib/checks.ts;
//   - a count that would fall is never written without --allow-decrease;
//   - more than --max-new goals (default 6) in one run is refused.
// If any of these stops the update, nothing is written and the exit code is 1.
//
// The rules themselves are in scripts/lib/update.ts.
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalsFileText, reportFileText } from "./lib/dataset.ts";
import {
  cached,
  eventUrl,
  rosterUrl,
  RONALDO_ID,
  scheduleUrl,
  stats,
  summaryUrl,
  trimEvent,
  trimFixtures,
  trimSeasonTotal,
  trimSummary,
  type FeedSeasonTotal,
} from "./lib/espn.ts";
import { FILES, loadCountries, loadSources, readJson, root, type GoalsFile, type VenueFile } from "./lib/files.ts";
import { locate } from "./lib/geocode.ts";
import { CURRENT_STINT, clubSeasonMatches, newReport } from "./lib/sweep.ts";
import { confirmWithSummary, planUpdate, readRecord, seasonOf, type Reading, type SeasonState } from "./lib/update.ts";

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const now = new Date();
const season = seasonOf(now);
const team = CURRENT_STINT;
const FRESH = { maxAgeMs: 10 * 60_000 };
/** Matches this recent are re-read on every run, to pick up late corrections. */
const RECENT_HOURS = 96;
/** A match on hold is retried on every run for this long, then left to the daily full run. */
const RETRY_HOURS = 72;

/** Hand results to the workflow that called us, when there is one. */
function output(values: Record<string, string>) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [k, v] of Object.entries(values)) appendFileSync(file, v.includes("\n") ? `${k}<<__END__\n${v}\n__END__\n` : `${k}=${v}\n`);
}
const summary = (markdown: string) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");

const state = await readJson<SeasonState | null>(FILES.season, null);
const report = newReport();

// ---------- is there anything to do? ----------
if (flag("check")) {
  const { matches } = await clubSeasonMatches(team, season, report, { refresh: true });
  const known = new Map((state?.season === season ? state.matches : []).map((m) => [m.id, m]));
  const fresh = matches.filter((m) => !known.has(m.id));
  const retry = [...known.values()].filter((m) => m.pending && m.pendingSince && now.getTime() - Date.parse(m.pendingSince) < RETRY_HOURS * 3_600_000);
  const reasons = [
    ...(state?.season === season ? [] : ["no record of this season yet"]),
    ...fresh.map((m) => `new result: ${m.competitors.map((c) => `${c.name} ${c.score ?? "?"}`).join(", ")} (${m.date.slice(0, 10)})`),
    ...retry.map((m) => `still on hold: ${m.date} v ${m.opponent}`),
  ];
  const work = reasons.length > 0;
  console.log(work ? `Something to read:\n  ${reasons.join("\n  ")}` : `Nothing new: ${matches.length} finished matches this season, all read.`);
  output({ work: String(work) });
  process.exit(0);
}

// ---------- read the season ----------
const sources = await loadSources();
const published = await readJson<GoalsFile>(FILES.goals);
const venueFile = await readJson<VenueFile>(FILES.venues);
const { matches } = await clubSeasonMatches(team, season, report, FRESH);
const known = new Map((state?.season === season ? state.matches : []).map((m) => [m.id, m]));

const readings: { match: (typeof matches)[number]; reading: Reading | null }[] = [];
for (const match of matches) {
  const before = known.get(match.id);
  const recent = now.getTime() - Date.parse(match.date) < RECENT_HOURS * 3_600_000;
  if (!(flag("full") || !before || before.pending || recent)) {
    readings.push({ match, reading: null });
    continue;
  }
  const us = match.competitors.find((c) => c.id === match.espnTeam);
  let reading: Reading;
  if (us?.score === 0) reading = readRecord(match, null);
  else {
    const event = await cached(`event/${match.id}`, eventUrl(match.league, match.id), trimEvent, { refresh: true });
    reading = readRecord(match, event);
    if (reading.status === "ok" && reading.goals.length) {
      const matchSummary = await cached(`summary/${match.id}`, summaryUrl(match.league, match.id), trimSummary, { refresh: true });
      reading = confirmWithSummary(reading.goals, matchSummary, now);
    }
  }
  readings.push({ match, reading });
}

// The feed's own season totals for him, one request per competition he has played in.
const seasonTotals: Record<string, FeedSeasonTotal | null> = {};
for (const league of [...new Set(matches.map((m) => m.league))]) {
  seasonTotals[league] = await cached(`roster/${league}-${team.espnTeam}`, rosterUrl(league, team.espnTeam), trimSeasonTotal(RONALDO_ID), FRESH).catch(() => null);
}
const fixtures = await cached(`fixtures/all-${team.espnTeam}-${season}`, scheduleUrl("all", team.espnTeam, season, true), trimFixtures, FRESH).catch(() => null);

const plan = await planUpdate({
  now,
  ...sources,
  published,
  season,
  team: { key: team.team, espnId: team.espnTeam },
  matches: readings,
  previousState: state,
  fixtures,
  seasonTotals,
  countries: await loadCountries(),
  locate: async (q) => (await locate(q)).result,
  allowDecrease: flag("allow-decrease"),
  maxNew: Number(option("max-new") ?? 6),
});

// ---------- report ----------
const reread = readings.filter((r) => r.reading).length;
console.log(`Season ${season}: ${matches.length} finished matches, ${reread} read this run (${stats.network} requests).`);
console.log(`Count: ${published.total} -> ${plan.built.total}`);
for (const g of plan.added) console.log(`  + No. ${g.n}: ${g.date} v ${g.opponent}, ${g.minute}'${g.added ? `+${g.added}` : ""}${g.penalty ? " (pen)" : ""} at ${g.venue}`);
for (const g of plan.removed) console.log(`  - No. ${g.n}: ${g.date} v ${g.opponent}, ${g.minute}'`);
for (const n of plan.notes) console.log(`  note: ${n}`);
for (const a of plan.alerts) console.log(`  ALERT: ${a}`);
for (const b of plan.blocked) console.error(`  BLOCKED: ${b}`);

const anyChange = Object.values(plan.changed).some(Boolean);
const alertText = [...plan.blocked.map((b) => `**Stopped.** ${b}`), ...plan.alerts].map((l) => `- ${l}`).join("\n");
output({ changed: String(anyChange && plan.blocked.length === 0 && !flag("dry-run")), title: plan.title, total: String(plan.built.total), alert: alertText });
summary(
  [
    `### ${plan.blocked.length ? "Update stopped" : anyChange ? plan.title : "Nothing to change"}`,
    `Count: **${published.total} → ${plan.built.total}**. ${matches.length} finished matches this season, ${reread} read this run.`,
    ...plan.added.map((g) => `- New: No. ${g.n}, ${g.date} v ${g.opponent}, ${g.minute}'${g.added ? `+${g.added}` : ""}`),
    alertText,
    ...plan.notes.map((n) => `- ${n}`),
  ]
    .filter(Boolean)
    .join("\n"),
);

if (plan.blocked.length) {
  console.error("\nNothing was written.");
  process.exit(1);
}
if (flag("dry-run")) {
  console.log(`\nDry run: nothing written. Would be recorded as: ${plan.title}`);
  process.exit(0);
}
if (!anyChange) {
  console.log("\nNothing to change.");
  process.exit(0);
}

// ---------- write ----------
const write = (rel: string, text: string) => writeFile(path.join(root, rel), text);
await mkdir(path.join(root, "data/source"), { recursive: true });
if (plan.changed.facts) await write(FILES.facts, JSON.stringify(plan.facts, null, 1) + "\n");
if (plan.changed.venues) await write(FILES.venues, JSON.stringify({ ...venueFile, venues: plan.venues }, null, 1) + "\n");
await write(FILES.goals, goalsFileText(plan.built));
await write(FILES.report, reportFileText(plan.built));
await write(FILES.season, JSON.stringify(plan.state, null, 1) + "\n");
console.log(`\nWritten. ${plan.title}`);
