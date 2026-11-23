// Checks that the published dataset is internally sound and still agrees with its references.
// Run on every change; the build must not ship if this fails.
//
//   node scripts/validate.ts
//
// The checks live in scripts/lib/checks.ts; this file reads the files and reports.
import { validateDataset } from "./lib/checks.ts";
import { FILES, loadCountries, readJson, type GoalsFile, type VenueFile } from "./lib/files.ts";

const { goals, total } = await readJson<GoalsFile>(FILES.goals);
const venues = (await readJson<VenueFile>(FILES.venues, { venues: [] })).venues;
const overrides = await readJson<{ countDisputed: boolean }>(FILES.overrides);
const ref = await readJson<Parameters<typeof validateDataset>[0]["ref"]>(FILES.reference);

const { errors, warnings, disputed } = validateDataset({
  goals,
  total,
  venues,
  countDisputed: overrides.countDisputed,
  ref,
  countries: await loadCountries(),
});

for (const w of warnings.slice(0, 40)) console.log("warning:", w);
if (warnings.length > 40) console.log(`… and ${warnings.length - 40} more warnings`);
for (const e of errors) console.error("ERROR:", e);
console.log(
  `\n${goals.length} goals, ${venues.length} venues. ${errors.length} error(s), ${warnings.length} warning(s).` +
    (disputed ? ` ${disputed} disputed goal(s) counted.` : ""),
);
if (errors.length) process.exit(1);
