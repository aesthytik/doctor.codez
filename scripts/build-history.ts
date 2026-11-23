// One-time (re-runnable) sweep of the match feed for every Cristiano Ronaldo goal.
//
//   node scripts/build-history.ts            full sweep, uses the on-disk cache
//   node scripts/build-history.ts --only=alnassr   one team only, merged into the full file
//
// Writes data/source/espn-goals.json (facts per goal) and, for a full sweep,
// data/source/espn-sweep-report.json (what was covered, and what looked wrong).
// Nothing here decides the official count: scripts/build-dataset.ts merges this
// with the hand-entered goals and corrections.
//
// After a match, scripts/update-latest.ts is the quicker tool: it re-reads only the
// current season.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stats } from "./lib/espn.ts";
import { byMoment, discover, enrich, extract, newReport, type GoalFact } from "./lib/sweep.ts";

export type { GoalFact } from "./lib/sweep.ts";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const only = args.get("only");

const report = newReport();

const matches = await discover(only, report);
console.log(`\n${matches.length} official matches in his spells. Fetching goal details…`);

const all: GoalFact[] = [];
let done = 0;
for (const m of matches) {
  const goals = await extract(m, report);
  await enrich(goals, report);
  all.push(...goals);
  done++;
  if (done % 100 === 0) console.log(`  ${done}/${matches.length} matches, ${all.length} goals, ${stats.network} requests`);
}

all.sort(byMoment);

for (const g of all) report.totals[g.team] = (report.totals[g.team] ?? 0) + 1;
report.totals.all = all.length;
report.requests = { network: stats.network, cached: stats.cached };

const outDir = path.resolve(import.meta.dirname, "../data/source");
await mkdir(outDir, { recursive: true });
const goalsFile = path.join(outDir, "espn-goals.json");
if (only) {
  // A one-team sweep replaces that team's goals in the full file and leaves the rest alone.
  const existing: GoalFact[] = existsSync(goalsFile) ? JSON.parse(await readFile(goalsFile, "utf8")) : [];
  const merged = [...existing.filter((g) => g.team !== only), ...all].sort(byMoment);
  await writeFile(goalsFile, JSON.stringify(merged, null, 1) + "\n");
  console.log(`\nMerged ${all.length} ${only} goals into the full file (${merged.length} goals in all).`);
} else {
  await writeFile(goalsFile, JSON.stringify(all, null, 1) + "\n");
  await writeFile(path.join(outDir, "espn-sweep-report.json"), JSON.stringify(report, null, 2) + "\n");
}

console.log(`\nDone. ${all.length} goals found in the feed.`);
console.log("By team:", report.totals);
console.log(
  `Flags: noDetails=${report.noDetails.length} scoreMismatch=${report.scoreMismatch.length} missingEvents=${report.missingEvents.length} summaryMismatch=${report.summaryMismatch.length} nameWithoutId=${report.nameWithoutId.length}`,
);
console.log(`Requests: ${stats.network} network, ${stats.cached} from cache.`);
