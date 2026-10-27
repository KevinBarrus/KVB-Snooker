import type { ContactEvent } from "../core/event-bus.js";
import type { AudioSample } from "./sample-manifest.js";

export interface SoundDecision {
  readonly sound: "tip" | "ball-ball" | "ball-cushion" | "out-of-bounds" | "foul" | "pocket-clean" | "pocket-jaw";
  readonly volume: number;
  readonly sample?: AudioSample;
}

export interface SoundBackend {
  play(decision: SoundDecision): void;
}

export const noOpSoundBackend: SoundBackend = { play() {} };

export function mixContact(contact: Readonly<ContactEvent>): SoundDecision {
  const [speedI, speedJ] = contact.speeds;
  const volume = Number.isFinite(speedI) && Number.isFinite(speedJ)
    ? Math.min(1, Math.max(Math.abs(speedI), Math.abs(speedJ)))
    : 0;

  // PCOL L9426-9428, L13650-13655
  const sound = contact.label === "tip" ? "tip" : contact.isSS ? "ball-ball" : "ball-cushion";
  return { sound, volume };
}
