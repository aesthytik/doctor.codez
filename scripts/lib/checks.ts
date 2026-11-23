// The checks a dataset must pass before it is published. Pure: the caller supplies
// the data, so the same checks run on the files on disk (scripts/validate.ts) and on
// a dataset the updater has built but not yet written.
import type { Goal } from "../../lib/data/types.ts";
import type { VenueRecord } from "./dataset.ts";

export type CountryOutline = {
  properties: { name: string };
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
};

const TEAMS = new Set(["sporting", "manutd", "realmadrid", "juventus", "alnassr", "portugal"]);
const DEBUT = "2002-10-07";
/** The reference tables were last read on this date; later goals are checked for shape only. */
export const LAST_REFERENCE_DATE = "2026-11-20";

/** Names the outlines use where the dataset says something else. */
const ATLAS_NAME: Record<string, string> = {
  England: "United Kingdom",
  Wales: "United Kingdom",
  Scotland: "United Kingdom",
  "Northern Ireland": "United Kingdom",
  "United States": "United States of America",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "Faroe Islands": "Faeroe Is.",
  "Czech Republic": "Czechia",
};

const inRing = (pt: [number, number], ring: number[][]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolygon = (pt: [number, number], poly: number[][][]) => inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole));
// The outlines are coarse at the shoreline, so a waterfront stadium may fall just outside.
// A point within about 3 km of the country's outline is accepted.
const nearOutline = (pt: [number, number], poly: number[][][], km: number) => {
  const kx = 111.32 * Math.cos((pt[1] * Math.PI) / 180);
  const ky = 110.57;
  for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - pt[0]) * kx;
      const ay = (ring[i - 1][1] - pt[1]) * ky;
      const bx = (ring[i][0] - pt[0]) * kx;
      const by = (ring[i][1] - pt[1]) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(ax + t * dx, ay + t * dy) <= km) return true;
    }
  }
  return false;
};

/** Whether a point lies in a country: true, false, or null when there is no outline by that name. */
export function inCountry(countries: CountryOutline[], lng: number, lat: number, country: string): boolean | null {
  const name = ATLAS_NAME[country] ?? country;
  const f = countries.find((c) => c.properties.name === name);
  if (!f) return null;
  const pt: [number, number] = [lng, lat];
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.some((p) => inPolygon(pt, p)) || polys.some((p) => nearOutline(pt, p, 3));
}

export function validateDataset(input: {
  goals: Goal[];
  total: number;
  venues: VenueRecord[];
  countDisputed: boolean;
  ref: { club: { team: string; season: string; total: number }[]; portugalByYear: Record<string, number>; careerTotal: number };
  countries: CountryOutline[];
}): { errors: string[]; warnings: string[]; disputed: number } {
  const { goals, total, venues, ref, countries } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string) => errors.push(msg);
  const warn = (msg: string) => warnings.push(msg);

  // ---- shape and order ----
  if (total !== goals.length) fail(`total says ${total} but there are ${goals.length} goals`);
  const ids = new Set<string>();
  goals.forEach((g, i) => {
    const at = `goal ${g.n} (${g.date} v ${g.opponent})`;
    if (g.n !== i + 1) fail(`${at}: numbered ${g.n}, expected ${i + 1}`);
    if (ids.has(g.id)) fail(`${at}: duplicate id ${g.id}`);
    ids.add(g.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) fail(`${at}: bad date`);
    if (g.date < DEBUT) fail(`${at}: before his first senior goal`);
    if (i > 0 && g.date < goals[i - 1].date) fail(`${at}: out of date order`);
    if (!TEAMS.has(g.team)) fail(`${at}: unknown team ${g.team}`);
    if (!g.opponent || !g.comp || !g.compKey || !g.season) fail(`${at}: missing opponent, competition or season`);
    if (!["H", "A", "N"].includes(g.ha)) fail(`${at}: bad home/away value`);
    if (!Number.isInteger(g.minute) || g.minute < 1 || g.minute > 120) fail(`${at}: minute ${g.minute} is outside 1–120`);
    if (g.added !== undefined && (g.added < 1 || g.added > 20)) fail(`${at}: stoppage time ${g.added} looks wrong`);
    if (g.minute > 90 && !g.added && g.decided === undefined && g.minute !== 90) {
      // A goal after 90 without stoppage time means extra time was played.
      warn(`${at}: scored in minute ${g.minute} but the match is not marked as going to extra time`);
    }
    if (typeof g.penalty !== "boolean") fail(`${at}: penalty flag missing`);
    if (g.score) {
      const [us, them] = g.score;
      if (us < 1) fail(`${at}: his team cannot have 0 straight after he scored`);
      if (us > g.final[0] || them > g.final[1]) fail(`${at}: score after the goal (${us}–${them}) exceeds the final score (${g.final.join("–")})`);
    } else warn(`${at}: no score at the time`);
    if (!g.src?.length) fail(`${at}: no source recorded`);
    if (g.preview) fail(`${at}: a rehearsal goal has leaked into the real dataset`);
  });

  // ---- no two goals in the same match at the same instant ----
  const instants = new Map<string, number>();
  for (const g of goals) {
    const key = `${g.date}|${g.team}|${g.opponent}|${g.minute}|${g.added ?? 0}`;
    if (instants.has(key)) warn(`goals ${instants.get(key)} and ${g.n} share a match and a minute: check they are two goals, not one entered twice`);
    instants.set(key, g.n);
  }

  // ---- running score within a match must climb by one each time ----
  const byMatch = new Map<string, Goal[]>();
  for (const g of goals) {
    const k = `${g.date}|${g.team}|${g.opponent}`;
    byMatch.set(k, [...(byMatch.get(k) ?? []), g]);
  }
  for (const [k, list] of byMatch) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1].score;
      const b = list[i].score;
      if (a && b && b[0] <= a[0]) fail(`${k}: goal ${list[i].n} does not raise his team's score above goal ${list[i - 1].n}`);
    }
    const finals = new Set(list.map((g) => g.final.join("–")));
    if (finals.size > 1) fail(`${k}: goals in one match disagree on the final score`);
  }

  // ---- totals against the reference ----
  const disputed = goals.filter((g) => g.disputed);
  if (!input.countDisputed && disputed.length) fail("disputed goals are present although countDisputed is off");
  const expected = ref.careerTotal + disputed.length;
  if (goals.length < expected) fail(`dataset has ${goals.length} goals; the reference (as of its date) implies at least ${expected}`);
  const upToRef = goals.filter((g) => g.date <= LAST_REFERENCE_DATE).length;
  if (upToRef !== expected) fail(`up to ${LAST_REFERENCE_DATE} the dataset has ${upToRef} goals; reference plus counted disputed goals is ${expected}`);

  for (const row of ref.club) {
    const mine = goals.filter((g) => g.team === row.team && g.season === row.season && g.date <= LAST_REFERENCE_DATE);
    const allowed = mine.filter((g) => g.disputed).length;
    if (mine.length - allowed !== row.total) fail(`${row.team} ${row.season}: dataset ${mine.length - allowed} (excluding disputed), reference ${row.total}`);
  }
  for (const [year, n] of Object.entries(ref.portugalByYear)) {
    const mine = goals.filter((g) => g.team === "portugal" && g.date.startsWith(year)).length;
    if (mine !== n) fail(`Portugal ${year}: dataset ${mine}, reference ${n}`);
  }

  // ---- venues ----
  if (venues.length === 0) warn("data/venues.json is missing: goals cannot be placed on the map yet");
  else {
    const byId = new Map(venues.map((v) => [v.id, v]));
    for (const g of goals) {
      const v = byId.get(g.venue);
      if (!v) fail(`goal ${g.n}: venue "${g.venue}" is not in venues.json`);
    }
    // Each stadium must sit inside the country it is listed under (Natural Earth outlines).
    for (const v of venues) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) fail(`venue ${v.id}: bad coordinates`);
      if (!v.reviewed) warn(`venue ${v.id} (${v.name}) has not been reviewed to stadium precision`);
      const where = inCountry(countries, v.lng, v.lat, v.country);
      if (where === null) warn(`venue ${v.id}: no outline for "${v.country}", position not checked`);
      else if (!where) fail(`venue ${v.id} (${v.name}): ${v.lat}, ${v.lng} is not inside ${v.country}`);
    }
    const used = new Set(goals.map((g) => g.venue));
    for (const v of venues) if (!used.has(v.id)) warn(`venue ${v.id} is not used by any goal`);
  }

  return { errors, warnings, disputed: disputed.length };
}
