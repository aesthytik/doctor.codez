"use client";

import type { CSSProperties, ReactNode } from "react";
import { TEAMS, type Goal, type TeamKey } from "@/lib/data/types";
import { longDate, minuteLabel, venueNameOn, type VenueAgg } from "@/lib/data/derive";
import { effect, groundLabel, how, scoreline, videoSearchUrl } from "@/lib/describe";

const panel =
  "rounded-2xl border border-line bg-[rgba(8,12,21,0.78)] shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,241,194,0.06)] backdrop-blur-xl";

export function TeamDot({ team, size = 8 }: { team: TeamKey; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: TEAMS[team].color }} aria-hidden />;
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.28em] text-faint">{children}</div>;
}

/** Shown while a stadium's light is under the pointer. */
export function VenueCard({ venue, lit, style }: { venue: VenueAgg; lit: number; style?: CSSProperties }) {
  const teams = new Map<TeamKey, number>();
  for (const g of venue.goals) teams.set(g.team, (teams.get(g.team) ?? 0) + 1);
  const split = [...teams.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className={`${panel} pointer-events-none w-[290px] p-5`} style={style}>
      <Label>
        {venue.city}, {venue.country}
      </Label>
      <div className="mt-1 font-serif text-[26px] leading-[1.05] text-text">{venue.name}</div>
      <div className="mt-4 flex items-end gap-3">
        <div className="numerals text-gilded text-[4.2rem]">{lit}</div>
        <div className="pb-1.5 text-sm leading-tight text-dim">
          {lit === 1 ? "goal" : "goals"} here
          {lit !== venue.count && <div className="text-faint">of {venue.count} in all</div>}
        </div>
      </div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/5">
        {split.map(([team, n]) => (
          <div key={team} style={{ width: `${(n / venue.count) * 100}%`, background: TEAMS[team].color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
        {split.map(([team, n]) => (
          <span key={team} className="flex items-center gap-1.5">
            <TeamDot team={team} size={6} /> {TEAMS[team].short} {n}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12px] leading-snug">
        <div>
          <Label>First</Label>
          <div className="mt-0.5 text-text">No. {venue.first.n}</div>
          <div className="text-dim">{longDate(venue.first.date)}</div>
        </div>
        <div>
          <Label>Latest</Label>
          <div className="mt-0.5 text-text">No. {venue.last.n}</div>
          <div className="text-dim">{longDate(venue.last.date)}</div>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-faint">Click to fly in and see each one</div>
    </div>
  );
}

/** Everything known about one goal. `pinned` adds the links and the close button. */
export function GoalCard({
  goal,
  venue,
  style,
  pinned,
  onClose,
  onStep,
}: {
  goal: Goal;
  venue: VenueAgg;
  style?: CSSProperties;
  pinned?: boolean;
  onClose?: () => void;
  onStep?: (dir: -1 | 1) => void;
}) {
  const method = how(goal);
  const did = effect(goal);
  return (
    <div className={`${panel} ${pinned ? "pointer-events-auto" : "pointer-events-none"} w-[320px] p-5`} style={style}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>{goal.preview ? "Simulated for rehearsal" : "Career goal"}</Label>
          <div className="numerals text-gilded mt-1 text-[4.4rem]">{goal.n}</div>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap pt-1 text-[11px] uppercase tracking-[0.2em] text-dim">
          <TeamDot team={goal.team} /> {TEAMS[goal.team].short}
        </div>
      </div>

      <div className="mt-2 font-serif text-[22px] leading-tight text-text">{scoreline(goal)}</div>
      <div className="mt-1 text-[13px] text-dim">
        {longDate(goal.date)} · {goal.comp}
        {goal.round ? ` · ${goal.round}` : ""}
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[13px]">
        <span className="text-faint">Minute</span>
        <span className="text-text">
          {minuteLabel(goal)}
          {did ? <span className="text-dim"> · {did}</span> : null}
        </span>
        {method && (
          <>
            <span className="text-faint">How</span>
            <span className="text-text">{method}</span>
          </>
        )}
        {goal.assist && (
          <>
            <span className="text-faint">Assist</span>
            <span className="text-text">
              {goal.assist}
              {goal.assistType ? <span className="text-dim"> · {goal.assistType}</span> : null}
            </span>
          </>
        )}
        <span className="text-faint">Where</span>
        <span className="text-text">
          {venueNameOn(venue, goal.date)}, {venue.city} <span className="text-dim">· {groundLabel(goal)}</span>
        </span>
      </div>

      {goal.disputed && <p className="mt-3 rounded-lg border border-gold/25 bg-gold/5 p-2.5 text-[11.5px] leading-snug text-dim">{goal.disputed}</p>}

      {pinned && !goal.preview && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <a
            href={goal.video ? `https://www.youtube.com/watch?v=${goal.video.youtube}${goal.video.start ? `&t=${goal.video.start}s` : ""}` : videoSearchUrl(goal)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-gold px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink transition hover:bg-gold-hi"
          >
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
              <path d="M0 0l10 6-10 6z" fill="currentColor" />
            </svg>
            {goal.video ? "Watch" : "Find video"}
          </a>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onStep?.(-1)} aria-label="Previous goal" className="grid h-8 w-8 place-items-center rounded-full border border-line text-dim transition hover:border-gold/60 hover:text-gold">
              ‹
            </button>
            <button type="button" onClick={() => onStep?.(1)} aria-label="Next goal" className="grid h-8 w-8 place-items-center rounded-full border border-line text-dim transition hover:border-gold/60 hover:text-gold">
              ›
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full border border-line text-dim transition hover:border-gold/60 hover:text-gold">
              ×
            </button>
          </div>
        </div>
      )}
      {!pinned && <div className="mt-3 text-[11px] text-faint">Click to pin and find the video</div>}
    </div>
  );
}
