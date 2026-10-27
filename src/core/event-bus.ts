import type { ImpactEvent } from "./simulator/impact.js";

export interface ContactEvent {
  label: string;
  speeds: readonly [number, number];
  isSS: boolean;
}

export interface FoulEvent {
  foulCode: number;
  description: string;
  score: number;
}

export interface BallOnChangedEvent {
  ballOn: number;
  inHand: 0 | 1 | 2;
}

export interface FrameEvents {
  potted: readonly number[];
  respotted: readonly number[];
  [extra: string]: unknown;
}

export interface StateChangeEvent {
  from: number;
  to: number;
}

export interface EventPayloads {
  'sim/impact': ImpactEvent;
  'sim/shooting-start': { playerIndex: number };
  'sim/touch-presolve': ContactEvent;
  'sim/out-of-bounds': { ballIndex: number; ballNumber: number };
  'ai/shot': undefined;
  'ctrl/state-change-start': StateChangeEvent;
  'ctrl/state-change-end': StateChangeEvent;
  'game/ball-on-changed': BallOnChangedEvent;
  'game/foul': FoulEvent;
  'game/frame-events': FrameEvents;
}

export type EventName = keyof EventPayloads;

type Listener<K extends EventName> = (payload: EventPayloads[K]) => void;

type AnyListener = Listener<EventName>;

export class EventBus {
  private readonly _listeners = new Map<EventName, Set<AnyListener>>();

  on<K extends EventName>(name: K, listener: Listener<K>): () => void {
    let set = this._listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(listener as AnyListener);
    return () => this.off(name, listener);
  }

  off<K extends EventName>(name: K, listener: Listener<K>): void {
    const set = this._listeners.get(name);
    if (set === undefined) return;
    set.delete(listener as AnyListener);
    if (set.size === 0) this._listeners.delete(name);
  }

  emit<K extends EventName>(name: K, payload: EventPayloads[K]): void {
    const set = this._listeners.get(name);
    if (set === undefined) return;
    for (const listener of Array.from(set)) {
      (listener as Listener<K>)(payload);
    }
  }
}
