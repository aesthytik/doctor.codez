// Turning what a person types into a hand-entered goal. Pure, so it can be tested.
import { COMPETITIONS, type ManualGoal } from "./dataset.ts";

/** The competitions offered on the hand-entry form, and whether the match feed covers them. */
export const FORM_COMPETITIONS: Record<string, { compKey: string; inFeed: boolean }> = {
  "Saudi Pro League": { compKey: "ksa.1", inFeed: true },
  "King's Cup": { compKey: "ksa.kings.cup", inFeed: true },
  "Saudi Super Cup": { compKey: "ksa.super_cup", inFeed: false },
  "AFC Champions League": { compKey: "afc.champions", inFeed: true },
  "AFC Champions League Two": { compKey: "afc.cup", inFeed: true },
};

/** "67", "67'", "90+3" or "90'+3'". */
export function parseMinute(text: string): { minute: number; added?: number } {
  const m = /^\s*(\d{1,3})\s*'?\s*(?:\+\s*(\d{1,2})\s*'?)?\s*$/.exec(text);
  if (!m) throw new Error(`Minute "${text}" is not understood. Write it like 67 or 90+3.`);
  const minute = Number(m[1]);
  const added = m[2] ? Number(m[2]) : undefined;
  if (minute < 1 || minute > 120) throw new Error(`Minute ${minute} is outside 1 to 120.`);
  if (added !== undefined && (added < 1 || added > 20)) throw new Error(`Stoppage time +${added} is outside 1 to 20.`);
  return added ? { minute, added } : { minute };
}

/** "2-1", "2–1" or "2:1", his team first. */
export function parseScore(text: string, what: string): [number, number] {
  const m = /^\s*(\d{1,2})\s*[-–:]\s*(\d{1,2})\s*$/.exec(text);
  if (!m) throw new Error(`${what} "${text}" is not understood. Write it like 2-1, his team first.`);
  return [Number(m[1]), Number(m[2])];
}

/** "Name, City, Country", optionally followed by "@ latitude, longitude". */
export function parseStadium(text: string): { name: string; city: string; country: string; at?: { lat: number; lng: number } } {
  const [place, coords] = text.split("@").map((s) => s.trim());
  const parts = place.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) throw new Error(`Stadium "${text}" is not understood. Write it as: Name, City, Country.`);
  const country = parts.pop()!;
  const city = parts.pop()!;
  const out = { name: parts.join(", "), city, country };
  if (!coords) return out;
  const c = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(coords);
  if (!c || Math.abs(Number(c[1])) > 90 || Math.abs(Number(c[2])) > 180) throw new Error(`Position "${coords}" is not understood. Write it as: latitude, longitude.`);
  return { ...out, at: { lat: Number(c[1]), lng: Number(c[2]) } };
}

export type GoalForm = {
  date: string;
  opponent: string;
  competition: string;
  ground: string;
  stadium: string;
  minute: string;
  penalty: string | boolean;
  score: string;
  final: string;
  source: string;
  /** Leave out to decide by whether the feed covers the competition. */
  provisional?: boolean;
  /** Today, for refusing dates in the future. */
  today: string;
};

export function manualGoalFromForm(f: GoalForm): { goal: ManualGoal; at?: { lat: number; lng: number } } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(`${f.date}T00:00:00Z`))) throw new Error(`Date "${f.date}" is not understood. Write it as YYYY-MM-DD.`);
  if (f.date > f.today) throw new Error(`The date ${f.date} is in the future.`);
  const opponent = f.opponent.trim();
  if (!opponent) throw new Error("The opponent is missing.");
  const competition = FORM_COMPETITIONS[f.competition];
  if (!competition) throw new Error(`Competition "${f.competition}" is not one of: ${Object.keys(FORM_COMPETITIONS).join(", ")}.`);
  const ground = f.ground.trim().toLowerCase();
  if (!["home", "away", "neutral"].includes(ground)) throw new Error(`Ground "${f.ground}" must be home, away or neutral.`);
  const { at, ...venue } = parseStadium(f.stadium);
  const score = parseScore(f.score, "Score after the goal");
  const final = parseScore(f.final, "Final score");
  if (score[0] < 1) throw new Error("His team cannot be on 0 straight after he scored. Write the score his team first.");
  if (score[0] > final[0] || score[1] > final[1]) throw new Error(`The score after the goal (${score.join("-")}) cannot be higher than the final score (${final.join("-")}). Write both his team first.`);
  const source = f.source.trim();
  if (!source) throw new Error("A source is needed: a link to a match report or the competition's own page.");
  const penalty = f.penalty === true || /^(true|yes|y|1)$/i.test(String(f.penalty).trim());
  const goal: ManualGoal = {
    date: f.date,
    team: "alnassr",
    opponent,
    comp: COMPETITIONS[competition.compKey].name,
    compKey: competition.compKey,
    designated: ground === "away" ? "away" : "home",
    ...(ground === "neutral" ? { neutral: true } : {}),
    venue,
    ...parseMinute(f.minute),
    penalty,
    score,
    final,
    why: competition.inFeed ? "Entered by hand ahead of the match feed." : "The match feed does not carry this competition.",
    ...((f.provisional ?? competition.inFeed) ? { provisional: true } : {}),
    src: [`hand:${f.today}`, source],
  };
  return { goal, at };
}
