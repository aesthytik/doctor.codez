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
// Proportions are those of a tall, long-legged athlete: shoulders a quarter of the
// height across, hips narrow, legs a little over half the height.
const STAND: Pose = { head: [0, 0.935], neck: [0, 0.86], shoulder: [0.135, 0.815], elbow: [0.165, 0.63], hand: [0.16, 0.46], hip: [0.06, 0.53], knee: [0.07, 0.285], foot: [0.08, 0.035], lift: 0 };
const CROUCH: Pose = { head: [0, 0.81], neck: [0, 0.735], shoulder: [0.135, 0.69], elbow: [0.21, 0.56], hand: [0.27, 0.44], hip: [0.065, 0.42], knee: [0.13, 0.25], foot: [0.085, 0.035], lift: 0 };
const AIR: Pose = { head: [0, 0.94], neck: [0, 0.865], shoulder: [0.135, 0.82], elbow: [0.2, 0.97], hand: [0.1, 1.11], hip: [0.06, 0.53], knee: [0.11, 0.34], foot: [0.09, 0.14], lift: 0.18 };
// The landing: feet planted wide, legs straight, chest out, both arms thrown straight down and back, fingers spread.
const LAND: Pose = { head: [0, 0.935], neck: [0, 0.86], shoulder: [0.135, 0.815], elbow: [0.265, 0.655], hand: [0.395, 0.5], hip: [0.065, 0.52], knee: [0.165, 0.285], foot: [0.255, 0.035], lift: 0 };

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

// How thick each part of a limb is along its length (fraction along, width in body heights).
const UPPER_ARM: Pt[] = [[0, 0.086], [0.28, 0.08], [0.7, 0.062], [1, 0.054]];
const FOREARM: Pt[] = [[0, 0.054], [0.25, 0.06], [0.75, 0.042], [1, 0.035]];
const THIGH: Pt[] = [[0, 0.118], [0.3, 0.126], [0.75, 0.09], [1, 0.074]];
const SHORTS: Pt[] = [[0, 0.136], [1, 0.142]];
const SHIN: Pt[] = [[0, 0.072], [0.28, 0.088], [0.7, 0.054], [1, 0.044]];

function drawBody(g: CanvasRenderingContext2D, pose: Pose, turn: number, H: number, cx: number, ground: number, numberFont: string) {
  // Seen side-on in mid-turn the body is narrow; it never quite vanishes.
  const squash = Math.sign(turn || 1) * Math.max(0.34, Math.abs(turn));
  const wide = Math.max(0.5, Math.abs(squash));
  const P = (p: Pt, side: 1 | -1): Pt => [cx + side * p[0] * squash * H, ground - (p[1] + pose.lift) * H];
  const along = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const widthAt = (profile: Pt[], t: number) => {
    for (let i = 1; i < profile.length; i++) {
      if (t <= profile[i][0]) {
        const [t0, w0] = profile[i - 1];
        const [t1, w1] = profile[i];
        const k = (t - t0) / (t1 - t0);
        return w0 + (w1 - w0) * (k * k * (3 - 2 * k));
      }
    }
    return profile[profile.length - 1][1];
  };
  /** A limb with muscle on it: its width follows a profile from one joint to the next. */
  const limb = (a: Pt, b: Pt, profile: Pt[], from = 0, to = 1) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = Math.sin(ang);
    const ny = -Math.cos(ang);
    const steps = 14;
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      const c = along(a, b, t);
      const r = (widthAt(profile, t) * H * wide) / 2;
      left.push([c[0] + nx * r, c[1] + ny * r]);
      right.push([c[0] - nx * r, c[1] - ny * r]);
    }
    const start = along(a, b, from);
    const end = along(a, b, to);
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left) g.lineTo(p[0], p[1]);
    g.arc(end[0], end[1], (widthAt(profile, to) * H * wide) / 2, ang - Math.PI / 2, ang + Math.PI / 2);
    for (const p of right.reverse()) g.lineTo(p[0], p[1]);
    g.arc(start[0], start[1], (widthAt(profile, from) * H * wide) / 2, ang + Math.PI / 2, ang - Math.PI / 2);
    g.closePath();
    g.fill();
  };
  /** A dark seam across a limb: a sleeve, the hem of the shorts, the top of a sock. */
  const seams: { at: Pt; ang: number; half: number }[] = [];
  const seam = (a: Pt, b: Pt, profile: Pt[], t: number) => seams.push({ at: along(a, b, t), ang: Math.atan2(b[1] - a[1], b[0] - a[0]), half: (widthAt(profile, t) * H * wide) / 2 + 2 });

  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  for (const side of [1, -1] as const) {
    const shoulder = P(pose.shoulder, side);
    const elbow = P(pose.elbow, side);
    const hand = P(pose.hand, side);
    const hip = P(pose.hip, side);
    const knee = P(pose.knee, side);
    const ankle = P(pose.foot, side);
    limb(shoulder, elbow, UPPER_ARM);
    limb(elbow, hand, FOREARM);
    seam(shoulder, elbow, UPPER_ARM, 0.5);
    // An open hand, fingers spread.
    const reach = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]);
    g.beginPath();
    g.arc(hand[0] + Math.cos(reach) * 0.012 * H, hand[1] + Math.sin(reach) * 0.012 * H, 0.021 * H, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 0.0105 * H;
    for (let f = -2; f <= 2; f++) {
      const dir = reach + f * 0.26;
      const len = (f === -2 || f === 2 ? 0.045 : 0.058) * H;
      g.beginPath();
      g.moveTo(hand[0] + Math.cos(reach) * 0.014 * H, hand[1] + Math.sin(reach) * 0.014 * H);
      g.lineTo(hand[0] + Math.cos(dir) * len, hand[1] + Math.sin(dir) * len);
      g.stroke();
    }
    // Leg, with the shorts over the top of the thigh, a sock to the knee and a boot.
    limb(hip, knee, THIGH);
    limb(hip, knee, SHORTS, 0, 0.5);
    limb(knee, ankle, SHIN);
    seam(knee, ankle, SHIN, 0.12);
    const out = side * Math.sign(squash) * wide;
    g.beginPath();
    g.ellipse(ankle[0] + out * 0.034 * H, ankle[1] + 0.022 * H, 0.06 * H * wide, 0.026 * H, out * 0.12, 0, Math.PI * 2);
    g.fill();
  }

  // Torso: sloping shoulders, a deep chest, a narrow waist.
  const sr = P(pose.shoulder, 1);
  const hr = P(pose.hip, 1);
  const neck = P(pose.neck, 1);
  const dir = Math.sign(sr[0] - cx || 1);
  const span = Math.abs(sr[0] - cx);
  const torsoH = hr[1] - sr[1];
  const X = (k: number, sideSign: number) => cx + sideSign * dir * k * span;
  const Y = (k: number) => sr[1] + k * torsoH;
  g.beginPath();
  g.moveTo(X(0.32, -1), neck[1] + 0.012 * H);
  g.lineTo(X(0.32, 1), neck[1] + 0.012 * H);
  g.quadraticCurveTo(X(0.5, 1), Y(-0.17), X(0.98, 1), Y(-0.1)); // trapezius to the point of the shoulder
  g.quadraticCurveTo(X(1.1, 1), Y(0.04), X(0.98, 1), Y(0.24)); // round the shoulder to the armpit
  g.quadraticCurveTo(X(0.96, 1), Y(0.5), X(0.7, 1), Y(0.72)); // down the ribs to the waist
  g.quadraticCurveTo(X(0.68, 1), Y(0.9), X(0.86, 1), Y(1.06)); // out again over the hip
  g.lineTo(X(0.86, -1), Y(1.06));
  g.quadraticCurveTo(X(0.7, -1), Y(0.9), X(0.7, -1), Y(0.72));
  g.quadraticCurveTo(X(0.96, -1), Y(0.5), X(0.98, -1), Y(0.24));
  g.quadraticCurveTo(X(1.1, -1), Y(0.04), X(0.98, -1), Y(-0.1));
  g.quadraticCurveTo(X(0.5, -1), Y(-0.17), X(0.32, -1), neck[1] + 0.012 * H);
  g.closePath();
  g.fill();
  // The seat of the shorts, between the legs.
  g.beginPath();
  g.moveTo(X(0.86, 1), Y(1.0));
  g.lineTo(X(0.86, -1), Y(1.0));
  g.lineTo(X(0.5, -1), Y(1.26));
  g.lineTo(cx, Y(1.2));
  g.lineTo(X(0.5, 1), Y(1.26));
  g.closePath();
  g.fill();

  // Neck and head: a strong neck, ears, short hair standing up a little on top.
  const head = P(pose.head, 1);
  const hw = 0.05 * H * Math.max(0.85, wide);
  const hh = 0.067 * H;
  g.beginPath();
  g.moveTo(neck[0] - 0.034 * H * wide, neck[1] + 0.02 * H);
  g.lineTo(neck[0] - 0.03 * H * wide, head[1] + hh * 0.55);
  g.lineTo(neck[0] + 0.03 * H * wide, head[1] + hh * 0.55);
  g.lineTo(neck[0] + 0.034 * H * wide, neck[1] + 0.02 * H);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(head[0] - hw * 0.62, head[1] + hh * 0.98); // jaw
  g.quadraticCurveTo(head[0] - hw * 1.02, head[1] + hh * 0.55, head[0] - hw, head[1] - hh * 0.05);
  g.quadraticCurveTo(head[0] - hw * 1.04, head[1] - hh * 0.95, head[0] - hw * 0.45, head[1] - hh * 1.08); // hair, squared off
  g.quadraticCurveTo(head[0], head[1] - hh * 1.2, head[0] + hw * 0.45, head[1] - hh * 1.08);
  g.quadraticCurveTo(head[0] + hw * 1.04, head[1] - hh * 0.95, head[0] + hw, head[1] - hh * 0.05);
  g.quadraticCurveTo(head[0] + hw * 1.02, head[1] + hh * 0.55, head[0] + hw * 0.62, head[1] + hh * 0.98);
  g.quadraticCurveTo(head[0], head[1] + hh * 1.16, head[0] - hw * 0.62, head[1] + hh * 0.98);
  g.closePath();
  g.fill();
  for (const e of [-1, 1]) {
    g.beginPath();
    g.ellipse(head[0] + e * hw * 1.03, head[1] + hh * 0.12, hw * 0.16, hh * 0.24, 0, 0, Math.PI * 2);
    g.fill();
  }

  // The kit, cut into the light as dark seams.
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.lineWidth = Math.max(1, 0.0075 * H);
  g.lineCap = "butt";
  for (const s of seams) {
    const nx = Math.sin(s.ang) * s.half;
    const ny = -Math.cos(s.ang) * s.half;
    g.beginPath();
    g.moveTo(s.at[0] + nx, s.at[1] + ny);
    g.lineTo(s.at[0] - nx, s.at[1] - ny);
    g.stroke();
  }
  // Hem of the shorts on each leg, the waistband, and the collar.
  for (const side of [1, -1] as const) {
    const hip = P(pose.hip, side);
    const knee = P(pose.knee, side);
    const at = along(hip, knee, 0.52);
    const ang = Math.atan2(knee[1] - hip[1], knee[0] - hip[0]);
    const half = (0.145 * H * wide) / 2 + 2;
    g.beginPath();
    g.moveTo(at[0] + Math.sin(ang) * half, at[1] - Math.cos(ang) * half);
    g.lineTo(at[0] - Math.sin(ang) * half, at[1] + Math.cos(ang) * half);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(X(0.8, -1), Y(0.97));
  g.quadraticCurveTo(cx, Y(1.01), X(0.8, 1), Y(0.97));
  g.stroke();
  g.beginPath();
  g.moveTo(X(0.34, -1), neck[1] + 0.016 * H);
  g.quadraticCurveTo(cx, neck[1] + 0.04 * H, X(0.34, 1), neck[1] + 0.016 * H);
  g.stroke();
  // His back is to us once he has turned: the name and number show.
  if (turn < -0.55) {
    g.globalAlpha = Math.min(1, (-turn - 0.55) / 0.3);
    g.fillStyle = "rgba(0,0,0,0.85)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${Math.round(0.165 * H)}px ${numberFont}`;
    g.fillText("7", cx, Y(0.5));
    g.font = `800 ${Math.max(6, Math.round(0.04 * H))}px ${numberFont}`;
    const name = "RONALDO";
    const gap = 0.031 * H;
    [...name].forEach((ch, i) => g.fillText(ch, cx + (i - (name.length - 1) / 2) * gap, Y(0.13) - Math.cos(((i - 3) / 3) * 1.1) * 0.012 * H));
  }
  g.restore();
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
