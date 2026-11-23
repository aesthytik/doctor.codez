// Finding a stadium's coordinates by searching Wikidata.
//
// A name search alone can land on a district, a station or a person, so every hit is
// scored (is it a sports venue, is it in the right country, is it near the city the
// match was played in) and only a clear winner is accepted. The curated list in
// data/venues.json is still reviewed by a person; this is the first proposal.
const UA = "stadium-coordinates-lookup/0.2 (football data build; low volume)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type VenueQuery = { name: string; city: string | null; country: string | null };

export type Candidate = {
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

export type CityHit = { label: string; lat: number; lng: number; country: string | null; pop: number };
export type City = { lat: number; lng: number; label: string };

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
export const sameCountry = (feed: string | null, wd: string | null) => {
  if (!feed || !wd) return false;
  if (feed.toLowerCase() === wd.toLowerCase()) return true;
  return (COUNTRY_ALIASES[feed] ?? []).some((a) => a.toLowerCase() === wd.toLowerCase());
};

/** Search strings to try for one stadium: the name as given, then with sponsor or decoration removed. */
export function variants(v: VenueQuery): string[] {
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

async function sparql<T>(query: string, map: (b: Record<string, { value: string }>) => T | null): Promise<T[] | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query), {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(70_000),
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
      return json.results.bindings.map(map).filter((x): x is T => x !== null);
    }
    await sleep(Number(res?.headers.get("retry-after") ?? 0) * 1000 || 4000 * attempt);
  }
  return null;
}

const point = (wkt: string) => {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(wkt);
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
};

/** Wikidata items with coordinates that match any of the given names. */
export async function searchBatch(queries: string[]): Promise<Candidate[]> {
  const found = await sparql<Candidate>(
    `
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
}`,
    (b) => {
      const p = point(b.coord.value);
      return {
        query: b.q.value,
        id: b.item.value.split("/").pop()!,
        label: b.itemLabel?.value ?? "",
        description: b.itemDescription?.value ?? "",
        lng: p ? p.lng : NaN,
        lat: p ? p.lat : NaN,
        country: b.countryLabel?.value ?? null,
        isVenue: b.isVenue?.value === "true",
        score: 0,
      };
    },
  );
  if (!found) console.warn("  search failed for batch:", queries.slice(0, 3).join(" | "), "…");
  return found ?? [];
}

/** Coordinates of the feed's cities, so a stadium can be checked against where the match was played. */
export async function cityBatch(names: string[]): Promise<Map<string, CityHit[]>> {
  const out = new Map<string, CityHit[]>();
  const rows = await sparql<{ q: string } & CityHit>(
    `
SELECT ?q ?item ?itemLabel ?coord ?countryLabel ?pop WHERE {
  VALUES ?q { ${names.map((q) => JSON.stringify(q)).join(" ")} }
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ?q; mwapi:language "en"; mwapi:limit 6 .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P625 ?coord ; wdt:P1082 ?pop .
  OPTIONAL { ?item wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`,
    (b) => {
      const p = point(b.coord.value);
      return p ? { q: b.q.value, label: b.itemLabel?.value ?? "", ...p, country: b.countryLabel?.value ?? null, pop: Number(b.pop?.value ?? 0) } : null;
    },
  );
  for (const { q, ...hit } of rows ?? []) out.set(q, [...(out.get(q) ?? []), hit]);
  return out;
}

export const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function score(v: VenueQuery, c: Candidate, city: City | undefined): number {
  let s = 0;
  if (c.isVenue) s += 5;
  if (/stadium|football|soccer|arena|sports venue|ground|estadio|stadio|stade|sports complex/i.test(`${c.description} ${c.label}`)) s += 3;
  if (/district|suburb|station|neighbou?rhood|village|town|municipality|person|born|footballer|politician|street|metro/i.test(c.description)) s -= 4;
  if (sameCountry(v.country, c.country)) s += 3;
  else if (v.country && c.country) s -= 5;
  if (v.city && new RegExp(v.city.split(/[ ,]/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(`${c.description} ${c.label}`)) s += 2;
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

/** The most populous place of that name in that country. */
export const pickCity = (hits: CityHit[] | undefined, country: string | null): City | undefined => {
  const inCountry = (hits ?? []).filter((c) => sameCountry(country, c.country)).sort((a, b) => b.pop - a.pop);
  return inCountry[0] && { lat: inCountry[0].lat, lng: inCountry[0].lng, label: inCountry[0].label };
};

export type Located =
  | { kind: "stadium"; lat: number; lng: number; wikidata: string; label: string; score: number; kmFromCity: number | null }
  | { kind: "city"; lat: number; lng: number; label: string };

/**
 * Locate one stadium without a person in the loop (the updater uses this for a ground
 * he has not scored at before). A stadium is accepted only when Wikidata classes it as
 * a sports venue in the right country and no other candidate scores as well; failing
 * that, the city is returned so the goal can still be placed, marked as approximate.
 */
export async function locate(v: VenueQuery): Promise<{ result: Located | null; candidates: Candidate[] }> {
  const city = v.city ? pickCity((await cityBatch([v.city])).get(v.city), v.country) : undefined;
  const seen = new Map<string, Candidate>();
  for (const c of await searchBatch(variants(v))) if (!seen.has(c.id)) seen.set(c.id, c);
  const candidates = [...seen.values()].map((c) => ({ ...c, score: score(v, c, city) })).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const clear = best && best.isVenue && sameCountry(v.country, best.country) && best.score >= 11 && !(runnerUp && runnerUp.score >= best.score - 1);
  if (best && clear && Number.isFinite(best.lat) && Number.isFinite(best.lng)) {
    return {
      result: { kind: "stadium", lat: best.lat, lng: best.lng, wikidata: best.id, label: best.label, score: best.score, kmFromCity: city ? Math.round(km(city, best)) : null },
      candidates,
    };
  }
  return { result: city ? { kind: "city", ...city } : null, candidates };
}
