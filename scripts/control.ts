// The switches a person may need on a match night, each a small, checked edit to the
// hand-corrections file (data/overrides.json) or the hand-entered goals.
//
//   node scripts/control.ts --action=hold-celebration
//   node scripts/control.ts --action=release-celebration
//   node scripts/control.ts --action=remove-goal --goal=987 --reason="Credited to another player by the league"
//   node scripts/control.ts --action=restore-goal            (undoes the most recent removal)
//   node scripts/control.ts --action=count-disputed
//   node scripts/control.ts --action=leave-out-disputed
//
// Add --dry-run to see the result without writing. Nothing is written unless the
// whole dataset still passes every check.
import { appendFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDataset } from "./lib/checks.ts";
import { buildDataset, goalsFileText, reportFileText, type Overrides } from "./lib/dataset.ts";
import { FILES, loadCountries, loadSources, readJson, root, type GoalsFile, type ManualFile } from "./lib/files.ts";

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? process.env[`CONTROL_${name.toUpperCase()}`] ?? "";
const dryRun = process.argv.includes("--dry-run");
const fail = (message: string): never => {
  console.error(`Nothing changed: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Nothing changed\n${message}\n`);
  process.exit(1);
};

const action = option("action");
const sources = await loadSources();
const published = await readJson<GoalsFile>(FILES.goals);
const overridesFile = await readJson<Overrides & Record<string, unknown>>(FILES.overrides);
const manualFile = await readJson<ManualFile>(FILES.manual);
let manual = manualFile.goals;
let title = "";

switch (action) {
  case "hold-celebration":
    overridesFile.celebration = "hold";
    title = "Hold the goal-1,000 celebration";
    break;
  case "release-celebration":
    overridesFile.celebration = "auto";
    title = "Release the goal-1,000 celebration";
    break;
  case "count-disputed":
    overridesFile.countDisputed = true;
    title = "Count the disputed goal";
    break;
  case "leave-out-disputed":
    overridesFile.countDisputed = false;
    title = "Leave the disputed goal out of the count";
    break;
  case "remove-goal": {
    const n = Number(option("goal"));
    const reason = option("reason").trim();
    const goal = published.goals.find((g) => g.n === n);
    if (!goal) fail(`there is no goal number ${option("goal") || "(none given)"}. The count is ${published.total}.`);
    if (!reason) fail("a reason is needed for removing a goal.");
    const g = goal!;
    const fromFeed = sources.facts.find((f) => g.src[0] === `espn:${f.eventId}` && f.minute === g.minute && f.added === (g.added ?? 0) && !g.disputed);
    if (fromFeed) overridesFile.exclude = [...overridesFile.exclude, { eventId: fromFeed.eventId, clock: fromFeed.clock, reason }];
    else {
      const before = manual.length;
      manual = manual.filter((m) => !(m.date === g.date && m.team === g.team && m.minute === g.minute && (m.added ?? 0) === (g.added ?? 0)));
      if (manual.length !== before - 1) fail(`goal ${n} could not be matched to exactly one record.`);
    }
    title = `Remove goal ${n} (${g.date} v ${g.opponent}, ${g.minute}'): ${reason}`;
    break;
  }
  case "restore-goal": {
    const last = overridesFile.exclude[overridesFile.exclude.length - 1];
    if (!last) fail("no goal from the match feed has been removed, so there is nothing to restore. A hand-entered goal is restored by entering it again.");
    overridesFile.exclude = overridesFile.exclude.slice(0, -1);
    title = `Restore the goal removed earlier (match ${last!.eventId}, ${last!.clock})`;
    break;
  }
  default:
    fail(`"${action}" is not one of: hold-celebration, release-celebration, remove-goal, restore-goal, count-disputed, leave-out-disputed.`);
}

const built = buildDataset({ ...sources, manual, overrides: overridesFile });
const checks = validateDataset({ goals: built.goals, total: built.total, venues: sources.venues, countDisputed: overridesFile.countDisputed, ref: sources.ref, countries: await loadCountries() });
if (checks.errors.length) fail(`the dataset would no longer pass its checks:\n- ${checks.errors.join("\n- ")}`);

title += built.total === published.total ? "" : ` (count ${published.total} → ${built.total})`;
console.log(`${title}\nCount: ${published.total} -> ${built.total}. Celebration: ${overridesFile.celebration ?? "auto"}.`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `title=${title}\nchanged=${!dryRun}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\nCount: **${published.total} → ${built.total}**. Celebration: ${overridesFile.celebration ?? "auto"}.\n`);
if (dryRun) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

await writeFile(path.join(root, FILES.overrides), JSON.stringify(overridesFile, null, 2) + "\n");
if (manual !== manualFile.goals) await writeFile(path.join(root, FILES.manual), JSON.stringify({ ...manualFile, goals: manual }, null, 2) + "\n");
await writeFile(path.join(root, FILES.goals), goalsFileText(built));
await writeFile(path.join(root, FILES.report), reportFileText(built));
console.log("Written.");
