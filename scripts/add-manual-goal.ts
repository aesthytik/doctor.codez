// Adds one goal by hand: for a competition the match feed does not carry (the Saudi
// Super Cup), or on a night when the feed is slow.
//
//   node scripts/add-manual-goal.ts --date=2026-12-21 --opponent="Al Hilal" \
//     --competition="Saudi Super Cup" --ground=neutral \
//     --stadium="Jaber Al-Ahmad International Stadium, Kuwait City, Kuwait" \
//     --minute=67 --penalty=false --score=2-1 --final=3-1 --source=https://example.org/report
//
// Scores are written his team first. Add --dry-run to see the result without writing.
// A goal entered for a competition the feed does cover is marked provisional: it steps
// aside as soon as the feed reports the same match, so nothing is counted twice.
//
// The goal is written only if the whole dataset still passes every check.
import { appendFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDataset } from "./lib/checks.ts";
import { buildDataset, goalsFileText, reportFileText } from "./lib/dataset.ts";
import { FILES, loadCountries, loadSources, readJson, root, type GoalsFile, type ManualFile, type VenueFile } from "./lib/files.ts";
import { locate } from "./lib/geocode.ts";
import { manualGoalFromForm } from "./lib/manual.ts";
import { resolveVenue } from "./lib/update.ts";

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? process.env[`GOAL_${name.toUpperCase()}`] ?? "";
const dryRun = process.argv.includes("--dry-run");
const fail = (message: string): never => {
  console.error(`Not added: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Goal not added\n${message}\n`);
  process.exit(1);
};

let entry: ReturnType<typeof manualGoalFromForm>;
try {
  entry = manualGoalFromForm({
    date: option("date"),
    opponent: option("opponent"),
    competition: option("competition"),
    ground: option("ground"),
    stadium: option("stadium"),
    minute: option("minute"),
    penalty: option("penalty") || "false",
    score: option("score"),
    final: option("final"),
    source: option("source"),
    provisional: option("provisional") ? option("provisional") === "true" : undefined,
    today: new Date().toISOString().slice(0, 10),
  });
} catch (e) {
  fail((e as Error).message);
}
const { goal, at } = entry!;

const sources = await loadSources();
const published = await readJson<GoalsFile>(FILES.goals);
const manualFile = await readJson<ManualFile>(FILES.manual);
const venueFile = await readJson<VenueFile>(FILES.venues);
const countries = await loadCountries();
const venues = structuredClone(sources.venues);

if (manualFile.goals.some((g) => g.date === goal.date && g.team === goal.team && g.minute === goal.minute && (g.added ?? 0) === (goal.added ?? 0))) {
  fail(`A hand-entered goal for ${goal.date}, minute ${goal.minute}, is already on file.`);
}

// The stadium: one already on file under this name, or a new one placed on the map.
let venueNote = "";
if (!venues.some((v) => (v.manualNames ?? []).includes(goal.venue.name))) {
  const resolved = await resolveVenue(goal.venue, venues, countries, async (q) => (at ? { kind: "stadium", ...at, wikidata: "", label: q.name, score: 0, kmFromCity: null } : (await locate(q)).result));
  if (!resolved) fail(`The stadium "${goal.venue.name}" could not be placed on the map. Add its position to the stadium field: Name, City, Country @ latitude, longitude.`);
  const { venue, created, how } = resolved!;
  venue.manualNames = [...(venue.manualNames ?? []), goal.venue.name];
  if (created) {
    venue.city = goal.venue.city;
    if (at) delete venue.wikidata;
    venueNote = `New stadium added: ${venue.name}, ${venue.city} (${at ? "position as entered" : how}). Please check its position: ${venue.lat}, ${venue.lng}.`;
  }
}

const manual = [...sources.manual, goal];
const built = buildDataset({ ...sources, manual, venues });
const checks = validateDataset({ goals: built.goals, total: built.total, venues, countDisputed: sources.overrides.countDisputed, ref: sources.ref, countries });
if (checks.errors.length) fail(`the dataset would no longer pass its checks:\n- ${checks.errors.join("\n- ")}`);
if (built.total !== published.total + 1) {
  const steppedAside = built.report.superseded.find((s) => s.startsWith(`${goal.date} v ${goal.opponent}, ${goal.minute}'`));
  fail(steppedAside ? `the match feed already has his goals for this match, so nothing needs adding (${steppedAside}).` : `the count would go from ${published.total} to ${built.total}, not up by one.`);
}

const added = built.goals.find((g) => !published.goals.some((p) => p.id === g.id))!;
const title = `Goal ${added.n} (entered by hand): v ${added.opponent}, ${added.date} (${added.minute}'${added.added ? `+${added.added}` : ""})`;
console.log(`${title}\nCount: ${published.total} -> ${built.total}${goal.provisional ? "\nProvisional: it steps aside when the feed reports this match." : ""}${venueNote ? `\n${venueNote}` : ""}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `title=${title}\nchanged=${!dryRun}\nalert=${venueNote}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\nCount: **${published.total} → ${built.total}**\n${venueNote}\n`);
if (dryRun) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

await writeFile(path.join(root, FILES.manual), JSON.stringify({ ...manualFile, goals: manual }, null, 2) + "\n");
if (JSON.stringify(venues) !== JSON.stringify(sources.venues)) await writeFile(path.join(root, FILES.venues), JSON.stringify({ ...venueFile, venues }, null, 1) + "\n");
await writeFile(path.join(root, FILES.goals), goalsFileText(built));
await writeFile(path.join(root, FILES.report), reportFileText(built));
console.log("Written.");
