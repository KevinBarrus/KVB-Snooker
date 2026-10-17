import type { PoolHost } from "./pool.js";
import type { ContactBase } from "./contact.js";

/**
 * PCOL L14170-14263（原模 93）：岛屿——接触链表节点（同岛接触组）。
 */
export class Island {
  weakParent: PoolHost = null!;
  id = -1;
  inUse = false;
  itemEntry: ContactBase | null = null;
  itemTail: ContactBase | null = null;
  next: Island | null = null;
  prev: Island | null = null;
  totalItems = 0;
  dirty = false;
  needsUpdate = false;
  needsPure = false;

  constructor(host: PoolHost, index: number) {
    this.weakParent = host;
    this.id = index;
  }

  activate(): this {
    this.inUse = true;
    return this;
  }

  getGroundContact(ballUid: number): ContactBase | null {
    for (let item = this.itemEntry; item; item = item.next) {
      if (!item.isSS && item.idi === ballUid && (item as unknown as { bj: { ground: boolean } }).bj!.ground) {
        return item;
      }
    }
    return null;
  }

  free(): void {
    this.next = null;
    this.prev = null;
    this.itemEntry = null;
    this.itemTail = null;
    this.totalItems = 0;
    this.inUse = false;
    this.dirty = false;
    this.needsUpdate = false;
    this.needsPure = false;
    this.weakParent.freeIndex(this.id);
  }

  dispose(): void {
    this.weakParent = null!;
    this.next = null;
    this.prev = null;
    this.itemEntry = null;
    this.itemTail = null;
    console.warn("TODO: Island.dispose doesn't confirmed!!!"); // 原作警告保留（L14208）
  }

  setEntry(contact: ContactBase): void {
    contact.next = null;
    contact.prev = null;
    this.itemEntry = this.itemTail = contact;
    this.totalItems = 1;
    this.dirty = true;
  }

  remove(contact: ContactBase): void {
    const prev = contact.prev;
    const next = contact.next;
    if (prev) prev.next = next;
    else this.itemEntry = next;
    if (next) next.prev = prev;
    else this.itemTail = prev;
    this.dirty = true;
    this.totalItems--;
    contact.prev = null;
    contact.next = null;
  }

  push(contact: ContactBase): void {
    this.itemTail!.next = contact;
    contact.prev = this.itemTail;
    contact.next = null;
    this.itemTail = contact;
    this.totalItems++;
    this.dirty = true;
  }

  merge(other: Island): void {
    this.itemTail!.next = other.itemEntry;
    other.itemEntry!.prev = this.itemTail;
    this.itemTail = other.itemTail;
    this.totalItems += other.totalItems;
    this.dirty = true;
  }

  toString(): string {
    let item = this.itemEntry;
    if (item) {
      let text = `Island ${this.id}: {count:${this.totalItems}, items:[${item.label}`;
      for (item = item.next; item; item = item.next) {
        text += `,${item.label}`;
      }
      return `${text}], tail: ${this.itemTail!.label}}`;
    }
    return `Island ${this.id}: {count:0, items:[]}`;
  }
}
