"use client";

import { useEffect, useRef } from "react";
import { TEAMS } from "@/lib/data/types";
import { minuteLabel, type VenueAgg } from "@/lib/data/derive";
import { TeamDot } from "./Cards";

type Props = {
  venue: VenueAgg;
  activeGoal: number | null;
  onPick: (n: number) => void;
  onHover: (n: number | null) => void;
  onClose: () => void;
};

/** The list of every goal at the stadium on show. */
export default function VenuePanel({ venue, activeGoal, onPick, onHover, onClose }: Props) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeGoal === null) return;
    list.current?.querySelector<HTMLElement>(`[data-n="${activeGoal}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeGoal]);

  return (
    <aside className="pointer-events-auto flex max-h-full w-[300px] flex-col overflow-hidden rounded-2xl border border-line bg-[rgba(8,12,21,0.78)] shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <header className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-faint">
            {venue.city}, {venue.country}
          </div>
          <h2 className="mt-1 font-serif text-[22px] leading-tight text-text">{venue.name}</h2>
          <div className="mt-1 text-[12px] text-dim">
            <span className="font-semibold text-gold-hi">{venue.count}</span> {venue.count === 1 ? "goal" : "goals"} · {venue.first.date.slice(0, 4)}
            {venue.last.date.slice(0, 4) !== venue.first.date.slice(0, 4) ? `–${venue.last.date.slice(0, 4)}` : ""}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Back to the globe" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-dim transition hover:border-gold/60 hover:text-gold">
          ×
        </button>
      </header>
      <div ref={list} className="min-h-0 overflow-y-auto overscroll-contain py-1" onMouseLeave={() => onHover(null)}>
        {venue.goals.map((g) => (
          <button
            key={g.n}
            type="button"
            data-n={g.n}
            onClick={() => onPick(g.n)}
            onMouseEnter={() => onHover(g.n)}
            className={`flex w-full items-center gap-3 px-4 py-2 text-left transition ${g.n === activeGoal ? "bg-gold/12" : "hover:bg-white/5"}`}
          >
            <span className="numerals w-11 shrink-0 text-right text-[22px] text-gold">{g.n}</span>
            <span className="min-w-0 grow">
              <span className="flex items-center gap-1.5 truncate text-[13px] text-text">
                <TeamDot team={g.team} size={6} />
                <span className="truncate">v {g.opponent}</span>
              </span>
              <span className="block truncate text-[11px] text-faint">
                {g.date} · {minuteLabel(g)}
                {g.penalty ? " · pen" : g.body === "head" ? " · header" : ""} · {TEAMS[g.team].short}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
