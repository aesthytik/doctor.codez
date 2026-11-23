// The career in numbers, worked out from the dataset when the site is built. Used for
// the words a person or a search engine can read without the globe: the page title, the
// link preview and the "About the count" panel.
import { buildWorld, type VenueAgg } from "./derive";
import { TEAMS, type Goal, type TeamKey, type Venue } from "./types";

export type GoalAt = { goal: Goal; venue: VenueAgg };

export type CareerFacts = {
  total: number;
  target: number;
  /** Goals still needed to reach the target; 0 once it is reached. */
  remaining: number;
  /** Date of the most recent goal, YYYY-MM-DD. */
  asOf: string;
  first: GoalAt;
  latest: GoalAt;
  /** Every team he has scored for, most goals first. */
  byTeam: { team: TeamKey; name: string; years: string; count: number }[];
  /** The competitions he has scored most in. */
  byCompetition: { name: string; count: number }[];
  /** The stadiums he has scored most at. */
  topVenues: VenueAgg[];
  /** Goal 1, every hundredth goal, and the target once it is reached. */
  milestones: GoalAt[];
  stadiums: number;
  countries: number;
  penalties: number;
  /** Set when official bodies disagree about one of the goals counted here. */
  disputed: (GoalAt & { note: string })[];
};

export function careerFacts(goals: Goal[], venues: Venue[], target = 1000): CareerFacts {
  const world = buildWorld(goals, venues);
  const at = (n: number): GoalAt => {
    const p = world.pointByN.get(n)!;
    return { goal: p.goal, venue: p.venue };
  };
  const tally = <K>(key: (g: Goal) => K) => {
    const m = new Map<K, number>();
    for (const g of goals) m.set(key(g), (m.get(key(g)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const total = world.total;
  const marks = [1];
  for (let n = 100; n <= total; n += 100) marks.push(n);

  return {
    total,
    target,
    remaining: Math.max(0, target - total),
    asOf: goals[goals.length - 1].date,
    first: at(1),
    latest: at(total),
    byTeam: tally((g) => g.team).map(([team, count]) => ({ team, name: TEAMS[team].name, years: TEAMS[team].years, count })),
    byCompetition: tally((g) => g.comp)
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
    topVenues: world.venues.slice(0, 10),
    milestones: marks.map(at),
    stadiums: world.venues.length,
    countries: new Set(world.venues.map((v) => v.country)).size,
    penalties: goals.filter((g) => g.penalty).length,
    disputed: goals.filter((g) => g.disputed).map((g) => ({ ...at(g.n), note: g.disputed! })),
  };
}
