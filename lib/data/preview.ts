// Rehearsal data: invented goals that carry the count to 1,000 so the celebration
// can be seen before it happens. They are flagged, shown as simulated, and never
// written to the real dataset (the validator rejects any that leak).
import type { Goal } from "./types";

const AL_AWWAL = "al-awwal-park";

export function withPreviewGoals(goals: Goal[], target = 1000): Goal[] {
  const out = [...goals];
  const last = goals[goals.length - 1];
  if (!last || goals.length >= target) return out;
  const start = Date.parse(`${last.date}T12:00:00Z`);
  const missing = target - goals.length;
  for (let i = 1; i <= missing; i++) {
    const date = new Date(start + i * 8 * 86_400_000).toISOString().slice(0, 10);
    out.push({
      n: goals.length + i,
      id: `preview-${goals.length + i}`,
      date,
      team: "alnassr",
      opponent: "Simulated opponent",
      comp: "Saudi Pro League",
      compKey: "ksa.1",
      season: "2026–27",
      ha: "H",
      venue: AL_AWWAL,
      minute: 10 + ((i * 17) % 78),
      score: [1, 0],
      final: [1, 0],
      penalty: false,
      src: ["preview"],
      preview: true,
    });
  }
  return out;
}
