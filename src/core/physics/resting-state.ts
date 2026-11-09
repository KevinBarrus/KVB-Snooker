import { Vec3 } from "../math/vec3.js";
import { Matrix3 } from "../math/matrix3.js";
import { ContactBase, ContactSS } from "./contact.js";
import { ContactSP } from "./sp-contact.js";
import type { ActiveContactSet } from "./actings.js";
import type { ObjectPool } from "./pool.js";
import type { Body } from "./body.js";
import type { MeshBody } from "./mesh-body.js";

type CacheValue = number | boolean | null | number[];
export interface RestingContactState {
  readonly isSS: boolean;
  readonly idi: number;
  readonly idj: number;
  readonly cache: Readonly<Record<string, CacheValue>>;
}
export interface RestingIslandState {
  readonly dirty: boolean;
  readonly needsUpdate: boolean;
  readonly contacts: readonly RestingContactState[];
}

const omitted = new Set(["poolIndex", "inUse", "isSS", "idi", "idj"]);

function contactCache(contact: ContactBase): Record<string, CacheValue> {
  const result: Record<string, CacheValue> = {};
  const fields: [string, unknown][] = Object.entries(contact);
  for (const [key, value] of fields) {
    if (omitted.has(key)) continue;
    if (typeof value === "number") result[key] = Number.isNaN(value) ? null : value === 0 ? 0 : value;
    else if (typeof value === "boolean") result[key] = value;
    else if (value instanceof Vec3) result[key] = [value.x, value.y, value.z].map(number => number === 0 ? 0 : number);
    else if (value instanceof Matrix3) result[key] = Array.from(value.data, number => number === 0 ? 0 : number);
  }
  return result;
}

function restoreCache(contact: ContactBase, cache: Readonly<Record<string, CacheValue>>): void {
  for (const [key, value] of Object.entries(cache)) {
    const target: unknown = Reflect.get(contact, key);
    if (Array.isArray(value)) {
      if (target instanceof Vec3) target.set(value[0], value[1], value[2]);
      else if (target instanceof Matrix3) target.data.set(value);
    } else Reflect.set(contact, key, value === null ? NaN : value);
  }
}

export function captureResting(actings: ActiveContactSet): RestingIslandState[] {
  const result: RestingIslandState[] = [];
  for (let island = actings.entry; island; island = island.next) {
    const contacts: RestingContactState[] = [];
    for (let contact = island.itemEntry; contact; contact = contact.next) {
      contacts.push({ isSS: contact.isSS, idi: contact.idi, idj: contact.idj, cache: contactCache(contact) });
    }
    result.push({ dirty: island.dirty, needsUpdate: island.needsUpdate, contacts });
  }
  return result;
}

function check(condition: boolean): asserts condition {
  if (!condition) throw new Error("Invalid resting contact checkpoint");
}
function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function readResting(value: unknown, ballCount: number, polygonCount: number): RestingIslandState[] {
  check(Array.isArray(value) && value.length <= ballCount);
  const seen = new Set<string>();
  const usedBalls = new Set<number>();
  const templates = [contactCache(new ContactSP(null, 0)), contactCache(new ContactSS(null, 0))];
  return value.map(entry => {
    const island = object(entry);
    check(typeof island.dirty === "boolean" && typeof island.needsUpdate === "boolean" &&
      Array.isArray(island.contacts) && island.contacts.length > 0 && island.contacts.length <= 4096);
    const contacts = island.contacts.map(item => {
      const contact = object(item);
      const { idi, idj, isSS } = contact;
      check(typeof isSS === "boolean" && typeof idi === "number" && Number.isInteger(idi) && idi >= polygonCount && idi < polygonCount + ballCount &&
        typeof idj === "number" && Number.isInteger(idj) && idj >= (isSS ? polygonCount : 0) &&
        idj < (isSS ? polygonCount + ballCount : polygonCount) && idi !== idj);
      const key = isSS ? `${Math.min(idi, idj)}:${Math.max(idi, idj)}` : `${idi}:${idj}`;
      check(!seen.has(key)); seen.add(key);
      const input = object(contact.cache), template = templates[isSS ? 1 : 0];
      check(Object.keys(input).length === Object.keys(template).length);
      const cache: Record<string, CacheValue> = {};
      for (const [key, expected] of Object.entries(template)) {
        const received = input[key];
        if (Array.isArray(expected)) {
          check(Array.isArray(received) && received.length === expected.length && received.every(component => typeof component === "number" && Number.isFinite(component)));
          cache[key] = [...received];
        } else if (typeof expected === "boolean") {
          check(typeof received === "boolean"); cache[key] = received;
        } else {
          check(received === null || typeof received === "number" && Number.isFinite(received));
          cache[key] = received;
        }
      }
      return { isSS, idi, idj, cache };
    });
    const members = new Set(contacts.flatMap(contact => contact.isSS ? [contact.idi, contact.idj] : [contact.idi]));
    check([...members].every(id => !usedBalls.has(id)));
    const connected = new Set([contacts[0].idi]);
    for (let pass = 0; pass < members.size; pass++) {
      for (const contact of contacts) if (contact.isSS && (connected.has(contact.idi) || connected.has(contact.idj))) {
        connected.add(contact.idi); connected.add(contact.idj);
      }
    }
    check(connected.size === members.size);
    members.forEach(id => usedBalls.add(id));
    return { dirty: island.dirty, needsUpdate: island.needsUpdate, contacts };
  });
}

export function restoreResting(data: readonly RestingIslandState[], actings: ActiveContactSet,
  ssPool: ObjectPool<ContactSS>, spPool: ObjectPool<ContactSP>, balls: readonly Body[], mesh: MeshBody): void {
  actings.freeAll(); actings.needsPure = false; ssPool.freeAll(); spPool.freeAll();
  const polygons = mesh.groups.flatMap(group => group.polys);
  for (const saved of data) {
    const contacts = saved.contacts.map(entry => {
      const bi = balls[entry.idi - mesh.nPolygons];
      const contact = entry.isSS ? ssPool.acquire() : spPool.acquire();
      if (contact instanceof ContactSP) {
        contact.resetPendingWithToiPeneNormal(bi, polygons.find(poly => poly.uid === entry.idj)!, 0, 0, Vec3.UNIT_Y);
      } else contact.resetWithBiBj(bi, balls[entry.idj - mesh.nPolygons]);
      actings.add(contact);
      restoreCache(contact, entry.cache);
      return contact;
    });
    const island = actings.getIslandByIdi(contacts[0].idi)!;
    island.itemEntry = contacts[0]; island.itemTail = contacts[contacts.length - 1];
    contacts.forEach((contact, index) => { contact.prev = contacts[index - 1] ?? null; contact.next = contacts[index + 1] ?? null; });
    island.dirty = saved.dirty; island.needsUpdate = saved.needsUpdate;
  }
}
