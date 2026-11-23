// The look of the Earth itself.
// Far out it is drawn only from the outline shipped with the site. Street-level
// detail from OpenFreeMap fades in when someone zooms in close to a stadium.
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

const C = {
  space: "#04060b",
  ocean: "#050913",
  land: "#0b1321",
  coast: "#2a4266",
  border: "#16243b",
  graticule: "#101c30",
  water: "#03060d",
  road: "#1b2940",
  roadMajor: "#263a5a",
  building: "#0f192a",
  pitch: "#143a2c",
  stadium: "#3a2f14",
  label: "#8fa3c2",
};

const DETAIL_FROM = 6;

/** Thin lines every 15°, so the globe reads as an instrument rather than a blob. */
function graticule(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lng = -180; lng < 180; lng += 15) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 4) coords.push([lng, lat]);
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const coords: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 4) coords.push([lng, lat]);
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
  }
  return { type: "FeatureCollection", features };
}

/** The Earth as drawn from the bundled outline. Makes no requests to anyone else. */
export function mapStyle(): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      land: { type: "geojson", data: "/geo/land.json" },
      coast: { type: "geojson", data: "/geo/coast.json" },
      borders: { type: "geojson", data: "/geo/borders.json" },
      graticule: { type: "geojson", data: graticule() },
    },
    sky: {
      "sky-color": C.space,
      "horizon-color": "#0c1a31",
      "fog-color": C.space,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.9,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.42, 4, 0.3, 6.5, 0],
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": C.ocean } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        maxzoom: 5,
        paint: { "line-color": C.graticule, "line-width": 0.6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 4, 0.5, 5, 0] },
      },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": C.land, "fill-antialias": true } },
      {
        id: "coast-glow",
        type: "line",
        source: "coast",
        paint: { "line-color": "#3d6aa8", "line-width": 3.5, "line-blur": 4, "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.22, 6, 0.12, 9, 0] },
      },
      {
        id: "coast",
        type: "line",
        source: "coast",
        paint: { "line-color": C.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 0.9, 9, 1.2], "line-opacity": 0.85 },
      },
      {
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": C.border, "line-width": 0.6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 4, 0.9] },
      },
    ],
  };
  return style;
}

const fadeIn = (from: number, to: number, max = 1): ["interpolate", ["linear"], ["zoom"], number, number, number, number] => [
  "interpolate",
  ["linear"],
  ["zoom"],
  from,
  0,
  to,
  max,
];

/** Zoom at which street-level detail starts to matter; the source is only added once the view gets here. */
export const DETAIL_ZOOM = 4.8;
export const DETAIL_SOURCE = { type: "vector", url: "https://tiles.openfreemap.org/planet", minzoom: 0, maxzoom: 14 } as const;

/** Streets, buildings, pitches and place names for close-up views (OpenFreeMap, © OpenStreetMap contributors). */
export function detailLayers(): LayerSpecification[] {
  return [
      { id: "d-water", type: "fill", source: "streets", "source-layer": "water", minzoom: DETAIL_FROM, paint: { "fill-color": C.water, "fill-opacity": fadeIn(6, 8) } },
      {
        id: "d-park",
        type: "fill",
        source: "streets",
        "source-layer": "park",
        minzoom: 9,
        paint: { "fill-color": "#0a1a1c", "fill-opacity": fadeIn(9, 12, 0.7) },
      },
      {
        id: "d-roads-minor",
        type: "line",
        source: "streets",
        "source-layer": "transportation",
        minzoom: 11,
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary", "secondary"]]],
        paint: { "line-color": C.road, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.3, 16, 4], "line-opacity": fadeIn(11, 13, 0.9) },
      },
      {
        id: "d-roads-major",
        type: "line",
        source: "streets",
        "source-layer": "transportation",
        minzoom: DETAIL_FROM,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": C.roadMajor, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 0.3, 12, 1.4, 16, 7], "line-opacity": fadeIn(6.5, 9, 0.8) },
      },
      {
        id: "d-buildings",
        type: "fill",
        source: "streets",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": C.building, "fill-outline-color": "#1a2942", "fill-opacity": fadeIn(13, 14.5, 0.9) },
      },
      {
        id: "d-stadium",
        type: "fill",
        source: "streets",
        "source-layer": "landuse",
        minzoom: 11,
        filter: ["==", ["get", "class"], "stadium"],
        paint: { "fill-color": C.stadium, "fill-opacity": fadeIn(11, 13, 0.55) },
      },
      {
        id: "d-pitch",
        type: "fill",
        source: "streets",
        "source-layer": "landuse",
        minzoom: 12,
        filter: ["==", ["get", "class"], "pitch"],
        paint: { "fill-color": C.pitch, "fill-outline-color": "#2f7a5a", "fill-opacity": fadeIn(12, 14, 0.9) },
      },
      {
        id: "d-places",
        type: "symbol",
        source: "streets",
        "source-layer": "place",
        minzoom: 5,
        maxzoom: 13,
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 14],
          "text-letter-spacing": 0.12,
          "text-transform": "uppercase",
          "text-max-width": 8,
        },
        paint: { "text-color": C.label, "text-halo-color": C.space, "text-halo-width": 1.4, "text-opacity": fadeIn(5.5, 7, 0.75) },
      },
  ];
}
