// The shape of the published dataset (data/goals.json and data/venues.json).

export type TeamKey = "sporting" | "manutd" | "realmadrid" | "juventus" | "alnassr" | "portugal";

export type Goal = {
  /** Career goal number, 1-based, in chronological order. */
  n: number;
  /** Stable id that survives renumbering: date, team, opponent, order within the match. */
  id: string;
  /** Match date (UTC), YYYY-MM-DD. */
  date: string;
  team: TeamKey;
  opponent: string;
  /** Competition as displayed, e.g. "UEFA Champions League". */
  comp: string;
  /** Competition key for filtering, e.g. "uefa.champions". */
  compKey: string;
  /** "2007–08" for club seasons; the tournament or year for internationals. */
  season: string;
  round?: string;
  /** Home, away or neutral ground. */
  ha: "H" | "A" | "N";
  /** Key into venues.json. */
  venue: string;
  minute: number;
  /** Stoppage-time minutes, e.g. 4 for 90+4. */
  added?: number;
  /** Score straight after this goal, his team first. Absent when the source cannot give it. */
  score?: [number, number];
  /** Final score, his team first. */
  final: [number, number];
  /** How the match was decided, when not in 90 minutes. */
  decided?: "aet" | "pens";
  penalty: boolean;
  /** Set only where a source marks the goal as a direct free kick; absent means "not recorded", not "no". */
  freeKick?: true;
  body?: "right" | "left" | "head" | "other";
  zone?: "six-yard box" | "close range" | "penalty area" | "outside the box" | "long range";
  /** Where in the goal the ball went, as seen by the shooter. */
  placement?: { height?: "top" | "high" | "bottom"; side: "left" | "centre" | "right" };
  situation?: "corner" | "set piece" | "fast break";
  assist?: string;
  assistType?: "cross" | "through ball" | "headed pass";
  /** A curated video of this goal, embedded or linked from its original host. */
  video?: { youtube: string; start?: number; channel?: string };
  /** Present when official bodies disagree about whether this goal is his. Shown on the goal's page. */
  disputed?: string;
  /** Where the facts for this record came from. */
  src: string[];
  /** True for the simulated goals used to rehearse the celebration. Never present in real data. */
  preview?: true;
};

export type Venue = {
  id: string;
  /** The name shown: the common, sponsor-free name. */
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  /** Names the stadium carried in particular years, shown on goals from that time. */
  periodNames?: { name: string; from?: string; to?: string }[];
  /** Wikidata item the coordinates were taken from. */
  wikidata?: string;
  /** True once a person has checked the position against the stadium. */
  reviewed?: boolean;
  demolished?: boolean;
};

export type Dataset = {
  /** ISO timestamp of the build. */
  generatedAt: string;
  /** Date of the most recent goal included. */
  asOf: string;
  total: number;
  goals: Goal[];
  venues: Venue[];
};

export const TEAMS: Record<TeamKey, { name: string; short: string; color: string; years: string }> = {
  sporting: { name: "Sporting CP", short: "Sporting", color: "#2fa56a", years: "2002–03" },
  manutd: { name: "Manchester United", short: "Man United", color: "#e2463f", years: "2003–09, 2021–22" },
  realmadrid: { name: "Real Madrid", short: "Real Madrid", color: "#f3efe4", years: "2009–18" },
  juventus: { name: "Juventus", short: "Juventus", color: "#aeb6c4", years: "2018–21" },
  alnassr: { name: "Al-Nassr", short: "Al-Nassr", color: "#f7d02c", years: "2023–" },
  portugal: { name: "Portugal", short: "Portugal", color: "#d9324a", years: "2003–26" },
};
