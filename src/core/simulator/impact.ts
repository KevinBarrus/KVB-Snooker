import type { ContactBase } from "../physics/contact.js";
import type { Ball } from "./ball.js";

interface ImpactPosition {
  readonly time: number;
  readonly ballIndex: number;
  readonly x: number;
  readonly z: number;
}

export type ImpactEvent = ImpactPosition & (
  | { readonly kind: "cue"; readonly speed: number; readonly tipHeight: number }
  | { readonly kind: "ball"; readonly speed: number }
  | { readonly kind: "surface"; readonly surface: "jaw" | "pocket" | "tunnel" | "end";
      readonly speed: number; readonly horizontalSpeed: number }
);

// PCOL L12085-12094, L12351-12365
export function contactImpact(contact: ContactBase, time: number): ImpactEvent | null {
  const ball = contact.bi as Ball;
  const position = { time, ballIndex: ball.index, x: ball.position.x, z: ball.position.z };
  const speed = Math.max(0, -contact.getCloseSpeed());
  if (contact.isSS) return { ...position, kind: "ball", speed };
  const other = contact.bj;
  if (!other) return null;
  const surface = "end" in other && other.end ? "end"
    : "tunnel" in other && other.tunnel ? "tunnel"
    : "pocket" in other && other.pocket ? "pocket"
    : "sidesoft" in other && other.sidesoft ? "jaw" : null;
  return surface ? { ...position, kind: "surface", surface, speed,
    horizontalSpeed: Math.hypot(ball.v.x, ball.v.z) } : null;
}

// PCOL L5716-5727, L11862-11870, L13667-13673
export function cueImpact(ball: Ball, vars: ArrayLike<number>, time: number): ImpactEvent {
  const dx = vars[3], dy = vars[4], dz = vars[5];
  const length = Math.hypot(dx, dy, dz);
  const horizontal = Math.hypot(dx, dz);
  const ux = horizontal > 0 ? -dy * dx / (length * horizontal) : 0;
  const uy = horizontal / length;
  const uz = horizontal > 0 ? -dy * dz / (length * horizontal) : 0;
  const p = ball.position;
  const height = ((vars[0] - p.x) * ux + (vars[1] - p.y) * uy + (vars[2] - p.z) * uz) / (ball.radius + vars[7]);
  return { kind: "cue", time, ballIndex: ball.index, x: p.x, z: p.z,
    speed: vars[6], tipHeight: Math.max(-1, Math.min(1, height)) };
}
