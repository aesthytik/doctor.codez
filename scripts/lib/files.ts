// Where the data files live, and how they are read. Kept in one place so the build,
// the validator and the updater all look at the same files.
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Goal } from "../../lib/data/types.ts";
import type { CountryOutline } from "./checks.ts";
import type { ManualGoal, Overrides, Reference, VenueRecord } from "./dataset.ts";
import type { GoalFact } from "./sweep.ts";

export const root = path.resolve(import.meta.dirname, "../..");

export const FILES = {
  facts: "data/source/espn-goals.json",
  manual: "data/manual-goals.json",
  overrides: "data/overrides.json",
  venues: "data/venues.json",
  reference: "data/reference/season-totals.json",
  goals: "data/goals.json",
  report: "data/source/reconcile-report.json",
  season: "data/source/season.json",
} as const;

export async function readJson<T>(rel: string, fallback?: T): Promise<T> {
  const file = path.join(root, rel);
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${rel}`);
  }
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export type ManualFile = { note?: string; goals: ManualGoal[] };
export type VenueFile = { venues: VenueRecord[] } & Record<string, unknown>;
export type GoalsFile = { asOf: string | null; total: number; goals: Goal[] };

/** Everything the dataset is built from. */
export async function loadSources() {
  return {
    facts: await readJson<GoalFact[]>(FILES.facts),
    manual: (await readJson<ManualFile>(FILES.manual)).goals,
    overrides: await readJson<Overrides>(FILES.overrides, { countDisputed: true, exclude: [], neutral: {}, patch: {} }),
    venues: (await readJson<VenueFile>(FILES.venues, { venues: [] })).venues,
    ref: await readJson<Reference>(FILES.reference),
  };
}

/** Country outlines (Natural Earth 1:10m) for checking that a stadium sits in its stated country. */
export async function loadCountries(): Promise<CountryOutline[]> {
  const { feature } = await import("topojson-client");
  const require = createRequire(import.meta.url);
  const atlas = JSON.parse(readFileSync(require.resolve("world-atlas/countries-10m.json"), "utf8"));
  return (feature(atlas, atlas.objects.countries) as unknown as { features: CountryOutline[] }).features;
}
