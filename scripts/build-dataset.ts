// Builds the published dataset from its sources. No network: safe to run anywhere.
//
//   node scripts/build-dataset.ts            write data/goals.json
//   node scripts/build-dataset.ts --report   also print the reconciliation tables
//
// The rules live in scripts/lib/dataset.ts; this file only reads and writes.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDataset, goalsFileText, reportFileText } from "./lib/dataset.ts";
import { loadSources, root } from "./lib/files.ts";

const built = buildDataset(await loadSources());
const { report } = built;

await writeFile(path.join(root, "data/goals.json"), goalsFileText(built));
await writeFile(path.join(root, "data/source/reconcile-report.json"), reportFileText(built));

console.log(`${built.total} goals written to data/goals.json (reference ${report.referenceTotal}, plus ${built.disputedCounted} disputed counted = ${report.expectedTotal}).`);
for (const e of report.explainedDifferences) console.log("  explained: " + e);
console.log("By team:", report.byTeam);
console.log(`Differences from the reference: ${report.differences.length}`);
for (const d of report.differences) console.log("  " + d);
if (report.excluded.length) console.log(`Excluded by override: ${report.excluded.length}`);
for (const s of report.superseded) console.log("  superseded: " + s);
console.log(`Venues still to curate: ${report.missingVenues.length}`);
if (process.argv.includes("--report")) {
  console.log("\nNeutral-ground review:");
  for (const l of report.neutralReview) console.log("  " + l);
}
