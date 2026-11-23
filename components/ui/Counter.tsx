"use client";

type Props = {
  /** The number on show: the career total, or wherever the timeline is. */
  value: number;
  total: number;
  target?: number;
  /** True while the count stands at the real, current total. */
  live: boolean;
  compact?: boolean;
};

/** The big number, and the road still to travel. */
export default function Counter({ value, total, target = 1000, live, compact }: Props) {
  const remaining = Math.max(0, target - total);
  const reached = total >= target;
  return (
    <div className="pointer-events-none select-none text-right">
      <div className="text-[10px] uppercase tracking-[0.34em] text-dim sm:text-[11px]">{live ? "Career goals" : "Goals so far"}</div>
      <div
        className={`numerals text-gilded ${compact ? "text-[4.6rem]" : "text-[5.6rem] sm:text-[7.5rem] lg:text-[9.5rem]"}`}
        style={{ filter: "drop-shadow(0 0 28px rgba(242,193,78,0.28))" }}
        aria-live="off"
      >
        {Math.floor(value).toLocaleString("en-GB")}
      </div>
      {live && !reached && (
        <>
          <div className="-mt-1 font-serif text-lg italic text-text sm:text-2xl">
            {remaining} to go <span className="text-dim">to {target.toLocaleString("en-GB")}</span>
          </div>
          <div className="mt-3 flex justify-end gap-[5px]" aria-hidden>
            {Array.from({ length: Math.min(remaining, 40) }, (_, i) => (
              <span key={i} className="h-[7px] w-[7px] rounded-full border border-gold/55" />
            ))}
          </div>
        </>
      )}
      {live && reached && <div className="-mt-1 font-serif text-2xl italic text-gold-hi">One thousand.</div>}
    </div>
  );
}
