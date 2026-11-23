// The rules that decide what counts and what gets published, checked against saved
// match records and a few made-up awkward cases.
//
//   pnpm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildDataset, type ManualGoal } from "../scripts/lib/dataset.ts";
import type { FeedDetail, FeedEvent, FeedSummary } from "../scripts/lib/espn.ts";
import { pollDelay } from "../lib/data/publish.ts";
import { loadCountries, loadSources } from "../scripts/lib/files.ts";
import type { Located } from "../scripts/lib/geocode.ts";
import { manualGoalFromForm, parseMinute, parseScore, parseStadium } from "../scripts/lib/manual.ts";
import type { GoalFact, Match } from "../scripts/lib/sweep.ts";
import { confirmWithSummary, planUpdate, readRecord, seasonOf, type Reading, type UpdateInput } from "../scripts/lib/update.ts";

type Sample = { match: Match; event: FeedEvent; summary: FeedSummary | null };
const samples = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/feed-samples.json"), "utf8")) as Record<string, Sample>;
const AL_AHLI = samples["401900905"]; // Al Ahli 3–1 Al Nassr, 20 Nov 2026: goal 986
const AL_NAJMA = samples["756138"]; // Al Nassr 5–2 Al Najma: a penalty, then one from open play
const FINAL_2008 = samples["240721"]; // Man Utd 1–1 Chelsea, shoot-out: scored in the match, missed in the shoot-out
const FINAL_2016 = samples["447229"]; // Real Madrid 1–1 Atlético, shoot-out: scored only the winning kick
const AL_FAISALY = samples["401900444"]; // Al Faisaly 1–3 Al Nassr: the disputed goal, an own goal in the feed

const RONALDO = { id: "22774", name: "Cristiano Ronaldo" };
const goalsOf = (r: Reading) => {
  assert.equal(r.status, "ok", r.status === "hold" ? r.reason : "");
  return (r as Extract<Reading, { status: "ok" }>).goals;
};
const holdReason = (r: Reading) => {
  assert.equal(r.status, "hold");
  return (r as Extract<Reading, { status: "hold" }>).reason;
};

// ---------- a made-up match, for the cases real records do not offer ----------
type Play = { clock: string; by: "us" | "them"; who?: { id: string; name: string }; pen?: boolean; ownGoal?: boolean; shootout?: boolean };
function madeUp(opts: { id: string; date: string; opponent?: string; home?: boolean; venue?: { id: string | null; name: string; city: string; country: string }; plays: Play[] }): { match: Match; event: FeedEvent } {
  const venue = opts.venue ?? { id: "10675", name: "Al-Awwal Park", city: "Riyadh", country: "Saudi Arabia" };
  const live = opts.plays.filter((p) => !p.shootout);
  const us = live.filter((p) => p.by === "us").length;
  const them = live.length - us;
  const competitors = [
    { id: "817", name: "Al Nassr", homeAway: opts.home === false ? ("away" as const) : ("home" as const), score: us, shootout: null },
    { id: "9999", name: opts.opponent ?? "Al Sadd", homeAway: opts.home === false ? ("home" as const) : ("away" as const), score: them, shootout: null },
  ];
  const minutes = (clock: string) => {
    const m = /^(\d+)'(?:\+(\d+)')?$/.exec(clock)!;
    return (Number(m[1]) + Number(m[2] ?? 0)) * 60;
  };
  const details: FeedDetail[] = opts.plays.map((p) => ({
    typeId: null,
    type: p.ownGoal ? "Own Goal" : p.pen ? "Penalty - Scored" : "Goal",
    clock: p.clock,
    clockValue: minutes(p.clock),
    team: p.by === "us" ? "817" : "9999",
    scoring: true,
    shootout: Boolean(p.shootout),
    penalty: Boolean(p.pen),
    ownGoal: Boolean(p.ownGoal),
    athletes: [p.who ?? { id: "1", name: "Somebody Else" }],
  }));
  const kickoff = `${opts.date}T18:00Z`;
  return {
    match: {
      id: opts.id,
      date: kickoff,
      league: "ksa.1",
      seasonName: "2026-27 Saudi Pro League",
      round: "2026-27 Saudi Pro League",
      completed: true,
      statusDetail: "FT",
      neutral: false,
      venue: { name: venue.name, city: venue.city, country: venue.country },
      competitors,
      teamKey: "alnassr",
      espnTeam: "817",
    },
    event: { id: opts.id, date: kickoff, seasonYear: 2026, seasonSlug: null, note: null, notes: [], statusName: "STATUS_FULL_TIME", statusDetail: "FT", completed: true, neutral: false, venue, competitors, details },
  };
}

describe("reading one match record", () => {
  it("finds an ordinary goal, with the score at the time", () => {
    const [goal, ...rest] = goalsOf(readRecord(AL_AHLI.match, AL_AHLI.event));
    assert.equal(rest.length, 0);
    assert.deepEqual({ minute: goal.minute, added: goal.added, penalty: goal.penalty, after: goal.scoreAfter, final: goal.final, side: goal.designated }, { minute: 14, added: 0, penalty: false, after: [1, 0], final: [1, 3], side: "away" });
    assert.equal(goal.venue.name, "King Abdullah Sports City");
  });

  it("marks a penalty as a penalty and keeps the running score through a seven-goal match", () => {
    const goals = goalsOf(readRecord(AL_NAJMA.match, AL_NAJMA.event));
    assert.deepEqual(
      goals.map((g) => [g.clock, g.penalty, g.scoreAfter, g.seq]),
      [
        ["56'", true, [3, 2], 1],
        ["73'", false, [4, 2], 2],
      ],
    );
  });

  it("counts a goal in the match but never a shoot-out kick", () => {
    const goals = goalsOf(readRecord(FINAL_2008.match, FINAL_2008.event));
    assert.deepEqual(goals.map((g) => g.clock), ["26'"]);
    assert.deepEqual(goals[0].shootout, [6, 5]);
    assert.deepEqual(goals[0].final, [1, 1]);
  });

  it("counts nothing when his only successful kick came in the shoot-out", () => {
    assert.ok(FINAL_2016.event.details.some((d) => d.shootout && d.athletes.some((a) => a.id === RONALDO.id)), "the sample should contain his shoot-out kick");
    assert.equal(goalsOf(readRecord(FINAL_2016.match, FINAL_2016.event)).length, 0);
  });

  it("does not credit him with an own goal by a defender", () => {
    assert.ok(AL_FAISALY.event.details.some((d) => d.ownGoal), "the sample should contain the own goal");
    // The scorers still add up to 3–1, so the match is not put on hold.
    assert.equal(goalsOf(readRecord(AL_FAISALY.match, AL_FAISALY.event)).length, 0);
  });

  it("does not credit him with his own own goal", () => {
    const m = madeUp({ id: "t1", date: "2026-12-01", plays: [{ clock: "10'", by: "them", who: RONALDO, ownGoal: true }, { clock: "50'", by: "us" }] });
    assert.equal(goalsOf(readRecord(m.match, m.event)).length, 0);
  });

  it("reads nothing, and asks nothing of the feed, when his team did not score", () => {
    const m = madeUp({ id: "t2", date: "2026-12-01", plays: [{ clock: "10'", by: "them" }] });
    assert.deepEqual(readRecord(m.match, null), { status: "ok", goals: [] });
  });

  it("holds a match whose record is missing, empty or does not add up", () => {
    const m = madeUp({ id: "t3", date: "2026-12-01", plays: [{ clock: "10'", by: "us", who: RONALDO }, { clock: "60'", by: "us" }] });
    assert.match(holdReason(readRecord(m.match, null)), /not available yet/);
    assert.match(holdReason(readRecord(m.match, { ...m.event, details: [] })), /no scorers yet/);
    assert.match(holdReason(readRecord(m.match, { ...m.event, details: m.event.details.slice(0, 1) })), /do not add up/);
  });

  it("holds a goal listed under his name but someone else's player number", () => {
    const m = madeUp({ id: "t4", date: "2026-12-01", plays: [{ clock: "10'", by: "us", who: { id: "555", name: "Cristiano Ronaldo" } }] });
    assert.match(holdReason(readRecord(m.match, m.event)), /player number/);
  });
});

describe("checking a goal against the match summary", () => {
  const now = new Date("2026-11-20T20:00:00Z");
  const goals = () => goalsOf(readRecord(AL_AHLI.match, AL_AHLI.event));

  it("accepts a goal both accounts agree on", () => {
    assert.equal(goalsOf(confirmWithSummary(goals(), AL_AHLI.summary, now)).length, 1);
  });

  it("takes the assist and how it was scored from the summary, as facts", () => {
    const summary: FeedSummary = {
      league: "ksa.1",
      seasonName: "2026-27 Saudi Pro League",
      goals: [
        {
          type: "Goal",
          clock: "14'",
          period: 1,
          team: "817",
          shootout: false,
          text: "Goal! Cristiano Ronaldo (Al Nassr) right footed shot from the centre of the box to the bottom left corner. Assisted by João Félix with a cross.",
          participants: [RONALDO, { id: "276350", name: "João Félix" }],
        },
      ],
    };
    const [goal] = goalsOf(confirmWithSummary(goals(), summary, now));
    assert.deepEqual(goal.assist, { id: "276350", name: "João Félix" });
    assert.deepEqual({ body: goal.text?.body, zone: goal.text?.zone, placement: goal.text?.placement, assistType: goal.text?.assistType }, { body: "right", zone: "penalty area", placement: { height: "bottom", side: "left" }, assistType: "cross" });
  });

  it("holds a goal the summary does not have", () => {
    const without: FeedSummary = { ...AL_AHLI.summary!, goals: AL_AHLI.summary!.goals.filter((k) => k.participants[0]?.id !== RONALDO.id) };
    assert.match(holdReason(confirmWithSummary(goals(), without, now)), /disagree: the match record gives him 1, the summary 0/);
  });

  it("waits a few hours for a summary, then accepts the match record alone", () => {
    assert.match(holdReason(confirmWithSummary(goals(), null, new Date("2026-11-20T20:00:00Z"))), /summary is not available yet/);
    assert.equal(goalsOf(confirmWithSummary(goals(), null, new Date("2026-11-21T02:00:00Z"))).length, 1);
  });
});

// ---------- planning an update against the real dataset ----------
const real = await loadSources();
const countries = await loadCountries();
const realBuilt = buildDataset(real);
const noLookup = async (): Promise<Located | null> => null;

function input(over: Partial<UpdateInput> & Pick<UpdateInput, "matches">): UpdateInput {
  const facts = over.facts ?? real.facts;
  const manual = over.manual ?? real.manual;
  const before = buildDataset({ ...real, facts, manual });
  return {
    now: new Date("2026-12-02T09:00:00Z"),
    ...real,
    facts,
    manual,
    published: { total: before.total, goals: before.goals },
    season: 2026,
    team: { key: "alnassr", espnId: "817" },
    previousState: null,
    fixtures: [],
    seasonTotals: {},
    countries,
    locate: noLookup,
    allowDecrease: false,
    maxNew: 6,
    ...over,
  };
}
/** A made-up match read cleanly, as the updater would hand it to the planner. */
const read = (m: { match: Match; event: FeedEvent }) => ({ match: m.match, reading: readRecord(m.match, m.event) });

describe("planning an update", () => {
  it("rediscovers goal 986 from the saved record of the 20 November match, and nothing else changes", async () => {
    const before = real.facts.filter((f) => f.eventId !== AL_AHLI.match.id);
    assert.equal(before.length, real.facts.length - 1, "the real data should hold exactly one goal from that match");
    const reading = confirmWithSummary(goalsOf(readRecord(AL_AHLI.match, AL_AHLI.event)), AL_AHLI.summary, new Date("2026-11-20T20:00:00Z"));
    const plan = await planUpdate(input({ facts: before, matches: [{ match: AL_AHLI.match, reading }] }));
    assert.deepEqual(plan.blocked, []);
    assert.deepEqual(plan.alerts, []);
    assert.equal(plan.title, "Goal 986: v Al Ahli, 20 November 2026 (14')");
    assert.deepEqual(plan.added.map((g) => [g.n, g.id, g.minute, g.venue]), [[986, "2026-11-20-alnassr-al-ahli-1", 14, "king-abdullah-sports-city"]]);
    assert.deepEqual(plan.facts, real.facts);
    assert.deepEqual(plan.built.goals, realBuilt.goals);
    assert.deepEqual(plan.state.matches, [{ id: "401900905", date: "2026-11-20", league: "ksa.1", opponent: "Al Ahli", ha: "A", score: [1, 3], goals: 1 }]);
  });

  it("adds a new goal at a ground already on file, and titles it", async () => {
    const m = madeUp({ id: "n1", date: "2026-11-24", plays: [{ clock: "63'", by: "us", who: RONALDO }, { clock: "80'", by: "them" }, { clock: "90'+4'", by: "us", who: RONALDO, pen: true }] });
    const plan = await planUpdate(input({ matches: [read(m)] }));
    assert.deepEqual(plan.blocked, []);
    assert.equal(plan.built.total, realBuilt.total + 2);
    assert.equal(plan.title, `Goals ${realBuilt.total + 1}–${realBuilt.total + 2}: v Al Sadd, 24 November 2026 (63', 90'+4)`);
    assert.deepEqual(plan.added.map((g) => [g.venue, g.penalty, g.score, g.ha]), [["al-awwal-park", false, [1, 0], "H"], ["al-awwal-park", true, [2, 1], "H"]]);
  });

  it("records a match in which he did not score, without touching the count", async () => {
    const m = madeUp({ id: "n2", date: "2026-11-24", plays: [{ clock: "63'", by: "us" }] });
    const plan = await planUpdate(input({ matches: [read(m)] }));
    assert.equal(plan.built.total, realBuilt.total);
    assert.equal(plan.title, `v Al Sadd, 24 November 2026: no goal, still ${realBuilt.total}`);
    assert.deepEqual(plan.changed, { facts: false, venues: false, goals: false, state: true });
  });

  it("links a new feed id to a stadium it already knows by name", async () => {
    const m = madeUp({ id: "n3", date: "2026-11-24", venue: { id: "77777", name: "Al-Awwal Park", city: "Riyadh", country: "Saudi Arabia" }, plays: [{ clock: "63'", by: "us", who: RONALDO }] });
    const plan = await planUpdate(input({ matches: [read(m)] }));
    assert.deepEqual(plan.blocked, []);
    assert.deepEqual(plan.alerts, []);
    assert.equal(plan.added[0].venue, "al-awwal-park");
    assert.ok(plan.venues.find((v) => v.id === "al-awwal-park")!.feedIds!.includes("77777"));
    assert.equal(plan.venuesAdded.length, 0);
  });

  it("places a stadium he has not scored at before, and asks for it to be checked", async () => {
    const venue = { id: "88888", name: "Thani bin Jassim Stadium", city: "Ar-Rayyan", country: "Qatar" };
    const m = madeUp({ id: "n4", date: "2026-12-08", opponent: "Al-Gharafa", home: false, venue, plays: [{ clock: "30'", by: "us", who: RONALDO }] });
    const plan = await planUpdate(
      input({ now: new Date("2026-12-08T21:00:00Z"), matches: [read(m)], locate: async () => ({ kind: "stadium", lat: 25.34474, lng: 51.440562, wikidata: "Q428177", label: "Thani bin Jassim Stadium", score: 14, kmFromCity: 8 }) }),
    );
    assert.deepEqual(plan.blocked, []);
    assert.equal(plan.added[0].venue, "thani-bin-jassim-stadium");
    assert.deepEqual(plan.venuesAdded.map((v) => [v.id, v.country, v.lat, v.lng, v.wikidata, v.reviewed, v.feedIds]), [["thani-bin-jassim-stadium", "Qatar", 25.34474, 51.44056, "Q428177", false, ["88888"]]]);
    assert.equal(plan.alerts.length, 1);
    assert.match(plan.alerts[0], /added automatically: Thani bin Jassim Stadium.*Please check its position/);
  });

  it("falls back to the city, marked approximate, when the stadium itself cannot be found", async () => {
    const venue = { id: "88889", name: "Some New Ground", city: "Doha", country: "Qatar" };
    const m = madeUp({ id: "n5", date: "2026-12-08", home: false, venue, plays: [{ clock: "30'", by: "us", who: RONALDO }] });
    const plan = await planUpdate(input({ now: new Date("2026-12-08T21:00:00Z"), matches: [read(m)], locate: async () => ({ kind: "city", lat: 25.2867, lng: 51.5333, label: "Doha" }) }));
    assert.deepEqual(plan.blocked, []);
    assert.deepEqual(plan.venuesAdded.map((v) => [v.city, v.approx, v.reviewed]), [["Doha", true, false]]);
  });

  it("holds the goal, and publishes nothing for it, when the stadium cannot be placed at all", async () => {
    const venue = { id: "88890", name: "Nowhere Ground", city: "Nowhere", country: "Qatar" };
    const m = madeUp({ id: "n6", date: "2026-12-08", home: false, venue, plays: [{ clock: "30'", by: "us", who: RONALDO }] });
    const plan = await planUpdate(input({ now: new Date("2026-12-08T21:00:00Z"), matches: [read(m)] }));
    assert.deepEqual(plan.blocked, []);
    assert.equal(plan.built.total, realBuilt.total);
    assert.match(plan.alerts[0], /stadium could not be placed/);
    assert.match(plan.state.matches[0].pending ?? "", /stadium could not be placed/);
    assert.equal(plan.state.matches[0].pendingSince, "2026-12-08T21:00Z");
  });

  it("refuses a stadium position that falls outside the stated country", async () => {
    const venue = { id: "88891", name: "Misplaced Ground", city: "Doha", country: "Qatar" };
    const m = madeUp({ id: "n7", date: "2026-12-08", home: false, venue, plays: [{ clock: "30'", by: "us", who: RONALDO }] });
    const plan = await planUpdate(input({ now: new Date("2026-12-08T21:00:00Z"), matches: [read(m)], locate: async () => ({ kind: "stadium", lat: 40.45, lng: -3.69, wikidata: "Q1", label: "Wrong", score: 20, kmFromCity: null }) }));
    assert.equal(plan.built.total, realBuilt.total);
    assert.equal(plan.venuesAdded.length, 0);
    assert.match(plan.alerts[0], /stadium could not be placed/);
  });

  it("keeps a held match on hold, with its original time, when it is not re-read", async () => {
    const m = madeUp({ id: "n8", date: "2026-11-24", plays: [{ clock: "63'", by: "us", who: RONALDO }] });
    const first = await planUpdate(input({ now: new Date("2026-11-24T20:30:00Z"), matches: [{ match: m.match, reading: { status: "hold", reason: "the match record lists no scorers yet" } }] }));
    assert.equal(first.built.total, realBuilt.total);
    const later = await planUpdate(input({ now: new Date("2026-11-26T09:00:00Z"), matches: [{ match: m.match, reading: null }], previousState: first.state }));
    assert.deepEqual([later.state.matches[0].pending, later.state.matches[0].pendingSince], ["the match record lists no scorers yet", "2026-11-24T20:30Z"]);
    const settled = await planUpdate(input({ now: new Date("2026-11-26T10:00:00Z"), matches: [read(m)], previousState: later.state }));
    assert.equal(settled.built.total, realBuilt.total + 1);
    assert.equal(settled.state.matches[0].pending, undefined);
  });

  it("never publishes a falling count by itself", async () => {
    // He is credited with a goal on 24 November; a later reading of the match no longer has it.
    const withGoal = madeUp({ id: "n9", date: "2026-11-24", plays: [{ clock: "63'", by: "us", who: RONALDO }] });
    const facts = [...real.facts, ...goalsOf(readRecord(withGoal.match, withGoal.event))];
    const corrected = madeUp({ id: "n9", date: "2026-11-24", plays: [{ clock: "63'", by: "us" }] });
    const plan = await planUpdate(input({ facts, matches: [read(corrected)] }));
    assert.equal(plan.blocked.length, 1);
    assert.match(plan.blocked[0], new RegExp(`count would fall from ${realBuilt.total + 1} to ${realBuilt.total}.*No\\. ${realBuilt.total + 1} \\(2026-11-24 v Al Sadd, 63'\\)`));
    const allowed = await planUpdate(input({ facts, matches: [read(corrected)], allowDecrease: true }));
    assert.deepEqual(allowed.blocked, []);
    assert.equal(allowed.title, `Remove 1 goal after a correction: the count is now ${realBuilt.total}`);
  });

  it("refuses an implausible jump", async () => {
    const plays: Play[] = Array.from({ length: 7 }, (_, i) => ({ clock: `${10 + i * 10}'`, by: "us" as const, who: RONALDO }));
    const m = madeUp({ id: "n10", date: "2026-11-24", plays });
    const plan = await planUpdate(input({ matches: [read(m)] }));
    assert.match(plan.blocked.join(" "), /7 new goals in one update is more than the limit of 6/);
    assert.deepEqual((await planUpdate(input({ matches: [read(m)], maxNew: 7 }))).blocked, []);
  });

  it("refuses anything that breaks the dataset's own checks", async () => {
    // Removing a goal from before the reference date contradicts the published season totals.
    const reading: Reading = { status: "ok", goals: [] };
    const plan = await planUpdate(input({ matches: [{ match: AL_AHLI.match, reading }], allowDecrease: true }));
    assert.ok(plan.blocked.some((b) => /Check failed: .*reference/.test(b)), plan.blocked.join("\n"));
  });

  it("compares its count with the feed's own season totals", async () => {
    const m = madeUp({ id: "n11", date: "2026-11-24", plays: [{ clock: "63'", by: "us", who: RONALDO }] });
    const totals = (goals: number) => ({ "ksa.1": { season: "2026-27 Saudi Pro League", goals, appearances: 12 } });
    const agree = await planUpdate(input({ now: new Date("2026-11-24T21:00:00Z"), matches: [read(m)], seasonTotals: totals(9) }));
    assert.deepEqual(agree.alerts, []);
    assert.ok(agree.notes.some((n) => /ksa\.1: the feed's own season total for him agrees with its match records \(9\)/.test(n)));
    const feedAhead = await planUpdate(input({ now: new Date("2026-11-24T21:00:00Z"), matches: [read(m)], seasonTotals: totals(10) }));
    assert.match(feedAhead.alerts[0], /season total for him is 10, but its match records add up to 9/);
    const lagging = await planUpdate(input({ now: new Date("2026-11-24T21:00:00Z"), matches: [read(m)], seasonTotals: totals(8) }));
    assert.deepEqual(lagging.alerts, []);
    const stillBehind = await planUpdate(input({ now: new Date("2026-11-27T09:00:00Z"), matches: [read(m)], seasonTotals: totals(8) }));
    assert.match(stillBehind.alerts[0], /still says 8/);
  });

  it("lists the next fixtures, soonest first", async () => {
    const fixture = (id: string, kickoff: string, name: string, home: boolean) => ({ id, kickoff, league: "ksa.1", state: "pre", venue: "Somewhere", competitors: [{ id: "817", name: "Al Nassr", homeAway: home ? ("home" as const) : ("away" as const) }, { id: "5", name, homeAway: home ? ("away" as const) : ("home" as const) }] });
    const plan = await planUpdate(input({ matches: [], fixtures: [fixture("c", "2026-12-12T17:30Z", "Al Shabab", true), fixture("a", "2026-12-04T17:30Z", "Al Qadsiah", true), fixture("old", "2026-11-28T12:15Z", "Al Hazem", false), fixture("b", "2026-12-08T16:00Z", "Al-Gharafa", false), fixture("d", "2026-12-16T17:30Z", "Al Fayha", false)] }));
    assert.deepEqual(plan.state.next.map((n) => [n.id, n.opponent, n.ha]), [["a", "Al Qadsiah", "H"], ["b", "Al-Gharafa", "A"], ["c", "Al Shabab", "H"]]);
  });
});

describe("goals entered by hand ahead of the feed", () => {
  const entry = (minute: number, extra: Partial<ManualGoal> = {}): ManualGoal => ({
    date: "2026-11-24",
    team: "alnassr",
    opponent: "Al Sadd",
    comp: "AFC Champions League",
    compKey: "afc.champions",
    designated: "home",
    venue: { name: "Al-Awwal Park", city: "Riyadh", country: "Saudi Arabia" },
    minute,
    penalty: false,
    score: [1, 0],
    final: [2, 1],
    provisional: true,
    src: ["hand:2026-11-24", "https://example.org/report"],
    ...extra,
  });
  const feedGoals = (...clocks: string[]) => {
    const m = madeUp({ id: "p1", date: "2026-11-24", plays: clocks.map((clock) => ({ clock, by: "us" as const, who: RONALDO })) });
    return goalsOf(readRecord(m.match, m.event));
  };
  const total = (manual: ManualGoal[], facts: GoalFact[] = []) => buildDataset({ ...real, manual: [...real.manual, ...manual], facts: [...real.facts, ...facts] });

  it("counts while the feed has nothing for the match", () => {
    assert.equal(total([entry(63)]).total, realBuilt.total + 1);
  });

  it("steps aside once the feed reports the goal, so it is counted once", () => {
    const built = total([entry(63)], feedGoals("63'"));
    assert.equal(built.total, realBuilt.total + 1);
    assert.equal(built.report.superseded.length, 1);
    assert.deepEqual(built.goals[built.goals.length - 1].src, ["espn:p1"]);
  });

  it("is still counted once when the minute was typed wrongly", () => {
    assert.equal(total([entry(36)], feedGoals("63'")).total, realBuilt.total + 1);
  });

  it("keeps only as many hand entries as the feed is short of", () => {
    const built = total([entry(63), entry(88, { score: [2, 1] })], feedGoals("63'"));
    assert.equal(built.total, realBuilt.total + 2);
    assert.deepEqual(built.goals.slice(-2).map((g) => [g.minute, g.src[0]]), [[63, "espn:p1"], [88, "hand:2026-11-24"]]);
  });

  it("orders a hand entry by its minute among the feed's goals in the same match", () => {
    const built = total([entry(20, { provisional: false })], feedGoals("63'"));
    assert.deepEqual(built.goals.slice(-2).map((g) => [g.n, g.minute]), [[realBuilt.total + 1, 20], [realBuilt.total + 2, 63]]);
  });

  it("never steps aside when it is not provisional", () => {
    assert.equal(total([entry(49, { provisional: false })], feedGoals("63'")).total, realBuilt.total + 2);
  });
});

describe("the hand-entry form", () => {
  const form = { date: "2026-12-21", opponent: "Al Hilal", competition: "Saudi Super Cup", ground: "neutral", stadium: "Jaber Al-Ahmad International Stadium, Kuwait City, Kuwait", minute: "90+3", penalty: "true", score: "2-1", final: "3-1", source: "https://example.org/report", today: "2026-12-21" };

  it("turns a filled-in form into a goal record", () => {
    const { goal, at } = manualGoalFromForm(form);
    assert.equal(at, undefined);
    assert.deepEqual(
      { ...goal, why: undefined },
      { date: "2026-12-21", team: "alnassr", opponent: "Al Hilal", comp: "Saudi Super Cup", compKey: "ksa.super_cup", designated: "home", neutral: true, venue: { name: "Jaber Al-Ahmad International Stadium", city: "Kuwait City", country: "Kuwait" }, minute: 90, added: 3, penalty: true, score: [2, 1], final: [3, 1], why: undefined, src: ["hand:2026-12-21", "https://example.org/report"] },
    );
  });

  it("marks a goal as provisional only where the feed will report the match itself", () => {
    assert.equal(manualGoalFromForm(form).goal.provisional, undefined);
    assert.equal(manualGoalFromForm({ ...form, competition: "Saudi Pro League", ground: "away" }).goal.provisional, true);
  });

  it("reads minutes, scores and stadiums in the forms people type", () => {
    assert.deepEqual(parseMinute("67"), { minute: 67 });
    assert.deepEqual(parseMinute(" 45'+2' "), { minute: 45, added: 2 });
    assert.deepEqual(parseScore("2–1", "Score"), [2, 1]);
    assert.deepEqual(parseStadium("Stade Olympique, Radès, Tunis, Tunisia @ 36.7478, 10.2728"), { name: "Stade Olympique, Radès", city: "Tunis", country: "Tunisia", at: { lat: 36.7478, lng: 10.2728 } });
  });

  it("explains what is wrong instead of guessing", () => {
    assert.throws(() => manualGoalFromForm({ ...form, minute: "ninety" }), /Minute "ninety" is not understood/);
    assert.throws(() => manualGoalFromForm({ ...form, minute: "130" }), /outside 1 to 120/);
    assert.throws(() => manualGoalFromForm({ ...form, score: "0-1" }), /cannot be on 0/);
    assert.throws(() => manualGoalFromForm({ ...form, score: "3-1", final: "2-1" }), /cannot be higher than the final score/);
    assert.throws(() => manualGoalFromForm({ ...form, date: "2026-12-22" }), /in the future/);
    assert.throws(() => manualGoalFromForm({ ...form, stadium: "Kingdom Arena" }), /Name, City, Country/);
    assert.throws(() => manualGoalFromForm({ ...form, competition: "Friendly" }), /is not one of/);
    assert.throws(() => manualGoalFromForm({ ...form, source: " " }), /A source is needed/);
  });
});

describe("how often an open page looks for news", () => {
  const kickoff = "2026-11-24T18:15Z";
  const at = (iso: string) => pollDelay([kickoff, "2026-11-28T12:15Z"], Date.parse(iso));
  it("is every minute from shortly before kick-off until well after full time", () => {
    assert.equal(at("2026-11-24T18:00Z"), 60_000);
    assert.equal(at("2026-11-24T19:30Z"), 60_000);
    assert.equal(at("2026-11-24T22:15Z"), 60_000);
  });
  it("is every ten minutes the rest of the time", () => {
    assert.equal(at("2026-11-24T17:59Z"), 600_000);
    assert.equal(at("2026-11-24T22:16Z"), 600_000);
    assert.equal(at("2026-11-26T12:00Z"), 600_000);
    assert.equal(pollDelay(undefined, Date.now()), 600_000);
    assert.equal(pollDelay(["not a date"], Date.now()), 600_000);
  });
});

describe("seasons", () => {
  it("run from July to June", () => {
    assert.equal(seasonOf(new Date("2026-11-23T00:00:00Z")), 2026);
    assert.equal(seasonOf(new Date("2027-05-28T00:00:00Z")), 2026);
    assert.equal(seasonOf(new Date("2027-07-01T00:00:00Z")), 2027);
  });
});
