// Owns the map and the lights. Plain TypeScript, no React: the interface talks to
// it through a handful of methods and it redraws at most once per frame.
import type { Map as MlMap } from "maplibre-gl";
import type { MapLibreOverlay } from "@deck.gl/maplibre";
import { MAPLIBRE_WORKER_URL } from "@/lib/vendor.generated";
import { TEAMS, type TeamKey } from "@/lib/data/types";
import { countAt, type GoalPoint, type VenueAgg, type World } from "@/lib/data/derive";
import { mapStyle } from "./mapStyle";

export type Hit =
  | { kind: "venue"; venue: VenueAgg; x: number; y: number }
  | { kind: "goal"; point: GoalPoint; x: number; y: number };

export type GlobeEvents = {
  onHover?: (hit: Hit | null) => void;
  onSelect?: (hit: Hit | null) => void;
  onView?: (view: { zoom: number; bloom: number }) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
};

export type GlobeOptions = {
  /** Load street-level tiles for close-up views. */
  detail?: boolean;
  /** Drift slowly when nobody is touching it. */
  spin?: boolean;
};

const GOLD: [number, number, number] = [255, 214, 130];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const TEAM_TINT = Object.fromEntries(
  (Object.keys(TEAMS) as TeamKey[]).map((k) => [k, mix(GOLD, hex(TEAMS[k].color), 0.62)]),
) as Record<TeamKey, [number, number, number]>;

/** Beam height in metres for a ground with `c` goals: 1 goal ≈ 95 km, 260 ≈ 1,500 km. */
const beamHeight = (c: number) => 95_000 * Math.sqrt(c);
const haloRadius = (c: number) => (c > 0 ? 6 + 4.4 * Math.sqrt(c) : 0);
const coreRadius = (c: number) => (c > 0 ? 2.1 + 0.62 * Math.sqrt(c) : 0);

export class GlobeController {
  map!: MlMap;
  private overlay!: MapLibreOverlay;
  private lib!: {
    GlowLayer: typeof import("./lightLayers").GlowLayer;
    BeamLayer: typeof import("./lightLayers").BeamLayer;
    ADDITIVE: typeof import("./lightLayers").ADDITIVE;
    ScatterplotLayer: typeof import("@deck.gl/layers").ScatterplotLayer;
  };
  private world: World;
  private events: GlobeEvents;
  private opts: GlobeOptions;

  private cursor: number;
  private flash = false;
  private intensity = 1;
  private teams: Set<TeamKey> | null = null;
  private visibleNumbers = new Map<string, number[]>();
  private focusGoal: number | null = null;
  private focusVenue: string | null = null;
  private hoverGoal: number | null = null;
  private hoverVenue: string | null = null;

  private raf = 0;
  private dirty = true;
  private disposed = false;
  private lastTouch = 0;
  private spinning: boolean;
  private positionsKey = -1;

  private constructor(world: World, events: GlobeEvents, opts: GlobeOptions) {
    this.world = world;
    this.events = events;
    this.opts = opts;
    this.cursor = world.total;
    this.spinning = Boolean(opts.spin);
    this.rebuildVisible();
  }

  static async create(container: HTMLElement, world: World, events: GlobeEvents = {}, opts: GlobeOptions = {}): Promise<GlobeController> {
    const self = new GlobeController(world, events, opts);
    const [ml, deckMl, layers, light] = await Promise.all([
      import("maplibre-gl"),
      import("@deck.gl/maplibre"),
      import("@deck.gl/layers"),
      import("./lightLayers"),
    ]);
    self.lib = { GlowLayer: light.GlowLayer, BeamLayer: light.BeamLayer, ADDITIVE: light.ADDITIVE, ScatterplotLayer: layers.ScatterplotLayer };
    ml.setWorkerUrl(MAPLIBRE_WORKER_URL);

    const home = self.homeView(container);
    self.map = new ml.Map({
      container,
      style: mapStyle({ detail: opts.detail !== false }),
      center: home.center,
      zoom: home.zoom,
      pitch: 0,
      minZoom: 0.6,
      maxZoom: 17.2,
      maxPitch: 72,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 250,
    });
    self.map.on("error", (e) => events.onError?.(e.error?.message ?? "map error"));

    self.overlay = new deckMl.MapLibreOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      getCursor: ({ isHovering }: { isHovering: boolean }) => (isHovering ? "pointer" : "grab"),
      onHover: (info: { object?: unknown; layer?: { id: string } | null; x: number; y: number }) => self.handlePick(info, false),
      onClick: (info: { object?: unknown; layer?: { id: string } | null; x: number; y: number }) => self.handlePick(info, true),
    });
    self.map.addControl(self.overlay);

    const touch = () => {
      self.lastTouch = performance.now();
    };
    for (const ev of ["mousedown", "wheel", "touchstart", "dragstart", "zoomstart"] as const) self.map.on(ev, touch);
    self.map.on("move", () => {
      self.dirty = true;
      const zoom = self.map.getZoom();
      events.onView?.({ zoom, bloom: self.bloomAt(zoom) });
    });
    self.map.once("idle", () => events.onReady?.());

    const loop = () => {
      if (self.disposed) return;
      self.tick();
      self.raf = requestAnimationFrame(loop);
    };
    self.raf = requestAnimationFrame(loop);
    return self;
  }

  // ---------- what the interface can ask for ----------

  /** Show the career as it stood after `n` goals (fractions allowed while animating). */
  setCursor(n: number, opts: { flash?: boolean } = {}) {
    this.cursor = n;
    this.flash = Boolean(opts.flash);
    this.dirty = true;
  }

  /** Limit the lights to some teams, or pass null for all. */
  setTeams(teams: TeamKey[] | null) {
    this.teams = teams && teams.length ? new Set(teams) : null;
    this.rebuildVisible();
    this.dirty = true;
  }

  /** Overall brightness, for the celebration. 1 is normal. */
  setIntensity(x: number) {
    this.intensity = x;
    this.dirty = true;
  }

  setFocus(focus: { venue?: string | null; goal?: number | null }) {
    this.focusVenue = focus.venue ?? null;
    this.focusGoal = focus.goal ?? null;
    this.dirty = true;
  }

  setSpin(on: boolean) {
    this.spinning = on;
  }

  flyHome(duration = 2600) {
    const home = this.homeView(this.map.getContainer());
    this.map.flyTo({ center: home.center, zoom: home.zoom, pitch: 0, bearing: 0, duration, essential: true });
  }

  flyToVenue(venueId: string, duration = 4200) {
    const v = this.world.venueById.get(venueId);
    if (!v) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const spiral = 46 * Math.sqrt(v.count) + 140; // metres from centre to the outermost goal, plus air
    const metresPerPixel = (2 * spiral) / (0.62 * Math.min(box.width, box.height));
    const zoom = Math.min(16.4, Math.max(12.8, Math.log2((78271.5 * Math.cos((v.lat * Math.PI) / 180)) / metresPerPixel)));
    this.lastTouch = performance.now();
    this.map.flyTo({ center: [v.lng, v.lat], zoom, pitch: 46, bearing: -18, duration, essential: true, curve: 1.5 });
  }

  /** Where a point on the Earth currently sits on screen. */
  screenPosition(lng: number, lat: number): { x: number; y: number } {
    const p = this.map.project([lng, lat]);
    return { x: p.x, y: p.y };
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    try {
      this.overlay.finalize();
    } catch {
      /* already gone */
    }
    this.map?.remove();
  }

  // ---------- internals ----------

  private homeView(container: HTMLElement): { center: [number, number]; zoom: number } {
    const box = container.getBoundingClientRect();
    const narrow = box.width < 720;
    const diameter = (narrow ? 1.18 : 0.94) * Math.min(box.width, box.height);
    return { center: narrow ? [6, 34] : [14, 30], zoom: Math.log2((diameter * Math.PI) / 512) };
  }

  private bloomAt(zoom: number) {
    return smooth(6.8, 10.6, zoom);
  }

  private rebuildVisible() {
    this.visibleNumbers.clear();
    for (const v of this.world.venues) {
      this.visibleNumbers.set(v.id, this.teams ? v.goals.filter((g) => this.teams!.has(g.team)).map((g) => g.n) : v.numbers);
    }
  }

  private litCount(v: VenueAgg): number {
    if (!this.teams) return countAt(v, this.cursor);
    const a = this.visibleNumbers.get(v.id)!;
    let n = 0;
    while (n < a.length && a[n] <= this.cursor) n++;
    return n;
  }

  /** 1 just after a venue's latest goal appears, falling to 0 a few goals later. Only while playing. */
  private flashOf(v: VenueAgg, lit: number): number {
    if (!this.flash || lit === 0) return 0;
    const a = this.visibleNumbers.get(v.id)!;
    return Math.max(0, 1 - (this.cursor - a[lit - 1]) / 5);
  }

  private handlePick(info: { object?: unknown; layer?: { id: string } | null; x: number; y: number }, click: boolean) {
    let hit: Hit | null = null;
    const id = info.layer?.id;
    if (info.object && id === "venue-hit") hit = { kind: "venue", venue: info.object as VenueAgg, x: info.x, y: info.y };
    else if (info.object && id === "goal-hit") hit = { kind: "goal", point: info.object as GoalPoint, x: info.x, y: info.y };
    if (click) {
      this.lastTouch = performance.now();
      this.events.onSelect?.(hit);
      return;
    }
    const venueId = hit?.kind === "venue" ? hit.venue.id : null;
    const goalN = hit?.kind === "goal" ? hit.point.goal.n : null;
    if (venueId !== this.hoverVenue || goalN !== this.hoverGoal) {
      this.hoverVenue = venueId;
      this.hoverGoal = goalN;
      this.dirty = true;
    }
    this.events.onHover?.(hit);
  }

  private tick() {
    const idle = performance.now() - this.lastTouch > 7000;
    if (this.spinning && idle && !this.map.isMoving() && this.map.getZoom() < 3.4 && this.hoverVenue === null) {
      const c = this.map.getCenter();
      this.map.jumpTo({ center: [c.lng - 0.035, c.lat] });
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.overlay.setProps({ layers: this.buildLayers() });
  }

  private buildLayers() {
    const { GlowLayer, BeamLayer, ADDITIVE, ScatterplotLayer } = this.lib;
    const { venues, points } = this.world;
    const zoom = this.map.getZoom();
    const bloom = this.bloomAt(zoom);
    const far = 1 - smooth(5.2, 9.2, zoom); // venue-level marks fade out as the goals take over
    const k = this.intensity;
    const cursor = this.cursor;
    const stamp = `${cursor.toFixed(2)}|${this.flash}|${this.teams ? [...this.teams].join(",") : "all"}`;
    const hoverStamp = `${this.hoverVenue}|${this.focusVenue}`;
    const zoomScale = Math.min(1.5, Math.max(0.5, 0.5 + 0.2 * (zoom - 1)));
    const layers: unknown[] = [];

    if (far > 0.01) {
      layers.push(
        new GlowLayer<VenueAgg>({
          id: "venue-halo",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => {
            const lit = this.litCount(v);
            const boost = v.id === this.hoverVenue || v.id === this.focusVenue ? 1.35 : 1;
            return haloRadius(lit) * (1 + 0.9 * this.flashOf(v, lit)) * boost;
          },
          radiusUnits: "pixels",
          radiusScale: zoomScale,
          getFillColor: [255, 150, 44, 105],
          stroked: false,
          opacity: Math.min(1, far * k),
          parameters: ADDITIVE,
          updateTriggers: { getRadius: [stamp, hoverStamp] },
        }),
        new BeamLayer<VenueAgg>({
          id: "venue-beam",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getElevation: (v) => beamHeight(this.litCount(v)),
          radius: 1.5,
          radiusUnits: "pixels",
          diskResolution: 6,
          extruded: true,
          material: false,
          getFillColor: (v) => {
            const lit = this.litCount(v);
            return [...GOLD, lit > 0 ? Math.min(255, 150 + 9 * Math.sqrt(lit)) : 0] as [number, number, number, number];
          },
          opacity: Math.min(1, far * far * k),
          parameters: ADDITIVE,
          updateTriggers: { getElevation: stamp, getFillColor: stamp },
        }),
        new GlowLayer<VenueAgg>({
          id: "venue-core",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => {
            const lit = this.litCount(v);
            return coreRadius(lit) * (1 + 1.4 * this.flashOf(v, lit));
          },
          radiusUnits: "pixels",
          radiusScale: zoomScale * 1.9,
          getFillColor: [255, 243, 214, 255],
          stroked: false,
          opacity: Math.min(1, far * k),
          parameters: ADDITIVE,
          updateTriggers: { getRadius: stamp },
        }),
      );
    }

    if (bloom > 0.01) {
      const ease = bloom * bloom * (3 - 2 * bloom);
      const posKey = Math.round(ease * 400);
      this.positionsKey = posKey;
      const pos = (p: GoalPoint): [number, number] => [p.home[0] + (p.slot[0] - p.home[0]) * ease, p.home[1] + (p.slot[1] - p.home[1]) * ease];
      const shown = (p: GoalPoint) => p.goal.n <= cursor && (!this.teams || this.teams.has(p.goal.team));
      const dotScale = Math.min(1.25, Math.max(0.42, 0.42 + 0.19 * (zoom - 10.5)));
      const hot = `${this.hoverGoal}|${this.focusGoal}`;
      layers.push(
        new GlowLayer<GoalPoint>({
          id: "goal-glow",
          data: points,
          getPosition: pos,
          getRadius: (p) => (shown(p) ? (p.goal.n === this.hoverGoal || p.goal.n === this.focusGoal ? 30 : 15) : 0),
          radiusUnits: "pixels",
          radiusScale: dotScale,
          getFillColor: (p) => [...TEAM_TINT[p.goal.team], 150] as [number, number, number, number],
          stroked: false,
          opacity: bloom * Math.min(1, k),
          parameters: ADDITIVE,
          updateTriggers: { getPosition: posKey, getRadius: [stamp, hot] },
        }),
        new ScatterplotLayer<GoalPoint>({
          id: "goal-core",
          data: points,
          getPosition: pos,
          getRadius: (p) => (shown(p) ? (p.goal.n === this.hoverGoal || p.goal.n === this.focusGoal ? 6.2 : 4.1) : 0),
          radiusUnits: "pixels",
          radiusScale: dotScale,
          getFillColor: (p) =>
            (p.goal.n === this.hoverGoal || p.goal.n === this.focusGoal ? [255, 255, 255, 255] : [...mix(TEAM_TINT[p.goal.team], [255, 250, 235], 0.35), 245]) as [number, number, number, number],
          stroked: true,
          getLineColor: (p) => [...TEAM_TINT[p.goal.team], 255] as [number, number, number, number],
          getLineWidth: (p) => (p.goal.penalty ? 0 : 1.1),
          lineWidthUnits: "pixels",
          opacity: bloom,
          updateTriggers: { getPosition: posKey, getRadius: [stamp, hot], getFillColor: hot },
        }),
      );
    }

    // Invisible, generous targets so small lights are easy to hover and tap.
    if (bloom < 0.5) {
      layers.push(
        new ScatterplotLayer<VenueAgg>({
          id: "venue-hit",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => (this.litCount(v) > 0 ? Math.max(11, coreRadius(v.count) * 2.6 * zoomScale) : 0),
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          pickable: true,
          updateTriggers: { getRadius: [stamp, Math.round(zoomScale * 20)] },
        }),
      );
    } else {
      const ease = bloom * bloom * (3 - 2 * bloom);
      layers.push(
        new ScatterplotLayer<GoalPoint>({
          id: "goal-hit",
          data: points,
          getPosition: (p) => [p.home[0] + (p.slot[0] - p.home[0]) * ease, p.home[1] + (p.slot[1] - p.home[1]) * ease],
          getRadius: (p) => (p.goal.n <= cursor && (!this.teams || this.teams.has(p.goal.team)) ? 11 : 0),
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          pickable: true,
          updateTriggers: { getPosition: this.positionsKey, getRadius: stamp },
        }),
      );
    }
    return layers as never[];
  }
}
