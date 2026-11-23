"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobeController } from "@/components/globe/GlobeController";
import { useMediaQuery } from "@/lib/hooks";

type Props = {
  controller: GlobeController | null;
  /** The count to climb to (1,000). */
  target: number;
  place: string;
  dateLabel: string;
  simulated: boolean;
  onClose: () => void;
};

const IGNITE_MS = 9000;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The moment itself: the Earth goes dark, every light comes back in order while the
 * count races to 1,000, then the number stands alone.
 */
export default function Celebration(props: Props) {
  // "Replay" remounts the sequence, so every run starts from a clean slate.
  const [run, setRun] = useState(0);
  return <Sequence key={run} {...props} onReplay={() => setRun((r) => r + 1)} />;
}

function Sequence({ controller, target, place, dateLabel, simulated, onClose, onReplay }: Props & { onReplay: () => void }) {
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  // With motion turned off, the finished state is shown straight away.
  const [count, setCount] = useState(calm ? target : 0);
  const [stage, setStage] = useState<"dark" | "ignite" | "title">(calm ? "title" : "dark");
  const sparks = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!controller) return;
    let raf = 0;
    let stopped = false;
    const timers: number[] = [];

    if (calm) {
      controller.setCursor(target);
      return;
    }

    controller.setSpin(false);
    controller.setCursor(0);
    controller.setIntensity(1);
    controller.flyHome(1400);

    timers.push(
      window.setTimeout(() => {
        setStage("ignite");
        const t0 = performance.now();
        const step = (now: number) => {
          if (stopped) return;
          const f = Math.min(1, (now - t0) / IGNITE_MS);
          const n = ease(f) * target;
          controller.setCursor(n, { flash: true });
          setCount(n);
          if (f < 1) raf = requestAnimationFrame(step);
          else {
            controller.setCursor(target);
            setCount(target);
            setStage("title");
            // One surge of light, then settle a little brighter than usual.
            const s0 = performance.now();
            const surge = (t: number) => {
              if (stopped) return;
              const g = Math.min(1, (t - s0) / 2200);
              controller.setIntensity(1 + 1.6 * Math.sin(Math.PI * Math.min(1, g * 1.4)) * (1 - g) + 0.25 * g);
              if (g < 1) raf = requestAnimationFrame(surge);
            };
            raf = requestAnimationFrame(surge);
          }
        };
        raf = requestAnimationFrame(step);
      }, 1500),
    );

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      controller.setIntensity(1);
      controller.setCursor(target);
      controller.setSpin(true);
    };
  }, [controller, target, calm]);

  // Gold sparks drifting down behind the number.
  useEffect(() => {
    if (stage !== "title") return;
    const canvas = sparks.current;
    if (!canvas || calm) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    size();
    window.addEventListener("resize", size);
    const N = Math.round(Math.min(260, canvas.clientWidth / 5));
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: -Math.random() * 0.6,
      v: 0.05 + Math.random() * 0.13,
      drift: (Math.random() - 0.5) * 0.04,
      r: 0.6 + Math.random() * 2.1,
      phase: Math.random() * 6.28,
      hue: 38 + Math.random() * 14,
    }));
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) {
        p.y += p.v * dt;
        p.x += (p.drift + Math.sin(now / 900 + p.phase) * 0.012) * dt;
        if (p.y > 1.05) {
          p.y = -0.05;
          p.x = Math.random();
        }
        const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(now / 420 + p.phase));
        ctx.fillStyle = `hsla(${p.hue}, 92%, ${62 + 20 * twinkle}%, ${0.75 * twinkle})`;
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, p.r * dpr, 0, 6.2832);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, [stage, calm]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" role="dialog" aria-label="One thousand goals">
      {/* the room dims, then lifts once the lights are back */}
      <div
        className="absolute inset-0 transition-opacity duration-[1400ms]"
        style={{ background: "radial-gradient(ellipse at center, rgba(4,6,11,0) 30%, rgba(4,6,11,0.86) 100%)", opacity: stage === "title" ? 0.75 : 1 }}
      />
      <canvas ref={sparks} className="absolute inset-0 h-full w-full" style={{ opacity: stage === "title" ? 1 : 0, transition: "opacity 1.2s" }} />

      {stage !== "title" && (
        <div className="absolute inset-x-0 bottom-[12%] text-center">
          <div className="text-[11px] uppercase tracking-[0.5em] text-dim">{stage === "dark" ? "7 October 2002" : "Every goal, in order"}</div>
          <div className="numerals text-gilded mt-2 text-[22vw] leading-none sm:text-[15vw] lg:text-[11rem]" style={{ filter: "drop-shadow(0 0 40px rgba(242,193,78,0.35))" }}>
            {Math.floor(count).toLocaleString("en-GB")}
          </div>
        </div>
      )}

      {stage === "title" && (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div className="celebrate-rise px-6">
            <div className="text-[11px] uppercase tracking-[0.6em] text-gold-hi sm:text-[13px]">Cristiano Ronaldo</div>
            <div
              className="numerals text-gilded text-[34vw] leading-[0.82] sm:text-[27vw] lg:text-[23rem]"
              style={{ filter: "drop-shadow(0 0 70px rgba(242,193,78,0.5)) drop-shadow(0 0 14px rgba(255,241,194,0.5))" }}
            >
              1000
            </div>
            <div className="mt-2 font-serif text-3xl italic text-text sm:text-5xl">One thousand goals.</div>
            <div className="mt-4 text-[12px] uppercase tracking-[0.32em] text-dim sm:text-[13px]">
              {dateLabel} · {place}
            </div>
            {simulated && <div className="mt-3 text-[11px] tracking-wide text-faint">Rehearsal with simulated goals. He is not there yet.</div>}
            <div className="pointer-events-auto mt-9 flex justify-center gap-3">
              <button type="button" onClick={onReplay} className="rounded-full border border-gold/50 px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-gold transition hover:bg-gold/10">
                Replay
              </button>
              <button type="button" onClick={onClose} className="rounded-full bg-gold px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-ink transition hover:bg-gold-hi">
                Explore all 1,000
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
