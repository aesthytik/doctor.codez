"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TEAMS } from "@/lib/data/types";
import { PORTUGAL_SPAN, STINTS, monthYear, ms, type Clock } from "@/lib/data/timeline";

type Props = {
  clock: Clock;
  /** The moment on show. */
  time: number;
  count: number;
  playing: boolean;
  onScrub: (t: number) => void;
  onTogglePlay: () => void;
};

const H = 58;
const BAND_Y = 30;
const BAND_H = 12;

/** The career as a strip: club colours along the bottom, goals stacked above, a handle to drag. */
export default function Timeline({ clock, time, count, playing, onScrub, onTogglePlay }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x = (t: number) => ((t - clock.start) / (clock.end - clock.start)) * width;
  const peak = useMemo(() => Math.max(1, ...clock.buckets.map((b) => b.n)), [clock]);
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = 2003; y <= new Date(clock.end).getUTCFullYear(); y += width < 520 ? 4 : 2) out.push(y);
    return out;
  }, [clock, width]);

  const timeAt = (clientX: number) => {
    const box = wrap.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return clock.start + f * (clock.end - clock.start);
  };
  const hx = x(Math.min(clock.end, Math.max(clock.start, time)));
  const labelLeft = Math.min(Math.max(hx, 64), Math.max(64, width - 64));

  return (
    <div className="flex items-end gap-3 sm:gap-4">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause the career" : "Play the career"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-ink-2/70 text-gold backdrop-blur transition hover:border-gold/60 hover:bg-ink-3"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <rect x="2" y="1.5" width="3.4" height="11" rx="1" fill="currentColor" />
            <rect x="8.6" y="1.5" width="3.4" height="11" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3.2 1.6 12 7 3.2 12.4Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div
        ref={wrap}
        className="relative grow cursor-ew-resize touch-none select-none"
        style={{ height: H + 18 }}
        role="slider"
        tabIndex={0}
        aria-label="Point in his career"
        aria-valuemin={0}
        aria-valuemax={clock.times.length}
        aria-valuenow={count}
        aria-valuetext={`${monthYear(time)}, ${count} goals`}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(timeAt(e.clientX));
        }}
        onPointerMove={(e) => dragging.current && onScrub(timeAt(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          const step = (clock.end - clock.start) / 120;
          if (e.key === "ArrowLeft") onScrub(Math.max(clock.start, time - step));
          if (e.key === "ArrowRight") onScrub(Math.min(clock.end, time + step));
        }}
      >
        {width > 0 && (
          <svg width={width} height={H + 18} className="absolute inset-0 overflow-visible" aria-hidden>
            {/* goals per two months */}
            {clock.buckets.map((b, i) => {
              const h = (b.n / peak) * (BAND_Y - 6);
              const lit = b.t0 <= time;
              return (
                <rect
                  key={i}
                  x={x(b.t0) + 0.5}
                  y={BAND_Y - 2 - h}
                  width={Math.max(1, x(b.t1) - x(b.t0) - 1)}
                  height={h}
                  rx={0.8}
                  fill={lit ? "#f2c14e" : "#f2c14e"}
                  opacity={lit ? 0.9 : 0.16}
                />
              );
            })}
            {/* clubs */}
            {STINTS.map((s, i) => {
              const x0 = x(ms(s.from));
              const x1 = x(s.to ? ms(s.to) : clock.end);
              const w = Math.max(2, x1 - x0 - 1.5);
              return (
                <g key={i}>
                  <rect x={x0} y={BAND_Y} width={w} height={BAND_H} rx={2} fill={TEAMS[s.team].color} opacity={0.82} />
                  {w > 78 && (
                    <text x={x0 + 7} y={BAND_Y + 9} fontSize={8.5} fontWeight={700} letterSpacing={1.1} fill="#04060b" style={{ textTransform: "uppercase" }}>
                      {TEAMS[s.team].short}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Portugal runs alongside */}
            <rect x={x(ms(PORTUGAL_SPAN.from))} y={BAND_Y + BAND_H + 3} width={x(ms(PORTUGAL_SPAN.to)) - x(ms(PORTUGAL_SPAN.from))} height={3} rx={1.5} fill={TEAMS.portugal.color} opacity={0.85} />
            {/* years */}
            {years.map((y) => {
              const px = x(Date.UTC(y, 0, 1));
              return (
                <text key={y} x={px} y={H + 12} fontSize={9.5} fill="rgba(244,239,228,0.42)" textAnchor="middle" letterSpacing={0.6}>
                  {y}
                </text>
              );
            })}
            {/* handle */}
            <line x1={hx} x2={hx} y1={-2} y2={BAND_Y + BAND_H + 8} stroke="#fff1c2" strokeWidth={1.2} />
            <circle cx={hx} cy={BAND_Y + BAND_H / 2} r={6.5} fill="#04060b" stroke="#fff1c2" strokeWidth={1.6} />
            <circle cx={hx} cy={BAND_Y + BAND_H / 2} r={2.4} fill="#fff1c2" />
          </svg>
        )}
        <div
          className="pointer-events-none absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-ink-2/85 px-3 py-1 text-[11px] tracking-wide text-text backdrop-blur"
          style={{ left: labelLeft }}
        >
          {monthYear(time)} <span className="text-dim">·</span> <span className="font-semibold text-gold-hi tabular-nums">{count}</span>
        </div>
      </div>
    </div>
  );
}
