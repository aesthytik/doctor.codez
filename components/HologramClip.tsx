"use client";

import { useEffect, useRef, useState } from "react";

// The hologram: Panini America's animation of the celebration, played straight from
// GIPHY (it is not copied into this site) and turned into light.
//
// The clip is a drawing on a white ground. Each frame is redrawn here, pixel by pixel,
// as a negative: white becomes nothing at all, so the night sky shows through; the red
// kit turns the blue of a projection; the dark outlines become bright edges; and every
// other pair of rows is dimmed into scan lines. Doing this ourselves, rather than with
// the browser's blend modes, is what makes it look the same on a phone: iPhone browsers
// do not blend video.
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
/** The picture is redrawn at most this often; the clip itself runs at 15 frames a second. */
const REDRAW_MS = 66;

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
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  /** Faded out between one run of the celebration and the next. */
  const [between, setBetween] = useState(false);
  /** Counts the landings, so the gold ring can be played afresh each time. */
  const [landing, setLanding] = useState(0);
  const failed = useRef(onFail);
  useEffect(() => {
    failed.current = onFail;
  });

  const size = height / FIGURE;
  // Sharp enough for the size it is shown at, and no more: every pixel is worked on.
  const res = Math.round(Math.min(420, Math.max(160, size * 1.5)) / 4) * 4;

  useEffect(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !ready) return;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return failed.current();
    c.width = res;
    c.height = res;
    let raf = 0;
    let landed = false;
    let heldSince = 0;
    let fading = false;
    let drawnAt = 0;

    const paint = (now: number) => {
      ctx.drawImage(v, 0, 0, res, res);
      let frame: ImageData;
      try {
        frame = ctx.getImageData(0, 0, res, res);
      } catch {
        // The browser will not let us read the picture: let the stand-in take over.
        cancelAnimationFrame(raf);
        return failed.current();
      }
      const px = frame.data;
      const drift = Math.floor(now / 140) % 4;
      for (let row = 0; row < res; row++) {
        const dim = (row + drift) % 4 < 2 ? 1 : 0.5;
        for (let i = row * res * 4, end = i + res * 4; i < end; i += 4) {
          // The negative: how far from white the drawing is decides how much light there is.
          const r = 255 - px[i];
          const g = 255 - px[i + 1];
          const b = 255 - px[i + 2];
          const light = Math.max(r, g, b);
          if (light < 26) {
            px[i + 3] = 0;
            continue;
          }
          // Lean the colour towards the blue of a projection, and lift it.
          px[i] = Math.min(255, r * 0.78);
          px[i + 1] = Math.min(255, g * 1.02 + 10);
          px[i + 2] = Math.min(255, b * 1.2 + 26);
          px[i + 3] = Math.min(255, (light - 20) * 2.1) * dim;
        }
      }
      ctx.putImageData(frame, 0, 0);
    };

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
        void v.play().catch(() => failed.current());
      }
      if (now - drawnAt >= REDRAW_MS && v.readyState >= 2) {
        drawnAt = now;
        paint(now);
      }
      raf = requestAnimationFrame(tick);
    };
    // Some phones refuse to start a video by themselves (low-power mode): then the stand-in is shown.
    void v.play().catch(() => failed.current());
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, res]);

  const ground = size * GROUND;
  const ring = "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%]";
  return (
    <div aria-hidden className="pointer-events-none absolute transition-opacity duration-700" style={{ left: x - size / 2, top: y - ground, width: size, height: size, opacity: ready ? strength : 0 }}>
      {/* the projector: its light rising, its rings on the ground, and one gold ring from each landing */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: ground - size * 0.62, width: size * 0.8, height: size * 0.62, background: "linear-gradient(to top, rgba(90,170,255,0.2), rgba(90,170,255,0))", clipPath: "polygon(0 0, 100% 0, 66% 100%, 34% 100%)" }}
      />
      <div className={`${ring} border border-[rgba(150,210,255,0.6)]`} style={{ top: ground, width: size * 0.56, height: size * 0.11 }} />
      <div className={`${ring} border border-[rgba(150,210,255,0.45)]`} style={{ top: ground, width: size * 0.38, height: size * 0.075 }} />
      {landing > 0 && <div key={landing} className={`${ring} hologram-landing border-2 border-[rgb(255,214,130)]`} style={{ top: ground, width: size * 0.9, height: size * 0.18 }} />}
      {/* the clip itself is never shown: it only feeds the picture drawn from it */}
      <video
        ref={video}
        src={CLIP}
        crossOrigin="anonymous"
        muted
        autoPlay
        playsInline
        preload="auto"
        disablePictureInPicture
        onCanPlay={() => setReady(true)}
        onError={onFail}
        className="absolute left-0 top-0 h-px w-px opacity-0"
      />
      <canvas
        ref={canvas}
        className="hologram-flicker absolute inset-0 h-full w-full transition-opacity"
        style={{ opacity: between ? 0 : 1, transitionDuration: `${FADE_MS}ms`, filter: "drop-shadow(0 0 7px rgba(110, 200, 255, 0.55))" }}
      />
    </div>
  );
}
