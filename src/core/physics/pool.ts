/** 池宿主契约（ContactPoolRef 同形，见 contact.ts）。 */
export interface PoolHost {
  freeIndex(poolIndex: number): void;
}

export interface PoolItem {
  inUse: boolean;
  activate(): this;
  free(): void;
  dispose(): void;
}

export type PoolItemCtor<T extends PoolItem> = new (host: PoolHost, index: number) => T;

/** PCOL L11708-11775（原模 38）：对象池——freed 栈重用 + 循环扫描 + 保底扩容。 */
export class ObjectPool<T extends PoolItem> {
  pool: T[] = [];
  freedIndices: Uint16Array;
  freedIndex = -1;
  poolIndex = -1;
  itemCtor: PoolItemCtor<T>;
  maxExpCount: number;
  name: string;

  constructor(name: string, itemCtor: PoolItemCtor<T>, capacity: number) {
    for (let i = 0; i !== capacity; ++i) {
      this.pool[i] = new itemCtor(this, i);
    }
    this.freedIndices = new Uint16Array(capacity);
    this.maxFreedIndex = capacity - 1;
    this.itemCtor = itemCtor;
    this.maxExpCount = Math.max(1, capacity);
    this.name = name;
  }

  /** 容量上界（freed 栈有效区）。 */
  maxFreedIndex: number;

  get size(): number {
    return this.pool.length;
  }

  get nInUse(): number {
    let count = 0;
    for (const item of this.pool) {
      if (item.inUse) count++;
    }
    return count;
  }

  freeIndex(poolIndex: number): void {
    if (this.freedIndex < this.maxFreedIndex) {
      this.freedIndices[++this.freedIndex] = poolIndex;
    }
  }

  dispose(): void {
    for (const item of this.pool) item.dispose();
  }

  indexAt(poolIndex: number): T {
    return this.pool[poolIndex];
  }

  freeAll(): void {
    for (const item of this.pool) item.free();
    this.freedIndex = -1;
    this.poolIndex = -1;
  }

  /** 取回：先走 freed 栈；耗尽后从 poolIndex 循环扫描；再无 → 扩容并 WARN。 */
  acquire(): T {
    if (this.freedIndex !== -1) {
      const item = this.pool[this.freedIndices[this.freedIndex]];
      this.freedIndex--;
      return item.activate();
    }
    for (let i = 0, n = this.pool.length; i !== n; ++i) {
      const item = this.pool[++this.poolIndex % n];
      if (!item.inUse) return item.activate();
    }
    const growFrom = this.pool.length;
    this.poolIndex = growFrom;
    const growCount = Math.min(this.maxExpCount, Math.floor(Math.floor(growFrom / 3) + 1));
    for (let i = 0; i < growCount; ++i) {
      this.pool.push(new this.itemCtor(this, this.pool.length));
    }
    console.warn(`::: POOL EXPANDED ::: ${this.pool.length}(${this.name})`);
    return this.pool[this.poolIndex].activate();
  }

  log(): void {
    console.log(`===== ObjectPool: (${this.pool.length}) =====`);
    for (const item of this.pool) {
      console.log(`\t>inUse: ${item.inUse}: ${String(item)}`);
    }
    console.log("=============================================\n");
  }
}
