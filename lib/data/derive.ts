// Shapes the raw dataset into what the globe and the interface draw from.
import type { Goal, TeamKey, Venue } from "./types";

export type VenueAgg = Venue & {
  goals: Goal[];
  /** Career goal numbers scored here, ascending. Used to count "goals here so far" quickly. */
  numbers: number[];
  count: number;
  first: Goal;
  last: Goal;
  /** The team he scored most for at this ground. */
  mainTeam: TeamKey;
};

export type GoalPoint = {
  goal: Goal;
  venue: VenueAgg;
  /** The stadium itself. */
  home: [number, number];
  /** This goal's own place in the spiral around the stadium. */
  slot: [number, number];
};

export type World = {
  goals: Goal[];
  venues: VenueAgg[];
  points: GoalPoint[];
  venueById: Map<string, VenueAgg>;
  pointByN: Map<number, GoalPoint>;
  total: number;
};

/** Metres between neighbouring goals in a stadium's spiral. */
const SPIRAL_STEP_M = 46;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * A sunflower spiral: the k-th goal sits at angle k × 137.5° and radius ∝ √k, so
 * any number of goals packs evenly with no two on top of each other.
 */
function spiralSlot(lng: number, lat: number, k: number, count: number): [number, number] {
  if (count === 1) return [lng, lat];
  const r = SPIRAL_STEP_M * Math.sqrt(k + 0.6);
  const a = k * GOLDEN_ANGLE - Math.PI / 2;
  const dLat = (r * Math.sin(a)) / 111_320;
  const dLng = (r * Math.cos(a)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

export function buildWorld(goals: Goal[], venues: Venue[]): World {
  const venueById = new Map<string, VenueAgg>();
  for (const v of venues) {
    venueById.set(v.id, { ...v, goals: [], numbers: [], count: 0, first: undefined as never, last: undefined as never, mainTeam: "portugal" });
  }
  for (const g of goals) {
    const v = venueById.get(g.venue);
    if (!v) continue;
    v.goals.push(g);
    v.numbers.push(g.n);
  }
  const used: VenueAgg[] = [];
  for (const v of venueById.values()) {
    if (v.goals.length === 0) continue;
    v.count = v.goals.length;
    v.first = v.goals[0];
    v.last = v.goals[v.goals.length - 1];
    const tally = new Map<TeamKey, number>();
    for (const g of v.goals) tally.set(g.team, (tally.get(g.team) ?? 0) + 1);
    v.mainTeam = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    used.push(v);
  }
  // Biggest first, so small venues draw on top and stay hoverable next to giants.
  used.sort((a, b) => b.count - a.count);

  const points: GoalPoint[] = [];
  const pointByN = new Map<number, GoalPoint>();
  for (const v of used) {
    v.goals.forEach((goal, k) => {
      const p: GoalPoint = { goal, venue: v, home: [v.lng, v.lat], slot: spiralSlot(v.lng, v.lat, k, v.count) };
      points.push(p);
      pointByN.set(goal.n, p);
    });
  }
  return { goals, venues: used, points, venueById, pointByN, total: goals.length };
}

/** How many of a venue's goals had been scored once the career count stood at `cursor`. */
export function countAt(v: VenueAgg, cursor: number): number {
  const a = v.numbers;
  if (cursor >= a[a.length - 1]) return a.length;
  if (cursor < a[0]) return 0;
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= cursor) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The name a stadium carried on a given date. */
export function venueNameOn(v: Venue, date: string): string {
  for (const p of v.periodNames ?? []) {
    if ((!p.from || date >= p.from) && (!p.to || date <= p.to)) return p.name;
  }
  return v.name;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function minuteLabel(g: Pick<Goal, "minute" | "added">): string {
  return g.added ? `${g.minute}+${g.added}′` : `${g.minute}′`;
}
