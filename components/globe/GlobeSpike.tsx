"use client";

// Throwaway test page: does MapLibre's globe work with a deck.gl overlay, drawn
// from the bundled world outline with no tile server?
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAPLIBRE_WORKER_URL } from "@/lib/vendor.generated";

type Venue = { name: string; lng: number; lat: number; goals: number };

const SAMPLE: Venue[] = [
  { name: "Santiago Bernabéu", lng: -3.6883, lat: 40.4531, goals: 262 },
  { name: "Old Trafford", lng: -2.2913, lat: 53.4631, goals: 84 },
  { name: "Allianz Stadium", lng: 7.6413, lat: 45.1096, goals: 55 },
  { name: "Al-Awwal Park", lng: 46.6235, lat: 24.7289, goals: 68 },
  { name: "Estádio da Luz", lng: -9.1847, lat: 38.7527, goals: 14 },
  { name: "Estádio José Alvalade", lng: -9.1608, lat: 38.7612, goals: 12 },
  { name: "Camp Nou", lng: 2.1228, lat: 41.3809, goals: 12 },
  { name: "Luzhniki", lng: 37.5537, lat: 55.7158, goals: 3 },
  { name: "San Siro", lng: 9.124, lat: 45.4781, goals: 6 },
  { name: "Stadio Olimpico", lng: 12.4547, lat: 41.9341, goals: 6 },
  { name: "Yokohama", lng: 139.6064, lat: 35.5101, goals: 5 },
  { name: "Lusail", lng: 51.4904, lat: 25.4209, goals: 1 },
  { name: "Maracanã", lng: -43.2302, lat: -22.9121, goals: 1 },
  { name: "Emirates", lng: -0.1084, lat: 51.5549, goals: 4 },
  { name: "Mestalla", lng: -0.3583, lat: 39.4746, goals: 9 },
  { name: "Sánchez-Pizjuán", lng: -5.9705, lat: 37.384, goals: 11 },
  { name: "Johannesburg", lng: 27.9825, lat: -26.2348, goals: 1 },
];

export default function GlobeSpike() {
  const el = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    let disposed = false;
    const params = new URLSearchParams(window.location.search);
    const interleaved = params.get("interleaved") !== "0";

    (async () => {
      const ml = await import("maplibre-gl");
      const { MapLibreOverlay } = await import("@deck.gl/maplibre");
            if (disposed || !el.current) return;
      ml.setWorkerUrl(MAPLIBRE_WORKER_URL);

      map = new ml.Map({
        container: el.current,
        center: [Number(params.get("lng") ?? 8), Number(params.get("lat") ?? 36)],
        zoom: Number(params.get("z") ?? 1.7),
        pitch: Number(params.get("pitch") ?? 0),
        attributionControl: false,
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            land: { type: "geojson", data: "/geo/land.json" },
            coast: { type: "geojson", data: "/geo/coast.json" },
            borders: { type: "geojson", data: "/geo/borders.json" },
          },
          sky: {
            "sky-color": "#04060b",
            "horizon-color": "#0d1b33",
            "fog-color": "#04060b",
            "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.35, 5, 0.35, 7, 0],
          },
          layers: [
            { id: "ocean", type: "background", paint: { "background-color": "#050912" } },
            { id: "land", type: "fill", source: "land", paint: { "fill-color": "#0d1626" } },
            { id: "coast", type: "line", source: "coast", paint: { "line-color": "#2b4468", "line-width": 0.7, "line-opacity": 0.9 } },
            { id: "borders", type: "line", source: "borders", paint: { "line-color": "#1b2c47", "line-width": 0.5 } },
          ],
        },
      });

      const { GlowLayer, BeamLayer, ADDITIVE } = await import("./lightLayers");

      // A long tail of small venues so the test resembles the real spread.
      const rnd = (seed: number) => {
        let x = seed;
        return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
      };
      const r = rnd(7);
      const tail: Venue[] = Array.from({ length: 160 }, (_, i) => ({
        name: `v${i}`,
        lng: -9 + r() * 28 + (r() < 0.15 ? 30 + r() * 20 : 0),
        lat: 36 + r() * 19 - (r() < 0.15 ? 12 : 0),
        goals: 1 + Math.floor(r() * r() * 9),
      }));
      const venues = [...SAMPLE, ...tail];

      const overlay = new MapLibreOverlay({
        interleaved,
        layers: [
          new GlowLayer<Venue>({
            id: "halo",
            data: venues,
            getPosition: (d) => [d.lng, d.lat],
            getRadius: (d) => 9 + 5.5 * Math.sqrt(d.goals),
            radiusUnits: "pixels",
            getFillColor: [255, 150, 40, 120],
            stroked: false,
            parameters: ADDITIVE,
          }),
          new BeamLayer<Venue>({
            id: "beams",
            data: venues,
            getPosition: (d) => [d.lng, d.lat],
            getElevation: (d) => 95_000 * Math.sqrt(d.goals),
            radius: 1.6,
            radiusUnits: "pixels",
            diskResolution: 6,
            extruded: true,
            material: false,
            getFillColor: [255, 216, 138, 230],
            parameters: ADDITIVE,
          }),
          new GlowLayer<Venue>({
            id: "core",
            data: venues,
            getPosition: (d) => [d.lng, d.lat],
            getRadius: (d) => 3 + 1.1 * Math.sqrt(d.goals),
            radiusUnits: "pixels",
            getFillColor: [255, 244, 214, 255],
            stroked: false,
            pickable: true,
            parameters: ADDITIVE,
          }),
        ],
      });
      map.addControl(overlay);

      map.on("error", (e) => setStatus(`error: ${e.error?.message ?? "unknown"}`));
      map.once("idle", () => {
        setStatus(`ready (interleaved=${interleaved}, maplibre ${ml.getVersion()})`);
        (window as unknown as { __ready?: boolean }).__ready = true;
      });
    })().catch((err) => setStatus(`error: ${String(err)}`));

    return () => {
      disposed = true;
      map?.remove();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-ink">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div className="pointer-events-none absolute left-4 top-4 font-mono text-xs text-dim" data-status>
        {status}
      </div>
    </div>
  );
}
