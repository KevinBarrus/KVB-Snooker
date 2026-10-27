import type { EventBus } from "../core/event-bus.js";
import { mixContact, noOpSoundBackend, type SoundBackend } from "./mixer.js";
import type { SampleMixer } from "./sample-mixer.js";

export class AudioHooks {
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly backend: SoundBackend = noOpSoundBackend, private readonly samples?: SampleMixer) {}

  attach(bus: EventBus): void {
    this.detach();
    if (this.samples) {
      this.disposers.push(bus.on("sim/impact", event => {
        const decision = this.samples!.mix(event);
        if (decision) this.backend.play(decision);
      }));
      return;
    }
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
