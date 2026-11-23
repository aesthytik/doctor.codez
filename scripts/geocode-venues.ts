// Proposes coordinates for every stadium in the dataset by searching Wikidata.
//
//   node scripts/geocode-venues.ts
//
// Reads the venues found by the sweep (data/source/espn-goals.json) plus the
// hand-entered ones (data/manual-goals.json), and writes
// data/source/venue-candidates.json: every candidate with a score, and the pick.
// Nothing here is final: data/venues.json is curated by hand from this output,
// because a name search alone can land on a district, a station or a person.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const UA = "stadium-coordinates-lookup/0.1 (one-off data build; low volume)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VenueIn = { key: string; name: string; city: string | null; country: string | null; goals: number; firstDate: string };
type Candidate = {
  query: string;
  id: string;
  label: string;
  description: string;
  lat: number;
  lng: number;
  country: string | null;
  isVenue: boolean;
  score: number;
};

/** Country names differ between the feed and Wikidata. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  England: ["United Kingdom"],
  Scotland: ["United Kingdom"],
  Wales: ["United Kingdom"],
  "Northern Ireland": ["United Kingdom"],
  USA: ["United States", "United States of America"],
  "United States": ["United States of America"],
  "Republic of Ireland": ["Ireland"],
  "Korea Republic": ["South Korea"],
  "South Korea": ["South Korea"],
  Turkey: ["Turkey", "Türkiye"],
  Türkiye: ["Turkey"],
  "Czech Republic": ["Czech Republic", "Czechia"],
  Czechia: ["Czech Republic"],
  Russia: ["Russia", "Soviet Union"],
  UAE: ["United Arab Emirates"],
  "Bosnia-Herzegovina": ["Bosnia and Herzegovina"],
  "Bosnia and Herzegovina": ["Bosnia and Herzegovina"],
  Netherlands: ["Netherlands", "Kingdom of the Netherlands"],
  China: ["People's Republic of China", "China"],
  "China PR": ["People's Republic of China"],
  "Hong Kong": ["People's Republic of China", "Hong Kong"],
  Iran: ["Iran"],
  "North Macedonia": ["North Macedonia"],
  Macedonia: ["North Macedonia"],
};
const sameCountry = (feed: string | null, wd: string | null) => {
  if (!feed || !wd) return false;
  if (feed.toLowerCase() === wd.toLowerCase()) return true;
  return (COUNTRY_ALIASES[feed] ?? []).some((a) => a.toLowerCase() === wd.toLowerCase());
};

/** Search strings to try for one stadium: the name as given, then with sponsor or decoration removed. */
function variants(v: VenueIn): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length > 2) out.add(t);
  };
  add(v.name);
  for (const part of v.name.split(/\s+[-–—]\s+/)) add(part);
  add(v.name.replace(/^(Spotify|Riyadh Air|Reale|Civitas|Coliseum|RCDE|Estadio|Estádio|Stadio|Stade|Stadion)\s+/i, ""));
  if (!/stadi|estadi|estádio|arena|park|ground|field|stade|stadion/i.test(v.name)) {
    add(`${v.name} Stadium`);
    add(`Stadio ${v.name}`);
    add(`Estadio ${v.name}`);
    add(`Estádio ${v.name}`);
  }
  if (v.city) add(`${v.name} ${v.city}`);
  return [...out];
}

async function searchBatch(queries: string[]): Promise<Candidate[]> {
  const sparql = `
SELECT ?q ?item ?itemLabel ?itemDescription ?coord ?countryLabel ?isVenue WHERE {
  VALUES ?q { ${queries.map((q) => JSON.stringify(q)).join(" ")} }
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ?q; mwapi:language "en"; mwapi:limit 6 .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P17 ?country . }
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:Q1076486 } AS ?isVenue)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql), {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(70_000),
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
      return json.results.bindings.map((b) => {
        const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
        return {
          query: b.q.value,
          id: b.item.value.split("/").pop()!,
          label: b.itemLabel?.value ?? "",
          description: b.itemDescription?.value ?? "",
          lng: m ? Number(m[1]) : NaN,
          lat: m ? Number(m[2]) : NaN,
          country: b.countryLabel?.value ?? null,
          isVenue: b.isVenue?.value === "true",
          score: 0,
        };
      });
    }
    const wait = Number(res?.headers.get("retry-after") ?? 0) * 1000 || 4000 * attempt;
    await sleep(wait);
  }
  console.warn("  search failed for batch:", queries.slice(0, 3).join(" | "), "…");
  return [];
}

type City = { lat: number; lng: number; label: string };

/** Coordinates of the feed's cities, so a stadium can be checked against where the match was played. */
async function cityBatch(names: string[]): Promise<Map<string, { label: string; lat: number; lng: number; country: string | null; pop: number }[]>> {
  const sparql = `
SELECT ?q ?item ?itemLabel ?coord ?countryLabel ?pop WHERE {
  VALUES ?q { ${names.map((q) => JSON.stringify(q)).join(" ")} }
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ?q; mwapi:language "en"; mwapi:limit 6 .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P625 ?coord ; wdt:P1082 ?pop .
  OPTIONAL { ?item wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
  const out = new Map<string, { label: string; lat: number; lng: number; country: string | null; pop: number }[]>();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql), {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(70_000),
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
      for (const b of json.results.bindings) {
        const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
        if (!m) continue;
        const arr = out.get(b.q.value) ?? [];
        arr.push({ label: b.itemLabel?.value ?? "", lng: Number(m[1]), lat: Number(m[2]), country: b.countryLabel?.value ?? null, pop: Number(b.pop?.value ?? 0) });
        out.set(b.q.value, arr);
      }
      return out;
    }
    await sleep(Number(res?.headers.get("retry-after") ?? 0) * 1000 || 4000 * attempt);
  }
  return out;
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function score(v: VenueIn, c: Candidate, city: City | undefined): number {
  let s = 0;
  if (c.isVenue) s += 5;
  if (/stadium|football|soccer|arena|sports venue|ground|estadio|stadio|stade|sports complex/i.test(`${c.description} ${c.label}`)) s += 3;
  if (/district|suburb|station|neighbou?rhood|village|town|municipality|person|born|footballer|politician|street|metro/i.test(c.description)) s -= 4;
  if (sameCountry(v.country, c.country)) s += 3;
  else if (v.country && c.country) s -= 5;
  if (v.city && new RegExp(v.city.split(/[ ,]/)[0], "i").test(`${c.description} ${c.label}`)) s += 2;
  if (c.query === v.name) s += 1;
  if (city) {
    const d = km(city, c);
    if (d <= 25) s += 6;
    else if (d <= 60) s += 2;
    else if (d > 150) s -= 8;
    else s -= 3;
  }
  return s;
}

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
const cityHits = new Map<string, { label: string; lat: number; lng: number; country: string | null; pop: number }[]>();
for (let i = 0; i < cityNames.length; i += BATCH) {
  for (const [k, arr] of await cityBatch(cityNames.slice(i, i + BATCH))) cityHits.set(k, arr);
  console.log(`  located ${Math.min(i + BATCH, cityNames.length)}/${cityNames.length} cities`);
  await sleep(1500);
}
const cities = new Map<string, City>();
for (const v of list) {
  const key = cityKey(v);
  if (!key || cities.has(key)) continue;
  const inCountry = (cityHits.get(v.city!) ?? []).filter((c) => sameCountry(v.country, c.country)).sort((a, b) => b.pop - a.pop);
  if (inCountry[0]) cities.set(key, { lat: inCountry[0].lat, lng: inCountry[0].lng, label: inCountry[0].label });
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
