// Owns the map and the lights. Plain TypeScript, no React: the interface talks to
// it through a handful of methods and it redraws at most once per frame.
import type { Map as MlMap } from "maplibre-gl";
import type { MapLibreOverlay } from "@deck.gl/maplibre";
import { MAPLIBRE_WORKER_URL } from "@/lib/vendor.generated";
import { TEAMS, type TeamKey } from "@/lib/data/types";
import { countAt, type GoalPoint, type VenueAgg, type World } from "@/lib/data/derive";
import { DETAIL_SOURCE, DETAIL_ZOOM, detailLayers, mapStyle } from "./mapStyle";

export type Hit =
  | { kind: "venue"; venue: VenueAgg; x: number; y: number }
  | { kind: "goal"; point: GoalPoint; x: number; y: number };

export type GlobeEvents = {
  onHover?: (hit: Hit | null) => void;
  onSelect?: (hit: Hit | null) => void;
  onView?: (view: { zoom: number; bloom: number; horizon: { x: number; y: number } | null }) => void;
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
const haloRadius = (c: number) => (c > 0 ? 7 + 5.6 * Math.sqrt(c) : 0);
const coreRadius = (c: number) => (c > 0 ? 2.1 + 0.62 * Math.sqrt(c) : 0);

export class GlobeController {
  map!: MlMap;
  private overlay!: MapLibreOverlay;
  private lib!: {
    GlowLayer: typeof import("./lightLayers").GlowLayer;
    BeamLayer: typeof import("./lightLayers").BeamLayer;
    ADDITIVE: typeof import("./lightLayers").ADDITIVE;
    ON_TOP: typeof import("./lightLayers").ADDITIVE_ON_TOP;
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
  private detailAdded = false;
  private hitOrder: VenueAgg[] = [];
  private majorVenues: VenueAgg[] = [];
  private giantVenues: VenueAgg[] = [];
  /** Goals that have just arrived, and the stadiums they were scored at: these throb for a while. */
  private pulseGoals = new Set<number>();
  private pulseVenues = new Set<string>();
  private pulseFrom = 0;
  private pulseUntil = 0;

  private constructor(world: World, events: GlobeEvents, opts: GlobeOptions) {
    this.world = world;
    this.events = events;
    this.opts = opts;
    this.cursor = world.total;
    this.spinning = Boolean(opts.spin);
    this.indexWorld();
  }

  private indexWorld() {
    const { venues } = this.world;
    this.hitOrder = [...venues].reverse();
    this.majorVenues = venues.filter((v) => v.count >= 20);
    this.giantVenues = venues.filter((v) => v.count >= 80);
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
    self.lib = {
      GlowLayer: light.GlowLayer,
      BeamLayer: light.BeamLayer,
      ADDITIVE: light.ADDITIVE,
      ON_TOP: light.ADDITIVE_ON_TOP,
      ScatterplotLayer: layers.ScatterplotLayer,
    };
    ml.setWorkerUrl(MAPLIBRE_WORKER_URL);

    const home = self.homeView(container);
    self.map = new ml.Map({
      container,
      style: mapStyle(),
      center: home.center,
      zoom: home.zoom,
      pitch: home.pitch,
      minZoom: 0.6,
      maxZoom: 17.2,
      maxPitch: 72,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 250,
    });
    self.map.setPadding(home.padding);
    // A failed tile is not worth alarming anyone over: the lights do not depend on it.
    self.map.on("error", (e) => console.warn("map:", e.error?.message ?? e));

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
      if (zoom > DETAIL_ZOOM) self.ensureDetail();
      events.onView?.({ zoom, bloom: self.bloomAt(zoom), horizon: self.horizonTop() });
    });
    self.map.on("moveend", () => {
      const zoom = self.map.getZoom();
      events.onView?.({ zoom, bloom: self.bloomAt(zoom), horizon: self.horizonTop() });
    });
    self.map.once("idle", () => {
      const zoom = self.map.getZoom();
      events.onView?.({ zoom, bloom: self.bloomAt(zoom), horizon: self.horizonTop() });
      events.onReady?.();
    });

    const loop = () => {
      if (self.disposed) return;
      self.tick();
      self.raf = requestAnimationFrame(loop);
    };
    self.raf = requestAnimationFrame(loop);
    return self;
  }

  // ---------- what the interface can ask for ----------

  /** Swap in a newer dataset (a goal has been added) without rebuilding the map. */
  setWorld(world: World) {
    if (world === this.world) return;
    this.world = world;
    this.hoverVenue = null;
    this.hoverGoal = null;
    this.indexWorld();
    this.dirty = true;
  }

  /** Make these goals, and the stadiums they were scored at, throb for a while. */
  pulse(goalNumbers: number[], ms = 9000) {
    this.pulseGoals = new Set(goalNumbers);
    this.pulseVenues = new Set(goalNumbers.map((n) => this.world.pointByN.get(n)?.venue.id).filter((id): id is string => Boolean(id)));
    this.pulseFrom = performance.now();
    this.pulseUntil = this.pulseFrom + ms;
    this.dirty = true;
  }

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
    this.map.flyTo({ center: home.center, zoom: home.zoom, pitch: home.pitch, bearing: 0, padding: home.padding, duration, essential: true });
  }

  flyToVenue(venueId: string, duration = 4200) {
    const v = this.world.venueById.get(venueId);
    if (!v) return;
    const box = this.map.getContainer().getBoundingClientRect();
    const spiral = 46 * Math.sqrt(v.count) + 140; // metres from centre to the outermost goal, plus air
    const metresPerPixel = (2 * spiral) / (0.62 * Math.min(box.width, box.height));
    const zoom = Math.min(16.4, Math.max(12.8, Math.log2((78271.5 * Math.cos((v.lat * Math.PI) / 180)) / metresPerPixel)));
    this.lastTouch = performance.now();
    this.map.flyTo({ center: [v.lng, v.lat], zoom, pitch: 46, bearing: -18, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration, essential: true, curve: 1.5 });
  }

  /**
   * Where the Earth's edge meets the sky at the top of the view, on screen; null once
   * the view is too close for there to be a horizon. Found by walking from the centre
   * of the view towards the far edge until the ground drops out of sight.
   */
  horizonTop(): { x: number; y: number } | null {
    if (this.map.getZoom() > 6.2) return null;
    const rad = Math.PI / 180;
    const seen = this.visibility();
    const c = this.map.getCenter();
    const bearing = this.map.getBearing() * rad;
    const lat1 = c.lat * rad;
    let last: [number, number] | null = null;
    for (let deg = 0; deg <= 90; deg += 0.5) {
      const d = deg * rad;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
      const lng2 = c.lng * rad + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      if (seen(lng2 / rad, lat2 / rad) <= 0) break;
      last = [lng2 / rad, lat2 / rad];
    }
    if (!last) return null;
    const p = this.map.project(last);
    return { x: p.x, y: p.y };
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

  /**
   * The opening view: tilted, so the horizon crosses the screen and the beams rise into
   * space. The globe is sized to span the width on wide screens and to fill the lower
   * part of tall ones.
   */
  private homeView(container: HTMLElement): { center: [number, number]; zoom: number; pitch: number; padding: { top: number; bottom: number; left: number; right: number } } {
    const box = container.getBoundingClientRect();
    if (box.width < 720) {
      // Tall screens: a smaller Earth, lifted clear of the timeline, so Madrid and Riyadh both stay in frame.
      return { center: [19, 33], zoom: Math.log2((1.75 * box.width * Math.PI) / 512), pitch: 32, padding: { top: 0, bottom: 0.2 * box.height, left: 0, right: 0 } };
    }
    const diameter = Math.max(0.97 * box.width, 1.12 * box.height);
    return { center: [15, 39], zoom: Math.log2((diameter * Math.PI) / 512), pitch: 45, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
  }

  /**
   * How visible a point on the Earth is from the camera: 1 on the near side, falling to
   * 0 at the horizon and beyond. Close in, the map is flat and everything is visible.
   */
  private visibility(): (lng: number, lat: number) => number {
    const zoom = this.map.getZoom();
    if (zoom > 6.2) return () => 1;
    const rad = Math.PI / 180;
    const c = this.map.getCenter();
    const phi = c.lat * rad;
    const lam = c.lng * rad;
    const pitch = this.map.getPitch() * rad;
    const bearing = this.map.getBearing() * rad;
    const h = this.map.getContainer().clientHeight || 800;
    // Globe radius in pixels (MapLibre matches Mercator's scale at the centre latitude),
    // and the camera's distance from the centre point in globe radii.
    const radiusPx = (512 * Math.pow(2, zoom)) / (2 * Math.PI * Math.cos(phi));
    const dist = (1.5 * h) / radiusPx;
    const s = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
    const north = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
    const east = [-Math.sin(lam), Math.cos(lam), 0];
    const cam = [0, 1, 2].map((i) => {
      const forward = Math.cos(bearing) * north[i] + Math.sin(bearing) * east[i];
      return s[i] + dist * (Math.cos(pitch) * s[i] - Math.sin(pitch) * forward);
    });
    return (lng, lat) => {
      const a = lat * rad;
      const b = lng * rad;
      const dot = cam[0] * Math.cos(a) * Math.cos(b) + cam[1] * Math.cos(a) * Math.sin(b) + cam[2] * Math.sin(a);
      return Math.min(1, Math.max(0, (dot - 1) / 0.035));
    };
  }

  /**
   * Street-level tiles come from a third party, so they are only asked for once someone
   * zooms in. The opening view and the celebration never touch them.
   */
  private ensureDetail() {
    if (this.detailAdded || this.opts.detail === false || !this.map.isStyleLoaded()) return;
    this.detailAdded = true;
    this.map.addSource("streets", DETAIL_SOURCE);
    // The lights are custom layers on the same map; streets must go underneath them.
    const firstLight = this.map.getLayersOrder().find((id) => this.map.getLayer(id)?.type === "custom");
    for (const layer of detailLayers()) this.map.addLayer(layer, firstLight);
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

  /** 0 at rest; while a pulse runs, a slow throb that dies away. */
  private pulseNow(): number {
    const now = performance.now();
    if (now >= this.pulseUntil) return 0;
    const left = 1 - (now - this.pulseFrom) / (this.pulseUntil - this.pulseFrom);
    return left * (0.55 + 0.45 * Math.sin((now - this.pulseFrom) / 190));
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
    if (this.pulseUntil) {
      // Redraw every frame while something throbs, then once more to settle.
      this.dirty = true;
      if (performance.now() >= this.pulseUntil) {
        this.pulseUntil = 0;
        this.pulseGoals.clear();
        this.pulseVenues.clear();
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.overlay.setProps({ layers: this.buildLayers() });
  }

  private buildLayers() {
    const { GlowLayer, BeamLayer, ADDITIVE, ON_TOP, ScatterplotLayer } = this.lib;
    const { venues, points } = this.world;
    const zoom = this.map.getZoom();
    const bloom = this.bloomAt(zoom);
    const far = 1 - smooth(5.2, 9.2, zoom); // venue-level marks fade out as the goals take over
    const k = this.intensity;
    const cursor = this.cursor;
    const seen = this.visibility();
    const c = this.map.getCenter();
    const stamp = `${cursor.toFixed(2)}|${this.flash}|${this.teams ? [...this.teams].join(",") : "all"}`;
    const hoverStamp = `${this.hoverVenue}|${this.focusVenue}`;
    const throb = this.pulseNow();
    const throbStamp = this.pulseUntil ? Math.round(throb * 200) : 0;
    const throbbing = (v: VenueAgg) => (this.pulseVenues.has(v.id) ? throb : 0);
    // Which lights are over the horizon changes as the Earth turns.
    const viewStamp = zoom > 6.2 ? "flat" : `${c.lng.toFixed(1)}|${c.lat.toFixed(1)}|${zoom.toFixed(1)}|${this.map.getPitch().toFixed(0)}|${this.map.getBearing().toFixed(0)}`;
    const zoomScale = Math.min(1.5, Math.max(0.55, 0.42 + 0.18 * zoom));
    const layers: unknown[] = [];

    if (far > 0.01) {
      const beam = (id: string, data: VenueAgg[], radius: number, alpha: number) =>
        new BeamLayer<VenueAgg>({
          id,
          data,
          getPosition: (v) => [v.lng, v.lat],
          getElevation: (v) => beamHeight(this.litCount(v)),
          radius,
          radiusUnits: "pixels",
          diskResolution: 8,
          extruded: true,
          material: false,
          getFillColor: (v) => [...GOLD, this.litCount(v) > 0 ? alpha : 0] as [number, number, number, number],
          opacity: Math.min(1, far * far * k),
          parameters: ADDITIVE,
          updateTriggers: { getElevation: stamp, getFillColor: stamp },
        });
      layers.push(
        new GlowLayer<VenueAgg>({
          id: "venue-halo",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => {
            const lit = this.litCount(v);
            const boost = v.id === this.hoverVenue || v.id === this.focusVenue ? 1.4 : 1;
            return haloRadius(lit) * (1 + 0.9 * this.flashOf(v, lit) + 2.4 * throbbing(v)) * boost * seen(v.lng, v.lat);
          },
          radiusUnits: "pixels",
          radiusScale: zoomScale,
          billboard: true,
          getFillColor: [255, 146, 40, 88],
          stroked: false,
          opacity: Math.min(1, far * k),
          parameters: ON_TOP,
          updateTriggers: { getRadius: [stamp, hoverStamp, viewStamp, throbStamp] },
        }),
        // Thin beams everywhere; thicker ones mark the grounds where he scored most.
        beam("venue-beam", venues, 1.3, 215),
        beam("venue-beam-major", this.majorVenues, 2.5, 190),
        beam("venue-beam-giant", this.giantVenues, 4.2, 170),
        new GlowLayer<VenueAgg>({
          id: "venue-core",
          data: venues,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => {
            const lit = this.litCount(v);
            return coreRadius(lit) * (1 + 1.4 * this.flashOf(v, lit) + 1.5 * throbbing(v)) * seen(v.lng, v.lat);
          },
          radiusUnits: "pixels",
          radiusScale: zoomScale * 1.9,
          billboard: true,
          getFillColor: [255, 243, 214, 255],
          stroked: false,
          opacity: Math.min(1, far * k),
          parameters: ON_TOP,
          updateTriggers: { getRadius: [stamp, viewStamp, throbStamp] },
        }),
      );
    }

    const ease = bloom * bloom * (3 - 2 * bloom);
    const posKey = Math.round(ease * 400);
    const pos = (p: GoalPoint): [number, number] => [p.home[0] + (p.slot[0] - p.home[0]) * ease, p.home[1] + (p.slot[1] - p.home[1]) * ease];
    const shown = (p: GoalPoint) => p.goal.n <= cursor && (!this.teams || this.teams.has(p.goal.team));
    const arriving = (p: GoalPoint) => (this.pulseGoals.has(p.goal.n) ? throb : 0);
    const hotGoal = (p: GoalPoint) => p.goal.n === this.hoverGoal || p.goal.n === this.focusGoal || this.pulseGoals.has(p.goal.n);

    if (bloom > 0.01) {
      const dotScale = Math.min(1.25, Math.max(0.42, 0.42 + 0.19 * (zoom - 10.5)));
      const hot = `${this.hoverGoal}|${this.focusGoal}|${throbStamp}|${this.pulseGoals.size}`;
      layers.push(
        new GlowLayer<GoalPoint>({
          id: "goal-glow",
          data: points,
          getPosition: pos,
          getRadius: (p) => (shown(p) ? (hotGoal(p) ? 34 + 46 * arriving(p) : 16) : 0),
          radiusUnits: "pixels",
          radiusScale: dotScale,
          billboard: true,
          getFillColor: (p) => [...TEAM_TINT[p.goal.team], hotGoal(p) ? 220 : 150] as [number, number, number, number],
          stroked: false,
          opacity: bloom * Math.min(1, k),
          parameters: ON_TOP,
          updateTriggers: { getPosition: posKey, getRadius: [stamp, hot], getFillColor: hot },
        }),
        new ScatterplotLayer<GoalPoint>({
          id: "goal-core",
          data: points,
          getPosition: pos,
          getRadius: (p) => (shown(p) ? (hotGoal(p) ? 6.4 : 4.1) : 0),
          radiusUnits: "pixels",
          radiusScale: dotScale,
          billboard: true,
          getFillColor: (p) => (hotGoal(p) ? [255, 255, 255, 255] : [...mix(TEAM_TINT[p.goal.team], [255, 250, 235], 0.35), 245]) as [number, number, number, number],
          stroked: true,
          getLineColor: (p) => [...TEAM_TINT[p.goal.team], 255] as [number, number, number, number],
          getLineWidth: 1.1,
          lineWidthUnits: "pixels",
          opacity: bloom,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          updateTriggers: { getPosition: posKey, getRadius: [stamp, hot], getFillColor: hot },
        }),
      );
    }

    // Invisible, generous targets so small lights are easy to hover and tap.
    if (bloom < 0.5) {
      layers.push(
        new ScatterplotLayer<VenueAgg>({
          id: "venue-hit",
          // Smallest first, so where lights overlap from far away the biggest ground wins the pointer.
          data: this.hitOrder,
          getPosition: (v) => [v.lng, v.lat],
          getRadius: (v) => (this.litCount(v) > 0 && seen(v.lng, v.lat) > 0.2 ? Math.max(11, coreRadius(v.count) * 2.6 * zoomScale) : 0),
          radiusUnits: "pixels",
          billboard: true,
          getFillColor: [0, 0, 0, 0],
          pickable: true,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          updateTriggers: { getRadius: [stamp, viewStamp] },
        }),
      );
    } else {
      layers.push(
        new ScatterplotLayer<GoalPoint>({
          id: "goal-hit",
          data: points,
          getPosition: pos,
          getRadius: (p) => (shown(p) ? 11 : 0),
          radiusUnits: "pixels",
          billboard: true,
          getFillColor: [0, 0, 0, 0],
          pickable: true,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
          updateTriggers: { getPosition: posKey, getRadius: stamp },
        }),
      );
    }
    return layers as never[];
  }
}
