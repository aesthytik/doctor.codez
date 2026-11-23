"use client";

import { useEffect, useRef, useState } from "react";

// The hologram: Panini America's animation of the celebration, played straight from
// GIPHY (it is not copied into this site) and turned into light. The clip is a drawing
// on a white ground; shown as a negative, the white goes dark and drops out against
// the night sky, the red kit turns the blue of a projection, and the dark outlines
// become bright edges. Scan lines and a slow flicker do the rest.
//
// Only the celebration itself is played: the run-in, the jump and the landing. The
// landing is then held for a few seconds before the loop starts again.

export const CLIP_PAGE = "https://giphy.com/gifs/SportsManias-world-cup-sportsmanias-panini-muwgatuQcLStmvNZII";
const CLIP = "https://media.giphy.com/media/muwgatuQcLStmvNZII/giphy.mp4";
/** Where the figure sits in the clip's square frame: how tall he stands, and where the ground is. */
const FIGURE = 0.73;
const GROUND = 0.95;
/** Seconds into the clip: when his feet come down, and the last moment of the celebration. */
const LANDS_AT = 1.62;
const ENDS_AT = 3.5;
const HOLD_MS = 5200;
const FADE_MS = 700;

type Props = {
  /** Where the figure's feet go, in pixels from the top-left of the page. */
  x: number;
  y: number;
  /** Body height in pixels. */
  height: number;
  /** 0 hides it, 1 shows it fully. */
  strength: number;
  /** Called if the clip cannot be played, so something else can stand in. */
  onFail: () => void;
};

export default function HologramClip({ x, y, height, strength, onFail }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  /** Faded out between one run of the celebration and the next. */
  const [between, setBetween] = useState(false);
  /** Counts the landings, so the gold ring can be played afresh each time. */
  const [landing, setLanding] = useState(0);

  useEffect(() => {
    const v = video.current;
    if (!v || !ready) return;
    let raf = 0;
    let landed = false;
    let heldSince = 0;
    let fading = false;
    const tick = (now: number) => {
      if (!heldSince) {
        if (!landed && v.currentTime >= LANDS_AT) {
          landed = true;
          setLanding((n) => n + 1);
        }
        if (v.currentTime >= ENDS_AT) {
          v.pause();
          heldSince = now;
        }
      } else if (!fading && now - heldSince > HOLD_MS) {
        fading = true;
        setBetween(true);
      } else if (fading && now - heldSince > HOLD_MS + FADE_MS) {
        v.currentTime = 0;
        heldSince = 0;
        fading = false;
        landed = false;
        setBetween(false);
        void v.play().catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  const size = height / FIGURE;
  const ground = size * GROUND;
  const ring = "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%]";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute transition-opacity duration-700"
      style={{ left: x - size / 2, top: y - ground, width: size, height: size, opacity: ready ? strength : 0, mixBlendMode: "screen", isolation: "isolate" }}
    >
      <div className="absolute inset-0 transition-opacity" style={{ opacity: between ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}>
        <video
          ref={video}
          src={CLIP}
          muted
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          onCanPlay={() => setReady(true)}
          onError={onFail}
          className="hologram-flicker absolute inset-0 h-full w-full"
          style={{ filter: "invert(1) saturate(0.85) hue-rotate(26deg) brightness(1.12) contrast(1.3)" }}
        />
        {/* scan lines, cut into the picture */}
        <div className="hologram-lines absolute inset-0" style={{ mixBlendMode: "multiply" }} />
      </div>
      {/* the projector: its light rising, its rings on the ground, and one gold ring from each landing */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: ground - size * 0.62, width: size * 0.8, height: size * 0.62, mixBlendMode: "screen", background: "linear-gradient(to top, rgba(90,170,255,0.2), rgba(90,170,255,0))", clipPath: "polygon(0 0, 100% 0, 66% 100%, 34% 100%)" }}
      />
      <div className={`${ring} border border-[rgba(150,210,255,0.6)]`} style={{ top: ground, width: size * 0.56, height: size * 0.11, mixBlendMode: "screen" }} />
      <div className={`${ring} border border-[rgba(150,210,255,0.45)]`} style={{ top: ground, width: size * 0.38, height: size * 0.075, mixBlendMode: "screen" }} />
      {landing > 0 && <div key={landing} className={`${ring} hologram-landing border-2 border-[rgb(255,214,130)]`} style={{ top: ground, width: size * 0.9, height: size * 0.18, mixBlendMode: "screen" }} />}
    </div>
  );
}
