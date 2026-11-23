// Turns a line of match commentary into structured facts about a goal.
// Only the facts are kept; the commentary wording itself is never stored.

export type GoalTextFacts = {
  body: "right" | "left" | "head" | "other" | null;
  zone: "six-yard box" | "close range" | "penalty area" | "outside the box" | "long range" | "penalty spot" | null;
  side: "left" | "centre" | "right" | null;
  placement: { height: "top" | "high" | "bottom" | "low" | null; side: "left" | "centre" | "right" | null } | null;
  situation: "penalty" | "direct free kick" | "corner" | "set piece" | "fast break" | null;
  assisted: boolean;
  assistType: "cross" | "through ball" | "headed pass" | null;
};

export function parseGoalText(text: string | null | undefined): GoalTextFacts | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Bare lines such as "Cristiano Ronaldo (Al Nassr) Goal at 14'" carry nothing.
  if (!/(footed|header|penalty|attempt|shot|free kick)/.test(t)) return null;

  const body: GoalTextFacts["body"] = /right footed/.test(t)
    ? "right"
    : /left footed/.test(t)
      ? "left"
      : /header/.test(t)
        ? "head"
        : /with an attempt|other body part/.test(t)
          ? "other"
          : null;

  let zone: GoalTextFacts["zone"] = null;
  if (/converts the penalty|penalty/.test(t) && /converts|scores/.test(t)) zone = "penalty spot";
  else if (/six yard box/.test(t)) zone = "six-yard box";
  else if (/very close range/.test(t)) zone = "close range";
  else if (/more than \d+ yards|long range/.test(t)) zone = "long range";
  else if (/outside the box/.test(t)) zone = "outside the box";
  else if (/(centre|left side|right side) of the box|from a difficult angle/.test(t)) zone = "penalty area";

  const sideMatch = /from the (left side|right side|centre) of the (?:six yard )?box/.exec(t);
  const side: GoalTextFacts["side"] = sideMatch
    ? sideMatch[1] === "centre"
      ? "centre"
      : sideMatch[1] === "left side"
        ? "left"
        : "right"
    : /difficult angle (?:and long range )?on the left/.test(t)
      ? "left"
      : /difficult angle (?:and long range )?on the right/.test(t)
        ? "right"
        : null;

  let placement: GoalTextFacts["placement"] = null;
  const corner = /to the (top|bottom) (left|right) corner/.exec(t);
  if (corner) placement = { height: corner[1] as "top" | "bottom", side: corner[2] as "left" | "right" };
  else if (/to the high centre of the goal/.test(t)) placement = { height: "high", side: "centre" };
  else if (/to the centre of the goal/.test(t)) placement = { height: null, side: "centre" };

  const situation: GoalTextFacts["situation"] = /converts the penalty/.test(t)
    ? "penalty"
    : /from a direct free kick|direct free kick/.test(t)
      ? "direct free kick"
      : /following a corner/.test(t)
        ? "corner"
        : /following a set piece/.test(t)
          ? "set piece"
          : /following a fast break/.test(t)
            ? "fast break"
            : null;

  const assisted = /assisted by/.test(t);
  const assistType: GoalTextFacts["assistType"] = !assisted
    ? null
    : /with a cross/.test(t)
      ? "cross"
      : /through ball/.test(t)
        ? "through ball"
        : /headed pass/.test(t)
          ? "headed pass"
          : null;

  return { body, zone, side, placement, situation, assisted, assistType };
}
