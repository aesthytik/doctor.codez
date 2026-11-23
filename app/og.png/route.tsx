// The picture shown when the site is shared: the count, and the Earth with a light at
// every stadium. Drawn when the site is built, so it always carries the current number.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import { facts, published } from "@/lib/data/career";
import { buildWorld } from "@/lib/data/derive";
import { OG_IMAGE, SITE_NAME, TAGLINE } from "@/lib/site";

// A route with a file name of its own, rather than Next's opengraph-image convention:
// the exported site then holds a real og.png that any static host serves as an image.
export const dynamic = "force-static";

const font = (file: string) => readFile(path.join(process.cwd(), "assets/fonts", file));

// The globe: an orthographic view centred between Lisbon and Riyadh.
const R = 318;
const CX = 905;
const CY = 330;
const rad = Math.PI / 180;
const [lng0, lat0] = [14 * rad, 33 * rad];

/** A place on the Earth as a point on the picture, and whether it faces the viewer. */
function project(lng: number, lat: number): { x: number; y: number; front: boolean } {
  const l = lng * rad - lng0;
  const p = lat * rad;
  const x = Math.cos(p) * Math.sin(l);
  const y = Math.cos(lat0) * Math.sin(p) - Math.sin(lat0) * Math.cos(p) * Math.cos(l);
  const front = Math.sin(lat0) * Math.sin(p) + Math.cos(lat0) * Math.cos(p) * Math.cos(l) > 0;
  // A point on the far side is drawn on the edge of the disc, so coastlines that run
  // over the horizon close along it.
  const k = front ? 1 : 1 / Math.hypot(x, y);
  return { x: CX + R * x * k, y: CY - R * y * k, front };
}

function landPath(): string {
  const topology = land110 as unknown as Parameters<typeof feature>[0];
  const land = feature(topology, topology.objects.land) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  const parts: string[] = [];
  for (const f of land.features) {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const [outer] of polygons) {
      const pts = outer.map(([lng, lat]) => project(lng, lat));
      if (!pts.some((p) => p.front)) continue;
      parts.push(`M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`);
    }
  }
  return parts.join("");
}

/** A light for every stadium on the near side, larger where he has scored more. */
function lights(): { id: string; x: number; y: number; r: number }[] {
  return buildWorld(published.goals, published.venues)
    .venues.map((v) => ({ id: v.id, ...project(v.lng, v.lat), r: 1.3 + Math.sqrt(v.count) * 0.42 }))
    .filter((v) => v.front);
}

export async function GET() {
  const [numerals, serif] = await Promise.all([font("BigShoulders-Black.ttf"), font("InstrumentSerif-Italic.ttf")]);
  const stadiums = lights();
  const total = facts.total.toLocaleString("en-GB");
  const target = facts.target.toLocaleString("en-GB");

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#04060b", color: "#f4efe4", fontFamily: "Big Shoulders" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <defs>
            <radialGradient id="halo" cx="50%" cy="50%" r="50%">
              <stop offset="0.74" stopColor="#f2c14e" stopOpacity="0.2" />
              <stop offset="1" stopColor="#f2c14e" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sea" cx="38%" cy="30%" r="80%">
              <stop offset="0" stopColor="#152036" />
              <stop offset="1" stopColor="#060a13" />
            </radialGradient>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fff1c2" stopOpacity="0.95" />
              <stop offset="0.25" stopColor="#f2c14e" stopOpacity="0.55" />
              <stop offset="1" stopColor="#f2c14e" stopOpacity="0" />
            </radialGradient>
            <clipPath id="disc">
              <circle cx={CX} cy={CY} r={R} />
            </clipPath>
          </defs>
          <circle cx={CX} cy={CY} r={R * 1.3} fill="url(#halo)" />
          <circle cx={CX} cy={CY} r={R} fill="url(#sea)" />
          <g clipPath="url(#disc)">
            <path d={landPath()} fill="#1c2940" stroke="rgba(214,190,138,0.35)" strokeWidth="1" />
            {stadiums.map((v) => (
              <circle key={`g${v.id}`} cx={v.x} cy={v.y} r={v.r * 4.2} fill="url(#glow)" />
            ))}
            {stadiums.map((v) => (
              <circle key={`c${v.id}`} cx={v.x} cy={v.y} r={v.r} fill="#fffaf0" />
            ))}
          </g>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(242,193,78,0.45)" strokeWidth="1.5" />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 72, width: 640, height: "100%" }}>
          <div style={{ fontSize: 24, letterSpacing: 10, color: "#f2c14e", textTransform: "uppercase" }}>{SITE_NAME}</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
            <div style={{ fontSize: 300, lineHeight: 0.95, color: "transparent", backgroundClip: "text", backgroundImage: "linear-gradient(178deg, #fff1c2 8%, #f2c14e 46%, #b9862c 78%, #e9c876 100%)" }}>{total}</div>
          </div>
          <div style={{ fontFamily: "Instrument Serif", fontStyle: "italic", fontSize: 54, marginTop: 4 }}>
            {facts.remaining > 0 ? `${facts.remaining} to go to ${target}` : "One thousand."}
          </div>
          <div style={{ fontSize: 25, letterSpacing: 0.5, marginTop: 26, color: "rgba(244,239,228,0.66)" }}>{TAGLINE}</div>
        </div>
      </div>
    ),
    {
      ...OG_IMAGE,
      fonts: [
        { name: "Big Shoulders", data: numerals, weight: 900, style: "normal" },
        { name: "Instrument Serif", data: serif, weight: 400, style: "italic" },
      ],
    },
  );
}
