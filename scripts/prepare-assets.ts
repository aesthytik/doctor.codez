// Writes the files the site needs into public/ before dev and build:
//   - the MapLibre worker (it must be served as its own file)
//   - a world outline (Natural Earth, public domain) so the globe needs no tile server
//   - the dataset and a tiny status file, for pages that are already open (lib/live.ts)
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { feature, mesh } from "topojson-client";
import { celebrationSetting, forBrowser, versionOf, type Status } from "../lib/data/publish.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const pub = (...p: string[]) => path.join(root, "public", ...p);

// 1. MapLibre worker, versioned so a library upgrade can never pair with a stale worker.
const mlPkg = JSON.parse(await readFile(require.resolve("maplibre-gl/package.json"), "utf8"));
const mlDist = path.dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
await mkdir(pub("vendor"), { recursive: true });
await copyFile(path.join(mlDist, "maplibre-gl-worker.mjs"), pub("vendor", `maplibre-gl-worker-${mlPkg.version}.mjs`));

// 2. World outline. Coordinates are rounded to 3 decimals (about 100 m), plenty for a globe.
const round = (geo: unknown) => JSON.stringify(geo, (_k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v));
const atlas = (name: string) => JSON.parse(require("node:fs").readFileSync(require.resolve(`world-atlas/${name}`), "utf8"));

// MapLibre treats coordinates as flat, so a ring that hops from +180 to -180 is drawn
// the long way round the globe. Make every ring continuous instead (longitudes may
// run past 180), and close the one ring that circles the pole (Antarctica) along the
// bottom edge of the map.
type Pt = [number, number];
function unwrap(line: Pt[]): Pt[] {
  let shift = 0;
  return line.map((p, i) => {
    if (i > 0) {
      const dx = p[0] - line[i - 1][0];
      if (dx > 180) shift -= 360;
      else if (dx < -180) shift += 360;
    }
    return [p[0] + shift, p[1]] as Pt;
  });
}
function fixRing(ring: Pt[]): Pt[] {
  const r = unwrap(ring);
  const first = r[0];
  const last = r[r.length - 1];
  if (Math.abs(last[0] - first[0]) < 180) return r;
  const south = first[1] < 0 ? -89.5 : 89.5;
  return [...r.slice(0, -1), [last[0], last[1]], [last[0], south], [first[0], south], first];
}

const land50 = atlas("land-50m.json");
const countries50 = atlas("countries-50m.json");
await mkdir(pub("geo"), { recursive: true });

const land = feature(land50, land50.objects.land) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
// The source data closes Antarctica with a tiny ring around the pole itself. It lies
// beyond the edge of the map, so it is dropped and the continent is filled to the edge.
const fixPolygon = (poly: Pt[][]) =>
  poly.filter((ring, i) => i === 0 || ring.some((p) => p[1] > -85)).map((ring) => fixRing(ring));
for (const f of land.features) {
  const g = f.geometry;
  if (g.type === "Polygon") g.coordinates = fixPolygon(g.coordinates as Pt[][]);
  else g.coordinates = g.coordinates.map((poly) => fixPolygon(poly as Pt[][]));
}
await writeFile(pub("geo", "land.json"), round(land));

// Coastlines as plain lines (so the artificial closing edge above is never stroked),
// and borders only where two countries meet (so coastlines are not drawn twice).
const lines = (m: GeoJSON.MultiLineString) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "MultiLineString", coordinates: m.coordinates.map((l) => unwrap(l as Pt[])) },
});
await writeFile(pub("geo", "coast.json"), round(lines(mesh(land50, land50.objects.land))));
await writeFile(
  pub("geo", "borders.json"),
  round(lines(mesh(countries50, countries50.objects.countries, (a: unknown, b: unknown) => a !== b))),
);

await writeFile(
  path.join(root, "lib", "vendor.generated.ts"),
  `// Written by scripts/prepare-assets.ts. Do not edit.\nexport const MAPLIBRE_WORKER_URL = "/vendor/maplibre-gl-worker-${mlPkg.version}.mjs";\n`,
);
// 3. The dataset as files. An open page asks for status.json every minute and fetches
// data.json when the version stamp has moved on.
const json = async (rel: string) => JSON.parse(await readFile(path.join(root, rel), "utf8"));
const goalsFile = await json("data/goals.json");
const data = forBrowser(goalsFile.goals, (await json("data/venues.json")).venues);
const season = await json("data/source/season.json").catch(() => null);
const status: Status = {
  v: versionOf(data),
  total: goalsFile.total,
  asOf: goalsFile.asOf,
  celebration: celebrationSetting(await json("data/overrides.json")),
  next: (season?.next ?? []).map((f: { kickoff: string }) => f.kickoff),
};
await mkdir(pub("live"), { recursive: true });
await writeFile(pub("live", "data.json"), JSON.stringify({ v: status.v, ...data }));
await writeFile(pub("live", "status.json"), JSON.stringify(status));

console.log(`assets ready (maplibre worker ${mlPkg.version}, world outline, data ${status.v} with ${status.total} goals)`);
