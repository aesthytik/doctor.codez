"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GlobeCanvas from "@/components/globe/GlobeCanvas";
import type { GlobeController, Hit } from "@/components/globe/GlobeController";
import Celebration from "@/components/celebration/Celebration";
import Counter from "@/components/ui/Counter";
import Timeline from "@/components/ui/Timeline";
import VenuePanel from "@/components/ui/VenuePanel";
import { GoalCard, TeamDot, VenueCard } from "@/components/ui/Cards";
import { buildWorld, countAt, longDate, type VenueAgg } from "@/lib/data/derive";
import { withPreviewGoals } from "@/lib/data/preview";
import { STINTS, buildClock, ms } from "@/lib/data/timeline";
import { TEAMS, type Goal, type TeamKey, type Venue } from "@/lib/data/types";
import { useLocationSearch, useMediaQuery, useViewport } from "@/lib/hooks";

type Props = { goals: Goal[]; venues: Venue[] };
type Phase = "loading" | "intro" | "explore" | "celebrate";

const TARGET = 1000;
const INTRO_MS = 9500;
const PLAY_MS = 52_000;
const TEAM_ORDER: TeamKey[] = ["sporting", "manutd", "realmadrid", "juventus", "alnassr", "portugal"];
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function Experience({ goals: realGoals, venues }: Props) {
  // The address bar can ask for a rehearsal (?preview=1000) or a fixed view for screenshots.
  const search = useLocationSearch();
  const query = useMemo(() => (search === null ? null : new URLSearchParams(search)), [search]);
  const preview = query?.get("preview") === String(TARGET);

  const world = useMemo(() => buildWorld(preview ? withPreviewGoals(realGoals, TARGET) : realGoals, venues), [realGoals, venues, preview]);
  const clock = useMemo(() => buildClock(world.goals), [world]);
  const lastTime = clock.times[clock.times.length - 1];

  const ctrl = useRef<GlobeController | null>(null);
  const [controller, setController] = useState<GlobeController | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [time, setTime] = useState(lastTime);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<Hit | null>(null);
  const [focusVenue, setFocusVenue] = useState<string | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [listHover, setListHover] = useState<number | null>(null);
  const [view, setView] = useState({ zoom: 1.5, bloom: 0 });
  const [team, setTeam] = useState<TeamKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useViewport();
  const touch = useMediaQuery("(hover: none)");

  const count = Math.min(world.total, clock.countAt(time));
  const live = !playing && phase === "explore" && time >= lastTime;
  const zoomedIn = view.bloom > 0.45;
  const venue = focusVenue ? (world.venueById.get(focusVenue) ?? null) : null;
  const pinnedPoint = pinned ? (world.pointByN.get(pinned) ?? null) : null;
  const narrow = box.w < 720;

  // ---------- one animation loop for the opening and for "play" ----------
  const anim = useRef<{ kind: "intro" | "play"; from: number; to: number; t0: number; dur: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    const loop = (now: number) => {
      const a = anim.current;
      if (a) {
        const f = Math.min(1, Math.max(0, (now - a.t0) / a.dur));
        const t = a.from + (a.to - a.from) * (a.kind === "intro" ? easeInOut(f) : f);
        ctrl.current?.setCursor(clock.countAt(t), { flash: true });
        if (now - lastPaint > 40 || f === 1) {
          lastPaint = now;
          setTime(t);
        }
        if (f === 1) {
          anim.current = null;
          ctrl.current?.setCursor(world.total);
          setTime(lastTime);
          setPlaying(false);
          if (a.kind === "intro") setPhase("explore");
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, lastTime, world.total]);

  const stopAnim = useCallback(() => {
    anim.current = null;
    setPlaying(false);
  }, []);

  const scrub = useCallback(
    (t: number) => {
      stopAnim();
      if (phase === "intro") setPhase("explore");
      setTime(t);
      ctrl.current?.setCursor(clock.countAt(t));
    },
    [clock, phase, stopAnim],
  );

  const togglePlay = useCallback(() => {
    if (playing) return stopAnim();
    const from = time >= lastTime ? clock.start : time;
    anim.current = { kind: "play", from, to: lastTime, t0: performance.now(), dur: (PLAY_MS * (lastTime - from)) / (lastTime - clock.start) };
    setPlaying(true);
  }, [playing, time, lastTime, clock, stopAnim]);

  const skipIntro = useCallback(() => {
    if (phase !== "intro") return;
    anim.current = null;
    ctrl.current?.setCursor(world.total);
    setTime(lastTime);
    setPhase("explore");
  }, [phase, world.total, lastTime]);

  // ---------- the globe is ready ----------
  const onReady = useCallback(() => {
    const c = ctrl.current;
    if (!c || !query) return;
    setController(c);
    const cam = ["lng", "lat", "z"].every((k) => query.has(k));
    if (cam) {
      c.setSpin(false);
      c.map.jumpTo({ center: [Number(query.get("lng")), Number(query.get("lat"))], zoom: Number(query.get("z")), pitch: Number(query.get("pitch") ?? 0), bearing: Number(query.get("bearing") ?? 0) });
    }
    if (preview) return setPhase("celebrate");
    const at = query.get("t");
    if (at) {
      const t = ms(at);
      setTime(t);
      c.setCursor(clock.countAt(t));
      return setPhase("explore");
    }
    const v = query.get("venue");
    const g = Number(query.get("goal") ?? 0);
    if (v || g) {
      const point = g ? world.pointByN.get(g) : undefined;
      const id = point?.venue.id ?? v!;
      setFocusVenue(id);
      if (point) setPinned(g);
      c.setFocus({ venue: id, goal: point ? g : null });
      c.flyToVenue(id, 10);
      return setPhase("explore");
    }
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (query.get("intro") === "0" || calm || cam) return setPhase("explore");
    c.setCursor(0);
    setTime(clock.start);
    setPhase("intro");
    anim.current = { kind: "intro", from: clock.start, to: lastTime, t0: performance.now() + 1700, dur: INTRO_MS };
  }, [query, preview, clock, lastTime, world]);

  // ---------- picking ----------
  const onSelect = useCallback(
    (hit: Hit | null) => {
      if (phase === "intro") return skipIntro();
      if (!hit) return setPinned(null);
      if (hit.kind === "venue") {
        setFocusVenue(hit.venue.id);
        setPinned(null);
        setHover(null);
        ctrl.current?.flyToVenue(hit.venue.id);
      } else {
        setFocusVenue(hit.point.venue.id);
        setPinned(hit.point.goal.n);
      }
    },
    [phase, skipIntro],
  );

  const stepGoal = useCallback(
    (dir: -1 | 1) => {
      if (!pinned) return;
      const next = world.pointByN.get(pinned + dir);
      if (!next) return;
      setPinned(next.goal.n);
      if (next.venue.id !== focusVenue) {
        setFocusVenue(next.venue.id);
        ctrl.current?.flyToVenue(next.venue.id, 2600);
      }
    },
    [pinned, world, focusVenue],
  );

  const backToGlobe = useCallback(() => {
    setFocusVenue(null);
    setPinned(null);
    ctrl.current?.flyHome();
  }, []);

  useEffect(() => {
    ctrl.current?.setFocus({ venue: focusVenue, goal: pinned ?? listHover });
  }, [focusVenue, pinned, listHover, controller]);
  useEffect(() => {
    ctrl.current?.setTeams(team ? [team] : null);
  }, [team, controller]);

  // Zooming into a stadium by hand opens its list too.
  const onView = useCallback(
    (v: { zoom: number; bloom: number }) => {
      setView((prev) => (Math.abs(prev.zoom - v.zoom) > 0.02 || prev.bloom !== v.bloom ? v : prev));
      const c = ctrl.current;
      if (!c) return;
      if (v.bloom < 0.3) return setFocusVenue((f) => (f && !c.map.isMoving() ? null : f));
      if (v.bloom > 0.6) {
        const centre = c.map.getCenter();
        let best: VenueAgg | null = null;
        let bestD = 0.12; // degrees: roughly ten kilometres
        for (const cand of world.venues) {
          const d = Math.hypot(cand.lng - centre.lng, cand.lat - centre.lat);
          if (d < bestD) {
            bestD = d;
            best = cand;
          }
        }
        if (best) setFocusVenue(best.id);
      }
    },
    [world],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return pinned ? setPinned(null) : backToGlobe();
      if (e.key === "ArrowLeft" && pinned) stepGoal(-1);
      if (e.key === "ArrowRight" && pinned) stepGoal(1);
      if (e.key === " " && phase === "explore" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        togglePlay();
      }
      if (phase === "intro") skipIntro();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pinned, phase, stepGoal, backToGlobe, togglePlay, skipIntro]);

  // ---------- where the floating card goes ----------
  const floating = (hit: Hit, w: number, h: number) => {
    const pad = 18;
    const left = hit.x + pad + w > box.w - 12 ? hit.x - pad - w : hit.x + pad;
    const top = Math.min(Math.max(12, hit.y - h / 2), box.h - h - 12);
    return { position: "absolute" as const, left: Math.max(12, left), top };
  };

  const chapter = useMemo(() => {
    const s = [...STINTS].reverse().find((x) => time >= ms(x.from));
    return s ? TEAMS[s.team].name : TEAMS.sporting.name;
  }, [time]);
  const teamCounts = useMemo(() => {
    const m = new Map<TeamKey, number>();
    for (const g of world.goals) m.set(g.team, (m.get(g.team) ?? 0) + 1);
    return m;
  }, [world]);
  const thousandth = world.pointByN.get(TARGET) ?? null;
  const hud = phase === "explore";

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink text-text" data-phase={phase} data-ready={controller ? "1" : "0"}>
      {query && (
        <GlobeCanvas
          world={world}
          controller={ctrl}
          options={{ detail: query.get("detail") !== "0", spin: query.get("spin") !== "0" }}
          onReady={onReady}
          onHover={(h) => phase === "explore" && setHover(h)}
          onSelect={onSelect}
          onView={onView}
          onError={setError}
        />
      )}

      {/* depth: darker corners and a little film grain */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 75% 70% at 50% 46%, rgba(4,6,11,0) 55%, rgba(4,6,11,0.72) 100%)" }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[210px]" style={{ background: "linear-gradient(to top, rgba(4,6,11,0.94) 18%, rgba(4,6,11,0.55) 60%, rgba(4,6,11,0))" }} />
      <div className="grain pointer-events-none absolute inset-0" />

      {/* ---------- the opening ---------- */}
      {phase === "intro" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-end pb-[16vh] text-center">
          <div className="w-full">
            {count === 0 ? (
              <p className="intro-line font-serif text-2xl italic text-text sm:text-4xl">
                Lisbon, 7 October 2002. <span className="text-gold-hi">Goal one.</span>
              </p>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-[0.5em] text-dim">
                  {new Date(time).getUTCFullYear()} · {chapter}
                </div>
                <div className="numerals text-gilded mt-1 text-[24vw] leading-none sm:text-[13rem]" style={{ filter: "drop-shadow(0 0 40px rgba(242,193,78,0.3))" }}>
                  {count}
                </div>
              </>
            )}
            <div className="mt-4 text-[10px] uppercase tracking-[0.4em] text-faint">Click anywhere to skip</div>
          </div>
        </div>
      )}

      {/* ---------- the interface ---------- */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-1000 ${hud ? "opacity-100" : "opacity-0"}`} aria-hidden={!hud}>
        <header className="absolute left-4 top-4 max-w-[60vw] sm:left-8 sm:top-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.42em] text-gold sm:text-[13px]">A Thousand Lights</div>
          <p className="mt-1.5 hidden font-serif text-xl italic leading-snug text-dim sm:block">
            Every Cristiano Ronaldo goal,
            <br />
            where it happened.
          </p>
          <nav className={`pointer-events-auto mt-4 flex max-w-[420px] flex-wrap gap-1.5 ${hud ? "" : "invisible"}`} aria-label="Show one team">
            <button type="button" onClick={() => setTeam(null)} className={`chip ${team === null ? "chip-on" : ""}`}>
              All
            </button>
            {TEAM_ORDER.map((k) => (
              <button key={k} type="button" onClick={() => setTeam(team === k ? null : k)} className={`chip ${team === k ? "chip-on" : ""}`}>
                <TeamDot team={k} size={7} />
                <span className="hidden sm:inline">{TEAMS[k].short}</span>
                <span className="tabular-nums opacity-70">{teamCounts.get(k) ?? 0}</span>
              </button>
            ))}
          </nav>
        </header>

        <div className="absolute right-4 top-3 sm:right-8 sm:top-5">
          <Counter value={count} total={world.total} target={TARGET} live={live} compact={narrow || (zoomedIn && Boolean(venue))} />
        </div>

        {venue && zoomedIn && (
          <div className={narrow ? "absolute inset-x-3 bottom-[118px] flex max-h-[36vh]" : "absolute bottom-[130px] right-8 top-[178px] flex"}>
            <VenuePanel venue={venue} activeGoal={pinned ?? listHover} onHover={setListHover} onPick={(n) => setPinned(n)} onClose={backToGlobe} />
          </div>
        )}

        {pinnedPoint && (
          <div className={narrow ? "absolute inset-x-3 top-[92px] flex justify-center" : "absolute left-8 top-1/2 -translate-y-1/2"}>
            <GoalCard goal={pinnedPoint.goal} venue={pinnedPoint.venue} pinned onClose={() => setPinned(null)} onStep={stepGoal} />
          </div>
        )}

        {hover?.kind === "venue" && !zoomedIn && <VenueCard venue={hover.venue} lit={team ? hover.venue.goals.filter((g) => g.team === team && g.n <= count).length : countAt(hover.venue, count)} style={floating(hover, 290, 330)} />}
        {hover?.kind === "goal" && hover.point.goal.n !== pinned && <GoalCard goal={hover.point.goal} venue={hover.point.venue} style={floating(hover, 320, 330)} />}

        <footer className="absolute inset-x-4 bottom-3 sm:inset-x-8 sm:bottom-5">
          <div className="pointer-events-auto">
            <Timeline clock={clock} time={time} count={count} playing={playing} onScrub={scrub} onTogglePlay={togglePlay} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] tracking-wide text-faint">
            <span>
              Unofficial fan tribute. Not affiliated with Cristiano Ronaldo or any club.{" "}
              {live && (
                <span className="text-dim">
                  Latest: No. {world.total}, {longDate(world.goals[world.goals.length - 1].date)}.
                </span>
              )}
            </span>
            <span>{view.zoom > 6 ? "Map data © OpenStreetMap contributors · OpenFreeMap" : touch ? "Tap a light to fly in · drag to turn the Earth" : "Hover a light · click to fly in · drag to turn the Earth"}</span>
          </div>
        </footer>
      </div>

      {phase === "celebrate" && (
        <Celebration
          controller={controller}
          target={TARGET}
          place={thousandth ? `${thousandth.venue.name}, ${thousandth.venue.city}` : ""}
          dateLabel={thousandth ? longDate(thousandth.goal.date) : ""}
          simulated={Boolean(thousandth?.goal.preview)}
          onClose={() => {
            // Land on the stadium where it happened, with goal 1,000 open.
            setPhase("explore");
            setTime(lastTime);
            if (thousandth) {
              setFocusVenue(thousandth.venue.id);
              setPinned(TARGET);
              ctrl.current?.flyToVenue(thousandth.venue.id, 6500);
            } else ctrl.current?.flyHome();
          }}
        />
      )}

      {error && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-red-950/80 px-3 py-1 text-xs text-red-200">{error}</div>}
    </main>
  );
}
