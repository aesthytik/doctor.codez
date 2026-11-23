// Turns a goal record into the words shown on cards and pages.
import { TEAMS, type Goal } from "./data/types";

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "Real Madrid 2–0 Malmö FF", his team first, with how the match was settled. */
export function scoreline(g: Goal): string {
  const tail = g.decided === "aet" ? " (aet)" : g.decided === "pens" ? " (pens)" : "";
  return `${TEAMS[g.team].name} ${g.final[0]}–${g.final[1]} ${g.opponent}${tail}`;
}

/** A short phrase for how it was scored, using only what the record actually knows. */
export function how(g: Goal): string | null {
  if (g.penalty) return "Penalty";
  if (g.freeKick) return "Direct free kick";
  const part = g.body === "head" ? "Header" : g.body === "right" ? "Right foot" : g.body === "left" ? "Left foot" : null;
  const from =
    g.zone === "six-yard box"
      ? "from the six-yard box"
      : g.zone === "close range"
        ? "from close range"
        : g.zone === "penalty area"
          ? "from inside the area"
          : g.zone === "outside the box"
            ? "from outside the area"
            : g.zone === "long range"
              ? "from long range"
              : null;
  if (part && from) return `${part} ${from}`;
  return part;
}

/** What the goal did to the match, e.g. "made it 2–1". */
export function effect(g: Goal): string | null {
  if (!g.score) return null;
  const [us, them] = g.score;
  if (us === 1 && them === 0) return "opened the scoring";
  if (us === them) return `levelled at ${us}–${them}`;
  if (us - them === 1 && us > 1) return `put them ${us}–${them} ahead`;
  return `made it ${us}–${them}`;
}

export const groundLabel = (g: Goal) => (g.ha === "H" ? "Home" : g.ha === "A" ? "Away" : "Neutral ground");

/** A search that reliably finds footage of the match, for goals with no curated video. */
export function videoSearchUrl(g: Goal): string {
  const year = g.date.slice(0, 4);
  const q = `${TEAMS[g.team].name} ${g.opponent} ${year} ${g.comp} Ronaldo goal`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}
