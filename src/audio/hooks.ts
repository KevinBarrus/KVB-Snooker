import type { EventBus } from "../core/event-bus.js";
import { mixContact, noOpSoundBackend, type SoundBackend } from "./mixer.js";

export class AudioHooks {
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly backend: SoundBackend = noOpSoundBackend) {}

  attach(bus: EventBus): void {
    this.detach();
    this.disposers.push(
      bus.on("sim/touch-presolve", contact => {
        const decision = mixContact(contact);
        if (decision.volume > 0) this.backend.play(decision);
      }),
      bus.on("sim/out-of-bounds", () => {
        this.backend.play({ sound: "out-of-bounds", volume: 1 });
      }),
      bus.on("game/foul", ({ foulCode }) => {
        if (foulCode !== 0) this.backend.play({ sound: "foul", volume: 1 });
      })
    );
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }
}
