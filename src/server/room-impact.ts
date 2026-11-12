import type { Simulator } from "../core/simulator/simulator.js";
import type { ImpactEvent } from "../core/simulator/impact.js";
import type { ServerEvent } from "../net/protocol.js";

export class RoomImpact {
  private readonly off: () => void;
  private pending: ImpactEvent[] = [];
  constructor(simulator: Simulator) {
    this.off = simulator.onImpact(event => { if (this.pending.length < 256) this.pending.push({ ...event }); });
  }
  drain(shotId: string): ServerEvent[] {
    const events = this.pending.map(impact => ({ type: "shot-impact" as const, shotId, impact }));
    this.pending = [];
    return events;
  }
  dispose(): void { this.off(); this.pending = []; }
}
