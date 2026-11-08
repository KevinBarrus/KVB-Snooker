import * as B from "babylonjs/es6.js";
import { TipMotion } from "./controller/tip-motion.js";
import type { Point3 } from "./controller/stick-obstacles.js";
import { validateStrokeVars, type PendingShotView, type SeatIndex, type ServerMessage } from "./net/protocol.js";

const STAND_DELAY_SECONDS = 0.5;
const LIFT_SECONDS = 0.4;

export class RemoteCue {
  readonly position = B.Vector3.Zero();
  readonly rotation = B.Vector3.Zero();
  readonly motion = new TipMotion();
  visible = false;
  struck = false;
  private shotId: string | null = null;
  private active = false;
  private touchAtMs = 0;
  private touchDuration = 0;
  private elapsed = 0;
  private readonly contact = B.Vector3.Zero();
  private readonly direction = B.Vector3.Zero();

  constructor(private readonly radius: number) {}

  receive(message: ServerMessage, seat: SeatIndex | null, cue: Point3): void {
    if (message.type === "snapshot" && message.pendingShot) this.prepare(message.pendingShot, seat, cue);
    if (message.type !== "event") return;
    const event = message.event;
    if (event.type === "shot-prepared") this.prepare(event, seat, cue);
    if (event.type === "shot-cancelled" && event.shotId === this.shotId) this.clear();
  }

  clear(): void {
    this.active = false;
    this.visible = false;
    this.motion.reset();
  }

  update(displayMs: number, cue: Point3): void {
    if (!this.active) return;
    const target = Math.max(0, (displayMs - this.touchAtMs) / 1000 + this.touchDuration);
    let remaining = Math.max(0, target - this.elapsed);
    while (remaining > 0 && this.motion.needsUpdate) {
      const step = this.motion.tick(remaining);
      remaining -= step;
      this.elapsed += step;
      if (step <= 0) break;
    }
    this.motion.updateLength(cue, this.radius);
    this.struck = displayMs >= this.touchAtMs;
    const lift = this.motion.needsUpdate ? 0 :
      Math.max(0, Math.min(1, (target - this.elapsed - STAND_DELAY_SECONDS) / LIFT_SECONDS));
    if (lift >= 1) { this.clear(); return; }
    const eased = lift * lift * (3 - 2 * lift);
    this.direction.scaleToRef(this.motion.length, this.position);
    this.position.addInPlace(this.contact);
    this.position.y += 0.35 * eased;
    this.rotation.set(0, Math.atan2(this.direction.x, this.direction.z) - Math.PI / 2,
      Math.asin(this.direction.y) * (1 - eased) + Math.PI / 2 * eased);
    this.visible = true;
  }

  private prepare(plan: PendingShotView, seat: SeatIndex | null, cue: Point3): void {
    if (seat === null || plan.seat === seat || plan.shotId === this.shotId) return;
    if (validateStrokeVars(plan.vars) || !Number.isFinite(plan.touchAtServerMs)) return;
    this.shotId = plan.shotId;
    this.touchAtMs = plan.touchAtServerMs;
    const vars = plan.vars;
    this.contact.set(vars[0], vars[1], vars[2]);
    this.direction.set(vars[3], vars[4], vars[5]).normalize();
    // PCOL L4882-5484
    const power = Math.max(0, Math.min(1, (Math.sqrt(38.2 ** 2 + 264 * (vars[6] - 1.6)) - 38.2) / 132));
    const toTable = this.direction.y > -1e-6 ? Number.MAX_VALUE :
      -(this.contact.y - cue.y + this.radius - vars[7]) / this.direction.y;
    this.motion.reset();
    this.touchDuration = this.motion.launch({
      kissPoint: this.contact, kissDir: this.direction,
      getTouchSpdWithPower: p => 0.5 + 11 * p,
      getSlowDownDistance: (p, distance) => Math.min(0.015 + p * distance * 0.9, toTable),
      getTipRadius: () => vars[7]
    }, power);
    this.elapsed = 0;
    this.struck = false;
    this.visible = false;
    this.active = true;
  }
}
