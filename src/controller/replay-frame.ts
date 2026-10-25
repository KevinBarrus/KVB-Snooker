import * as B from "babylonjs/es6.js";
import type { BallView } from "../core/simulator/shot-result.js";
import type { CameraPoint } from "./camera-look.js";

export interface ReplayFrame {
  time: number;
  balls: readonly BallView[];
  eye: CameraPoint;
  target: CameraPoint;
  aimRatio: number;
  firstKissIndex: number;
  struck: boolean;
  cue: { visible: boolean; position: CameraPoint; yaw: number; pitch: number };
}
export type ReplayCapture = Omit<ReplayFrame, "time">;

export function copyBallView(ball: BallView): BallView {
  return { ...ball, position: ball.position.clone(), renderPosition: { ...ball.renderPosition }, renderOrientation: { ...ball.renderOrientation } };
}

export function captureReplayFrame(time: number, value: ReplayCapture): ReplayFrame {
  return { ...value, time, balls: value.balls.map(copyBallView), eye: { ...value.eye }, target: { ...value.target },
    cue: { ...value.cue, position: { ...value.cue.position } } };
}

function mixPoint(a: CameraPoint, b: CameraPoint, t: number): CameraPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// PCOL L7030-7060, L7270-7354
export function interpolateReplayFrame(a: ReplayFrame, b: ReplayFrame, time: number): ReplayFrame {
  const t = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 0;
  const discrete = t >= 1 ? b : a;
  const yaw = Math.atan2(Math.sin(b.cue.yaw - a.cue.yaw), Math.cos(b.cue.yaw - a.cue.yaw));
  return { time, firstKissIndex: discrete.firstKissIndex, struck: discrete.struck,
    aimRatio: a.aimRatio + (b.aimRatio - a.aimRatio) * t,
    eye: mixPoint(a.eye, b.eye, t), target: mixPoint(a.target, b.target, t),
    cue: { visible: discrete.cue.visible, position: mixPoint(a.cue.position, b.cue.position, t),
      yaw: a.cue.yaw + yaw * t, pitch: a.cue.pitch + (b.cue.pitch - a.cue.pitch) * t },
    balls: a.balls.map((ball, index) => {
      const next = b.balls[index], qa = ball.renderOrientation, qb = next.renderOrientation;
      const rotation = B.Quaternion.Slerp(new B.Quaternion(qa.x, qa.y, qa.z, qa.w), new B.Quaternion(qb.x, qb.y, qb.z, qb.w), t).normalize();
      return { ...discrete.balls[index], position: ball.position.clone().lerp(next.position, t),
        renderPosition: mixPoint(ball.renderPosition, next.renderPosition, t),
        renderOrientation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } };
    }) };
}
