"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import GlobeCanvas from "@/components/globe/GlobeCanvas";
import type { GlobeController, Hit } from "@/components/globe/GlobeController";
import Celebration from "@/components/celebration/Celebration";
import Hologram from "@/components/Hologram";
import HologramClip, { CLIP_PAGE } from "@/components/HologramClip";
import Counter from "@/components/ui/Counter";
import Timeline from "@/components/ui/Timeline";
import VenuePanel from "@/components/ui/VenuePanel";
import { GoalCard, TeamDot, VenueCard } from "@/components/ui/Cards";
import { buildWorld, countAt, longDate, type VenueAgg } from "@/lib/data/derive";
import { withPreviewGoals } from "@/lib/data/preview";
import { STINTS, buildClock, ms } from "@/lib/data/timeline";
import { TEAMS, type Goal, type TeamKey, type Venue } from "@/lib/data/types";
import { useLocationSearch, useMediaQuery, useViewport } from "@/lib/hooks";
import { useLive, type Live } from "@/lib/live";

type Props = {
  goals: Goal[];
  venues: Venue[];
  /** Version stamp of this data, compared with the published status file to spot newer data. */
  version: string;
  /** "hold" keeps the goal-1,000 celebration from playing. */
  celebration: "auto" | "hold";
  /** The career in words (components/About.tsx), opened from the footer. */
  children?: ReactNode;
};
type Phase = "loading" | "intro" | "explore" | "celebrate";
type Anim = { kind: "intro" | "play" | "arrive"; from: number; to: number; t0: number; dur: number; pulse?: number[] };

const TARGET = 1000;
const INTRO_MS = 9500;
const PLAY_MS = 52_000;
/** How long the notice of a new goal stays up. */
const NOTICE_MS = 45_000;

// Remembered in the browser: the opening and the celebration each greet a visitor once.
const SEEN_INTRO = "atl:intro";
const SEEN_THOUSAND = "atl:thousand";
const once = (key: string): boolean => {
  try {
    const first = window.localStorage.getItem(key) === null;
    window.localStorage.setItem(key, "1");
    return first;
  } catch {
    return true;
  }
};
const TEAM_ORDER: TeamKey[] = ["sporting", "manutd", "realmadrid", "juventus", "alnassr", "portugal"];
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function Experience({ goals: builtGoals, venues: builtVenues, version, celebration, children }: Props) {
  // The address bar can ask for a rehearsal (?preview=1000) or a fixed view for screenshots.
  const search = useLocationSearch();
  const query = useMemo(() => (search === null ? null : new URLSearchParams(search)), [search]);
  const preview = query?.get("preview") === String(TARGET);

  // The data the page was built with, replaced by newer data as it is published.
  const built = useMemo<Live>(() => ({ v: version, goals: builtGoals, venues: builtVenues, celebration }), [version, builtGoals, builtVenues, celebration]);
  const live = useLive(built, query !== null && !preview);
  const holding = live.celebration === "hold";

  const world = useMemo(() => buildWorld(preview ? withPreviewGoals(live.goals, TARGET) : live.goals, live.venues), [live.goals, live.venues, preview]);
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
  const [view, setView] = useState<{ zoom: number; bloom: number; horizon: { x: number; y: number } | null }>({ zoom: 1.5, bloom: 0, horizon: null });
  const [team, setTeam] = useState<TeamKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const box = useViewport();
  const touch = useMediaQuery("(hover: none)");

  // Newer data has arrived while the page was open: a new goal, a correction, or the
  // celebration being held or released. (Worked out while rendering, from what this
  // page last saw, as React recommends for state that follows other state.)
  const [seen, setSeen] = useState({ total: world.total, holding });
  const [arrival, setArrival] = useState<{ from: number; to: number } | null>(null);
  if (query && !preview && (seen.total !== world.total || seen.holding !== holding)) {
    setSeen({ total: world.total, holding });
    const due = world.total >= TARGET && !holding;
    const wasDue = seen.total >= TARGET && !seen.holding;
    if (due && !wasDue && (phase === "explore" || phase === "intro")) {
      setArrival(null);
      setPhase("celebrate");
    } else if (world.total > seen.total) setArrival({ from: seen.total, to: world.total });
    else if (world.total < seen.total) setArrival(null);
  }

  const count = Math.min(world.total, clock.countAt(time));
  const atPresent = !playing && phase === "explore" && time >= lastTime;
  const zoomedIn = view.bloom > 0.45;
  const venue = focusVenue ? (world.venueById.get(focusVenue) ?? null) : null;
  const pinnedPoint = pinned ? (world.pointByN.get(pinned) ?? null) : null;
  const narrow = box.w < 720;

  // ---------- one animation loop for the opening and for "play" ----------
  const anim = useRef<Anim | null>(null);
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
          if (a.pulse) ctrl.current?.pulse(a.pulse);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, lastTime, world.total]);

  // What the visitor is looking at right now, for the effects below.
  const now = useRef({ time, phase, playing });
  useEffect(() => {
    now.current = { time, phase, playing };
  });

  // A new goal: if the visitor is looking at the present, run the clock forward to it
  // and make its stadium throb. Someone exploring the past is left where they are.
  useEffect(() => {
    if (!arrival) return;
    const numbers = Array.from({ length: arrival.to - arrival.from }, (_, i) => arrival.from + 1 + i);
    const from = clock.timeOf(arrival.from);
    const view = now.current;
    if (view.phase === "explore" && !view.playing && !anim.current && view.time >= from) {
      anim.current = { kind: "arrive", from, to: lastTime, t0: performance.now() + 600, dur: 1400, pulse: numbers };
    }
    const timer = window.setTimeout(() => setArrival(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [arrival, clock, lastTime]);

  // The celebration owns the globe while it runs, and greets each browser once.
  useEffect(() => {
    if (phase !== "celebrate") return;
    anim.current = null;
    if (!preview) once(SEEN_THOUSAND);
  }, [phase, preview]);

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
    // He has reached 1,000: a visitor arriving afterwards sees the celebration once.
    if (world.total >= TARGET && !holding && !cam && once(SEEN_THOUSAND)) return setPhase("celebrate");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wantIntro = query.get("intro");
    // The opening plays on a first visit (or with ?intro=1); after that the globe is simply there.
    if (wantIntro === "0" || calm || cam || (wantIntro !== "1" && !once(SEEN_INTRO))) return setPhase("explore");
    c.setCursor(0);
    setTime(clock.start);
    setPhase("intro");
    anim.current = { kind: "intro", from: clock.start, to: lastTime, t0: performance.now() + 1700, dur: INTRO_MS };
  }, [query, preview, clock, lastTime, world, holding]);

  const showArrival = useCallback(() => {
    if (!arrival) return;
    const point = world.pointByN.get(arrival.to);
    setArrival(null);
    if (!point) return;
    anim.current = null;
    setPlaying(false);
    setTime(lastTime);
    ctrl.current?.setCursor(world.total);
    ctrl.current?.pulse([arrival.to]);
    setFocusVenue(point.venue.id);
    setPinned(arrival.to);
    ctrl.current?.flyToVenue(point.venue.id);
  }, [arrival, world, lastTime]);

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

  // ---------- the career in words ----------
  const aboutOpen = about && phase === "explore";
  const aboutButton = useRef<HTMLButtonElement>(null);
  const aboutClose = useRef<HTMLButtonElement>(null);
  const closeAbout = useCallback(() => setAbout(false), []);
  // Focus goes into the text when it opens and back to its button when it closes.
  const aboutWasOpen = useRef(false);
  useEffect(() => {
    if (aboutOpen) aboutClose.current?.focus();
    else if (aboutWasOpen.current) aboutButton.current?.focus();
    aboutWasOpen.current = aboutOpen;
  }, [aboutOpen]);

  // A stadium or a goal named in the text opens on the globe behind it. (The links are
  // real addresses, ?venue= and ?goal=, so they also work in a new tab.)
  const onAboutClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-venue], a[data-goal]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const n = Number(a.dataset.goal ?? 0);
      const point = n ? world.pointByN.get(n) : undefined;
      const id = point?.venue.id ?? a.dataset.venue;
      if (!id || !world.venueById.has(id)) return;
      e.preventDefault();
      setAbout(false);
      stopAnim();
      setTime(lastTime);
      ctrl.current?.setCursor(world.total);
      setFocusVenue(id);
      setPinned(point ? n : null);
      ctrl.current?.flyToVenue(id);
    },
    [world, lastTime, stopAnim],
  );

  useEffect(() => {
    ctrl.current?.setFocus({ venue: focusVenue, goal: pinned ?? listHover });
  }, [focusVenue, pinned, listHover, controller]);
  useEffect(() => {
    ctrl.current?.setTeams(team ? [team] : null);
  }, [team, controller]);

  // Zooming into a stadium by hand opens its list too.
  const onView = useCallback(
    (v: { zoom: number; bloom: number; horizon: { x: number; y: number } | null }) => {
      setView((prev) => {
        const moved = !prev.horizon !== !v.horizon || (prev.horizon && v.horizon && Math.hypot(prev.horizon.x - v.horizon.x, prev.horizon.y - v.horizon.y) > 1.5);
        return Math.abs(prev.zoom - v.zoom) > 0.02 || prev.bloom !== v.bloom || moved ? v : prev;
      });
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
      // While the text is open the keys belong to it.
      if (aboutOpen) return e.key === "Escape" ? closeAbout() : undefined;
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
  }, [pinned, phase, stepGoal, backToGlobe, togglePlay, skipIntro, aboutOpen, closeAbout]);

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
  // The hologram stands where the Earth meets the sky, as tall as the sky above it
  // allows, and fades as the view closes in. (?holo=0 switches it off.)
  // It is Panini's animation, played from GIPHY. If that cannot be reached, or the
  // visitor has asked for less motion, a figure drawn by the page stands in.
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [clipFailed, setClipFailed] = useState(false);
  const useClip = !calm && !clipFailed && query?.get("holo") !== "drawn";
  const holo = useMemo(() => {
    const h = view.horizon;
    // The celebration has the sky to itself.
    if (!h || !controller || query?.get("holo") === "0" || phase === "loading" || phase === "celebrate") return null;
    // Shorter than the sky above the horizon, so the jump stays on the page.
    const height = Math.min(box.h * 0.4, (h.y - (narrow ? 6 : 14)) * 0.8);
    if (height < 90) return null;
    const far = 1 - Math.min(1, Math.max(0, (view.zoom - 3.3) / 1.1));
    const strength = far * (phase === "intro" ? 0.5 : narrow ? 0.5 : 0.78);
    return { x: h.x, y: h.y + height * 0.02, height, strength };
  }, [view, controller, query, phase, box.h, narrow]);

  const thousandth = world.pointByN.get(TARGET) ?? null;
  const newest = arrival ? (world.pointByN.get(arrival.to)?.goal ?? null) : null;
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

      {/* the hologram: standing on the horizon while there is sky to stand in */}
      {holo && (useClip ? (
        // A little larger than the drawn figure, standing just this side of the horizon.
        <HologramClip x={holo.x} y={holo.y + holo.height * 0.12} height={holo.height * 1.07} strength={holo.strength} onFail={() => setClipFailed(true)} />
      ) : (
        <Hologram x={holo.x} y={holo.y} height={holo.height} strength={holo.strength} calm={calm} />
      ))}

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
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-1000 ${hud ? "opacity-100" : "opacity-0"}`} aria-hidden={!hud} inert={aboutOpen}>
        <header className="absolute left-4 top-4 max-w-[60vw] sm:left-8 sm:top-7">
          <h1>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.42em] text-gold sm:text-[13px]">A Thousand Lights</span>{" "}
            <span className="mt-1.5 hidden font-serif text-xl font-normal italic leading-snug text-dim sm:block">
              Every Cristiano Ronaldo goal,
              <br />
              where it happened.
            </span>
          </h1>
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
          <Counter value={count} total={world.total} target={TARGET} live={atPresent} compact={narrow || (zoomedIn && Boolean(venue))} />
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

        {arrival && newest && (
          // Top centre where there is room beside the big number; otherwise just above the
          // timeline (or under the header on a phone, when a stadium's list fills the bottom).
          <div
            className={`absolute inset-x-3 flex justify-center sm:inset-x-8 sm:justify-start xl:inset-x-3 xl:bottom-auto xl:top-7 xl:justify-center ${narrow && venue && zoomedIn ? "top-[142px]" : "bottom-[178px] sm:bottom-[156px]"}`}
            role="status"
            aria-live="polite"
          >
            <div className="notice-in pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-gold/60 bg-[rgba(8,12,21,0.88)] py-2 pl-4 pr-2 shadow-[0_18px_60px_rgba(0,0,0,0.6),0_0_34px_rgba(242,193,78,0.22)] backdrop-blur-xl">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold" />
              </span>
              <span className="min-w-0 truncate text-[12px] tracking-wide text-text sm:text-[13px]">
                <span className="mr-2 font-semibold uppercase tracking-[0.12em] text-gold sm:tracking-[0.22em]">{arrival.to - arrival.from > 1 ? `${arrival.to - arrival.from} new goals` : "New goal"}</span>
                No. {arrival.to.toLocaleString("en-GB")} · v {newest.opponent}
                <span className="hidden sm:inline"> · {longDate(newest.date)}</span>
              </span>
              <button type="button" onClick={showArrival} className="shrink-0 rounded-full bg-gold px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink transition hover:bg-gold-hi">
                Show
              </button>
              <button type="button" onClick={() => setArrival(null)} aria-label="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-dim transition hover:text-text">
                ×
              </button>
            </div>
          </div>
        )}

        <footer className="absolute inset-x-4 bottom-3 sm:inset-x-8 sm:bottom-5">
          <div className="pointer-events-auto">
            <Timeline clock={clock} time={time} count={count} playing={playing} onScrub={scrub} onTogglePlay={togglePlay} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] tracking-wide text-faint">
            <span>
              Unofficial fan tribute. Not affiliated with Cristiano Ronaldo or any club.{" "}
              {children && (
                <button ref={aboutButton} type="button" onClick={() => setAbout(true)} aria-haspopup="dialog" className="pointer-events-auto mr-1 text-dim underline underline-offset-2 hover:text-gold">
                  About the count
                </button>
              )}{" "}
              {holo && useClip && (
                <a href={CLIP_PAGE} target="_blank" rel="noreferrer" className="pointer-events-auto underline-offset-2 hover:underline">
                  Hologram animation: Panini America, via GIPHY.
                </a>
              )}{" "}
              {atPresent && (
                <span className="text-dim">
                  Latest: No. {world.total}, {longDate(world.goals[world.goals.length - 1].date)}.
                </span>
              )}
              {thousandth && !thousandth.goal.preview && !holding && phase === "explore" && (
                <button type="button" onClick={() => setPhase("celebrate")} className="pointer-events-auto ml-2 text-gold underline-offset-2 hover:underline">
                  Replay goal 1,000
                </button>
              )}
            </span>
            <span>
              <a href="https://github.com/aesthytik" target="_blank" rel="noreferrer" className="pointer-events-auto text-dim underline-offset-2 hover:text-gold hover:underline">
                Made by @aesthytik on GitHub
              </a>
              {" · "}
              {view.zoom > 6 ? "Map data © OpenStreetMap contributors · OpenFreeMap" : touch ? "Tap a light to fly in · drag to turn the Earth" : "Hover a light · click to fly in · drag to turn the Earth"}
            </span>
          </div>
        </footer>
      </div>

      {/* ---------- the career in words: in the page from the start, shown on request ---------- */}
      {children && (
        <div hidden={!aboutOpen} className="absolute inset-0 grid place-items-center bg-[rgba(4,6,11,0.74)] p-3 backdrop-blur-sm sm:p-8" onClick={closeAbout}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            className="relative max-h-full w-full max-w-[760px] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-[rgba(8,12,21,0.92)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,241,194,0.06)] sm:p-10"
            onClick={(e) => {
              e.stopPropagation();
              onAboutClick(e);
            }}
          >
            <button
              ref={aboutClose}
              type="button"
              onClick={closeAbout}
              aria-label="Back to the globe"
              className="float-right -mr-1 -mt-1 ml-4 grid h-9 w-9 place-items-center rounded-full border border-line text-dim transition hover:border-gold/60 hover:text-gold sm:-mr-3 sm:-mt-3"
            >
              ×
            </button>
            {children}
          </section>
        </div>
      )}

      {phase === "celebrate" && (
        <Celebration
          controller={controller}
          target={TARGET}
          settleAt={world.total}
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
