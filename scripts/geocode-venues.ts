// Proposes coordinates for stadiums by searching Wikidata.
//
//   node scripts/geocode-venues.ts
//       every stadium in the dataset -> data/source/venue-candidates.json
//   node scripts/geocode-venues.ts --name="Rashid Stadium" --city=Dubai --country="United Arab Emirates"
//       one stadium, printed (for a ground he has not scored at yet)
//
// Nothing here is final: data/venues.json is curated by hand from this output,
// because a name search alone can land on a district, a station or a person.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cityBatch, km, locate, pickCity, score, searchBatch, variants, type Candidate, type City, type CityHit } from "./lib/geocode.ts";

const root = path.resolve(import.meta.dirname, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (arg("name")) {
  const { result, candidates } = await locate({ name: arg("name")!, city: arg("city") ?? null, country: arg("country") ?? null });
  console.log(result ? JSON.stringify(result) : "No confident position found.");
  for (const c of candidates.slice(0, 5)) console.log(`  ${String(c.score).padStart(3)}  ${c.id}  ${c.label} — ${c.description} (${c.country ?? "?"}) ${c.lat}, ${c.lng}`);
  process.exit(0);
}

type VenueIn = { key: string; name: string; city: string | null; country: string | null; goals: number; firstDate: string };

// ---------- collect venues ----------
const venues = new Map<string, VenueIn>();
const note = (key: string, name: string, city: string | null, country: string | null, date: string) => {
  const v = venues.get(key);
  if (v) {
    v.goals++;
    if (date < v.firstDate) v.firstDate = date;
  } else venues.set(key, { key, name, city, country, goals: 1, firstDate: date });
};

const sweepFile = path.join(root, "data/source", process.argv.includes("--juventus") ? "espn-goals.juventus.json" : "espn-goals.json");
for (const g of JSON.parse(await readFile(sweepFile, "utf8"))) {
  if (!g.venue?.name) continue;
  note(`espn:${g.venue.id ?? g.venue.name}`, g.venue.name, g.venue.city, g.venue.country, g.kickoff.slice(0, 10));
}
const manualFile = path.join(root, "data/manual-goals.json");
if (existsSync(manualFile)) {
  for (const g of JSON.parse(await readFile(manualFile, "utf8")).goals ?? []) {
    note(`manual:${g.venue.name}`, g.venue.name, g.venue.city, g.venue.country, g.date);
  }
}

// ---------- search ----------
const list = [...venues.values()].sort((a, b) => b.goals - a.goals);
const wanted = new Map<string, string[]>(); // query -> venue keys
for (const v of list) for (const q of variants(v)) wanted.set(q, [...(wanted.get(q) ?? []), v.key]);

const queries = [...wanted.keys()];
const found = new Map<string, Candidate[]>(); // venue key -> candidates
const BATCH = 12;
for (let i = 0; i < queries.length; i += BATCH) {
  const batch = queries.slice(i, i + BATCH);
  const results = await searchBatch(batch);
  for (const c of results) {
    for (const key of wanted.get(c.query) ?? []) {
      const arr = found.get(key) ?? [];
      if (!arr.some((x) => x.id === c.id)) arr.push({ ...c });
      found.set(key, arr);
    }
  }
  console.log(`  searched ${Math.min(i + BATCH, queries.length)}/${queries.length} names`);
  await sleep(1500);
}

// ---------- cities ----------
const cityKey = (v: VenueIn) => (v.city ? `${v.city}|${v.country ?? ""}` : null);
const cityNames = [...new Set(list.map((v) => v.city).filter((c): c is string => Boolean(c)))];
const cityHits = new Map<string, CityHit[]>();
for (let i = 0; i < cityNames.length; i += BATCH) {
  for (const [k, arr] of await cityBatch(cityNames.slice(i, i + BATCH))) cityHits.set(k, arr);
  console.log(`  located ${Math.min(i + BATCH, cityNames.length)}/${cityNames.length} cities`);
  await sleep(1500);
}
const cities = new Map<string, City>();
for (const v of list) {
  const key = cityKey(v);
  if (!key || cities.has(key)) continue;
  const city = pickCity(cityHits.get(v.city!), v.country);
  if (city) cities.set(key, city);
}

// ---------- rank ----------
const out = list.map((v) => {
  const city = cityKey(v) ? cities.get(cityKey(v)!) : undefined;
  const cands = (found.get(v.key) ?? []).map((c) => ({ ...c, score: score(v, c, city) })).sort((a, b) => b.score - a.score);
  const best = cands[0] && cands[0].score >= 8 ? cands[0] : null;
  const runnerUp = cands[1];
  return {
    ...v,
    cityCheck: city ? { label: city.label, kmFromCity: best ? Math.round(km(city, best)) : null } : null,
    pick: best && { id: best.id, label: best.label, description: best.description, lat: best.lat, lng: best.lng, score: best.score },
    ambiguous: Boolean(best && runnerUp && runnerUp.score >= best.score - 1 && runnerUp.id !== best.id),
    candidates: cands.slice(0, 5),
  };
});

await mkdir(path.join(root, "data/source"), { recursive: true });
await writeFile(path.join(root, "data/source/venue-candidates.json"), JSON.stringify(out, null, 1) + "\n");
const resolved = out.filter((v) => v.pick).length;
console.log(`\n${out.length} venues: ${resolved} with a confident pick, ${out.length - resolved} unresolved, ${out.filter((v) => v.ambiguous).length} ambiguous.`);
for (const v of out.filter((x) => !x.pick)) console.log(`  unresolved: ${v.name} (${v.city ?? "?"}, ${v.country ?? "?"}) — ${v.goals} goals`);
