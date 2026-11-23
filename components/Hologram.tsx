"use client";

import { useEffect, useRef } from "react";

// A hologram of the celebration, standing on the Earth's horizon: run-up, jump, half
// turn in the air, and the landing with both arms thrown down and out. It is drawn
// from a small skeleton, in code. There is no photograph or traced image in it.

type Pt = [number, number];
type Pose = {
  head: Pt;
  neck: Pt;
  shoulder: Pt;
  elbow: Pt;
  hand: Pt;
  hip: Pt;
  knee: Pt;
  foot: Pt;
  /** How far off the ground the whole figure is. */
  lift: number;
};

// Right-hand side of the body, in body heights (the left side mirrors it). x across, y up.
const STAND: Pose = { head: [0, 0.93], neck: [0, 0.85], shoulder: [0.17, 0.81], elbow: [0.2, 0.63], hand: [0.19, 0.46], hip: [0.075, 0.51], knee: [0.085, 0.27], foot: [0.09, 0.02], lift: 0 };
const CROUCH: Pose = { head: [0, 0.8], neck: [0, 0.72], shoulder: [0.16, 0.7], elbow: [0.25, 0.56], hand: [0.3, 0.42], hip: [0.09, 0.4], knee: [0.15, 0.23], foot: [0.1, 0], lift: 0 };
const AIR: Pose = { head: [0, 0.94], neck: [0, 0.86], shoulder: [0.16, 0.83], elbow: [0.23, 0.98], hand: [0.11, 1.13], hip: [0.085, 0.52], knee: [0.13, 0.33], foot: [0.1, 0.12], lift: 0.34 };
const LAND: Pose = { head: [0, 0.935], neck: [0, 0.85], shoulder: [0.18, 0.81], elbow: [0.33, 0.63], hand: [0.47, 0.45], hip: [0.08, 0.5], knee: [0.19, 0.265], foot: [0.27, 0.02], lift: 0 };

const PERIOD = 12; // seconds for one loop
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function blend(a: Pose, b: Pose, t: number): Pose {
  const e = ease(Math.min(1, Math.max(0, t)));
  return {
    head: mix(a.head, b.head, e),
    neck: mix(a.neck, b.neck, e),
    shoulder: mix(a.shoulder, b.shoulder, e),
    elbow: mix(a.elbow, b.elbow, e),
    hand: mix(a.hand, b.hand, e),
    hip: mix(a.hip, b.hip, e),
    knee: mix(a.knee, b.knee, e),
    foot: mix(a.foot, b.foot, e),
    lift: a.lift + (b.lift - a.lift) * e,
  };
}

/** The figure at time t (seconds into the loop): its pose, how far round it has turned, and how visible it is. */
function at(t: number): { pose: Pose; turn: number; alpha: number; landed: number } {
  const alpha = t < 0.9 ? t / 0.9 : t > 9.6 ? Math.max(0, 1 - (t - 9.6) / 1.1) : 1;
  if (t < 1.1) return { pose: STAND, turn: 1, alpha, landed: -1 };
  if (t < 1.6) return { pose: blend(STAND, CROUCH, (t - 1.1) / 0.5), turn: 1, alpha, landed: -1 };
  if (t < 2.05) return { pose: blend(CROUCH, AIR, (t - 1.6) / 0.45), turn: Math.cos((Math.PI * (t - 1.6)) / 0.9), alpha, landed: -1 };
  if (t < 2.5) return { pose: blend(AIR, LAND, (t - 2.05) / 0.45), turn: Math.cos((Math.PI * (t - 1.6)) / 0.9), alpha, landed: -1 };
  // Landed: a small settle, then held with a slow breath.
  const since = t - 2.5;
  const settle = Math.exp(-since * 5) * Math.sin(since * 16) * 0.018;
  const breath = Math.sin(since * 1.7) * 0.004;
  const pose: Pose = { ...LAND, head: [0, LAND.head[1] - settle + breath], neck: [0, LAND.neck[1] - settle + breath], shoulder: [LAND.shoulder[0], LAND.shoulder[1] - settle + breath], hip: [LAND.hip[0], LAND.hip[1] - settle * 1.4] };
  return { pose, turn: -1, alpha, landed: since };
}

function drawBody(g: CanvasRenderingContext2D, pose: Pose, turn: number, H: number, cx: number, ground: number, numberFont: string) {
  // Seen side-on in mid-turn the body is narrow; it never quite vanishes.
  const squash = Math.sign(turn || 1) * Math.max(0.34, Math.abs(turn));
  const wide = Math.max(0.45, Math.abs(squash));
  const P = (p: Pt, side: 1 | -1): Pt => [cx + side * p[0] * squash * H, ground - (p[1] + pose.lift) * H];
  /** A limb that tapers from one joint to the next, rounded at both ends. */
  const limb = (a: Pt, b: Pt, wa: number, wb: number) => {
    const ra = (wa * H * wide) / 2;
    const rb = (wb * H * wide) / 2;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = Math.sin(ang);
    const ny = -Math.cos(ang);
    g.beginPath();
    g.moveTo(a[0] + nx * ra, a[1] + ny * ra);
    g.lineTo(b[0] + nx * rb, b[1] + ny * rb);
    g.arc(b[0], b[1], rb, ang - Math.PI / 2, ang + Math.PI / 2);
    g.lineTo(a[0] - nx * ra, a[1] - ny * ra);
    g.arc(a[0], a[1], ra, ang + Math.PI / 2, ang - Math.PI / 2);
    g.closePath();
    g.fill();
  };
  g.fillStyle = "#fff";
  for (const side of [1, -1] as const) {
    const shoulder = P(pose.shoulder, side);
    const elbow = P(pose.elbow, side);
    const hand = P(pose.hand, side);
    const hip = P(pose.hip, side);
    const knee = P(pose.knee, side);
    const foot = P(pose.foot, side);
    limb(shoulder, elbow, 0.078, 0.056);
    limb(elbow, hand, 0.054, 0.04);
    g.beginPath();
    g.arc(hand[0], hand[1], 0.026 * H, 0, Math.PI * 2);
    g.fill();
    // Shorts over the top of the thigh, then the leg, sock and boot.
    const hem: Pt = [hip[0] + (knee[0] - hip[0]) * 0.55, hip[1] + (knee[1] - hip[1]) * 0.55];
    limb(hip, hem, 0.135, 0.125);
    limb(hip, knee, 0.105, 0.072);
    limb(knee, foot, 0.078, 0.05);
    limb(foot, [foot[0] + side * wide * 0.075 * H, foot[1] + 0.004 * H], 0.05, 0.036);
  }
  // Torso: broad at the shoulders, narrow at the waist.
  const sr = P(pose.shoulder, 1);
  const sl = P(pose.shoulder, -1);
  const hr = P(pose.hip, 1);
  const hl = P(pose.hip, -1);
  const waistY = sr[1] + (hr[1] - sr[1]) * 0.72;
  const waist = Math.abs(hr[0] - cx) * 1.12;
  const top = 0.035 * H;
  g.beginPath();
  g.moveTo(sl[0], sl[1] - top);
  g.quadraticCurveTo(cx, sl[1] - top * 1.9, sr[0], sr[1] - top);
  g.quadraticCurveTo(sr[0] + Math.sign(squash) * 0.03 * H * wide, sr[1], sr[0], sr[1] + top);
  g.quadraticCurveTo(cx + (sr[0] - cx) * 0.78, waistY - 0.05 * H, cx + Math.sign(sr[0] - cx || 1) * waist, waistY);
  g.lineTo(hr[0] + Math.sign(hr[0] - cx || 1) * 0.062 * H * wide, hr[1] + 0.02 * H);
  g.lineTo(hl[0] + Math.sign(hl[0] - cx || -1) * 0.062 * H * wide, hl[1] + 0.02 * H);
  g.lineTo(cx + Math.sign(sl[0] - cx || -1) * waist, waistY);
  g.quadraticCurveTo(cx + (sl[0] - cx) * 0.78, waistY - 0.05 * H, sl[0], sl[1] + top);
  g.quadraticCurveTo(sl[0] - Math.sign(squash) * 0.03 * H * wide, sl[1], sl[0], sl[1] - top);
  g.closePath();
  g.fill();
  // Neck and head.
  const neck = P(pose.neck, 1);
  const head = P(pose.head, 1);
  limb([neck[0], neck[1] + 0.02 * H], head, 0.062, 0.058);
  g.beginPath();
  g.ellipse(head[0], head[1], 0.054 * H * Math.max(0.8, wide), 0.068 * H, 0, 0, Math.PI * 2);
  g.fill();
  // His back is to us once he has turned: the number shows.
  if (turn < -0.55) {
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.globalAlpha = Math.min(1, (-turn - 0.55) / 0.3) * 0.8;
    g.font = `900 ${Math.round(0.17 * H)}px ${numberFont}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("7", cx, sr[1] + (hr[1] - sr[1]) * 0.42);
    g.restore();
  }
}

type Props = {
  /** Where the figure's feet go, in pixels from the top-left of the page. */
  x: number;
  y: number;
  /** Body height in pixels. */
  height: number;
  /** 0 hides it, 1 shows it fully. */
  strength: number;
  /** No movement: the landing pose only. */
  calm: boolean;
};

export default function Hologram({ x, y, height: H, strength, calm }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The loop's clock survives a resize, so dragging the globe does not restart the jump.
  const started = useRef<number | null>(null);
  const W = Math.round(H * 1.7);
  const boxH = Math.round(H * 1.75);
  const shown = strength > 0.01;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !shown) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = boxH * dpr;
    const ctx = canvas.getContext("2d")!;
    const make = () => {
      const c = document.createElement("canvas");
      c.width = canvas.width;
      c.height = canvas.height;
      return c;
    };
    const mask = make();
    const layer = make();
    const mg = mask.getContext("2d")!;
    const lg = layer.getContext("2d")!;
    for (const g of [ctx, mg, lg]) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2;
    const ground = boxH - H * 0.14;
    const numberFont = `${getComputedStyle(canvas).getPropertyValue("--font-display") || "sans-serif"}, sans-serif`;
    let raf = 0;
    started.current ??= performance.now();
    const t0 = started.current;

    const frame = (now: number) => {
      const t = calm ? 6 : ((now - t0) / 1000) % PERIOD;
      const { pose, turn, alpha, landed } = at(t);

      mg.clearRect(0, 0, W, boxH);
      drawBody(mg, pose, turn, H, cx, ground, numberFont);

      // Light, cut into scan lines that drift upwards, in the shape of the body.
      lg.globalCompositeOperation = "source-over";
      lg.clearRect(0, 0, W, boxH);
      const fill = lg.createLinearGradient(0, ground - H * 1.5, 0, ground);
      fill.addColorStop(0, "rgba(214, 240, 255, 0.95)");
      fill.addColorStop(0.55, "rgba(120, 196, 255, 0.82)");
      fill.addColorStop(1, "rgba(70, 150, 255, 0.5)");
      lg.fillStyle = fill;
      lg.fillRect(0, 0, W, boxH);
      lg.globalCompositeOperation = "destination-out";
      lg.fillStyle = "rgba(0,0,0,0.5)";
      const gap = Math.max(3, Math.round(H / 62));
      const drift = calm ? 0 : (now / 55) % gap;
      for (let yy = -drift; yy < boxH; yy += gap) lg.fillRect(0, yy, W, gap * 0.42);
      // A brighter band sweeping up through the figure now and then.
      const sweep = ground - (((now / 1000) % 3.4) / 3.4) * H * 1.5;
      lg.globalCompositeOperation = "source-atop";
      const band = lg.createLinearGradient(0, sweep - H * 0.09, 0, sweep + H * 0.09);
      band.addColorStop(0, "rgba(255,255,255,0)");
      band.addColorStop(0.5, "rgba(255,255,255,0.55)");
      band.addColorStop(1, "rgba(255,255,255,0)");
      if (!calm) {
        lg.fillStyle = band;
        lg.fillRect(0, sweep - H * 0.09, W, H * 0.18);
      }
      lg.globalCompositeOperation = "destination-in";
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.drawImage(mask, 0, 0);
      lg.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, W, boxH);
      const flicker = calm ? 1 : 0.86 + 0.14 * Math.sin(now / 47) * Math.sin(now / 131);
      const a = alpha * flicker;

      // The projector's pool of light, and the cone rising from it.
      ctx.globalCompositeOperation = "lighter";
      const cone = ctx.createLinearGradient(0, ground - H * 0.8, 0, ground);
      cone.addColorStop(0, "rgba(90,170,255,0)");
      cone.addColorStop(1, `rgba(90,170,255,${0.16 * a})`);
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(cx - H * 0.22, ground);
      ctx.lineTo(cx - H * 0.5, ground - H * 0.8);
      ctx.lineTo(cx + H * 0.5, ground - H * 0.8);
      ctx.lineTo(cx + H * 0.22, ground);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(150,210,255,${0.55 * a})`;
      ctx.lineWidth = 1.2;
      for (const r of [0.36, 0.24]) {
        ctx.beginPath();
        ctx.ellipse(cx, ground, H * r, H * r * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The landing sends one gold ring out along the ground.
      if (landed >= 0 && landed < 1.6 && !calm) {
        const k = landed / 1.6;
        ctx.strokeStyle = `rgba(255,214,130,${(1 - k) * 0.9 * alpha})`;
        ctx.lineWidth = 2.4 * (1 - k) + 0.6;
        ctx.beginPath();
        ctx.ellipse(cx, ground, H * (0.2 + 0.62 * k), H * (0.2 + 0.62 * k) * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // The figure: a soft halo first, then the lines themselves. Device pixels throughout.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = a * 0.55;
      ctx.filter = `blur(${Math.round(H * 0.035 * dpr)}px)`;
      ctx.drawImage(layer, 0, 0);
      ctx.filter = "none";
      ctx.globalAlpha = a;
      // Now and then a slice of the picture slips sideways, as a projection does.
      const glitch = !calm && Math.sin(now / 613) * Math.sin(now / 211) > 0.82;
      if (glitch) {
        const sy = Math.floor(((Math.sin(now / 37) + 1) / 2) * canvas.height * 0.7);
        const sh = Math.floor(canvas.height * 0.06);
        const dx = Math.round(Math.sin(now / 23) * H * 0.05 * dpr);
        ctx.drawImage(layer, 0, 0, canvas.width, sy, 0, 0, canvas.width, sy);
        ctx.drawImage(layer, 0, sy, canvas.width, sh, dx, sy, canvas.width, sh);
        ctx.drawImage(layer, 0, sy + sh, canvas.width, canvas.height - sy - sh, 0, sy + sh, canvas.width, canvas.height - sy - sh);
      } else ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!calm) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [W, boxH, H, calm, shown]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute transition-opacity duration-700"
      style={{ left: x - W / 2, top: y - (boxH - H * 0.14), width: W, height: boxH, opacity: strength, mixBlendMode: "screen" }}
    />
  );
}
