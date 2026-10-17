import { ObjectPool } from "./pool.js";
import { Vec3 } from "../math/vec3.js";
import { Island } from "./island.js";
import type { ContactBase } from "./contact.js";

/** 模块级切分缓冲（原作模块级数组 a）。 */
const splitBuffer: Island[] = [];

/**
 * PCOL L14264-14608（原模 94）：活动接触集（cActings）。
 * 结构：岛屿池 + idMap（球行→岛 id）+ restingGrid（[球行][碰撞列]=贴靠计数）+
 * ssIdCounter（每球活动接触数）+ needsPure 惰性连通分量重切分。
 * 行下标 = idi − ssIdStart（仅球，ssIdStart=开局多边形数）；列 = idj（多边形或球 uid）。
 */
export class ActiveContactSet {
  pool: ObjectPool<Island>;
  private __entry: Island | null = null;
  private __tail: Island | null = null;
  private idMap: Int8Array = new Int8Array(0);
  private __pureMap: Int8Array = new Int8Array(0);
  private ssIdCounter: Uint8Array = new Uint8Array(0);
  restingGrid: Uint8Array[] = [];
  width = 0;
  height = 0;
  dataWidth = 0;
  dataHeight = 0;
  ssIdStart = 0;
  nIslands = 0;
  totalItems = 0;
  needsPure = false;
  needsUpdate = false;

  constructor(capacity: number) {
    this.pool = new ObjectPool("island", Island, capacity);
  }

  get entry(): Island | null {
    if (this.needsPure) this.__pureIslands();
    return this.__entry;
  }

  get tail(): Island | null {
    if (this.needsPure) this.__pureIslands();
    return this.__tail;
  }

  /** World._rebuildEnvironment 调用：totalUids=多边形+球数，ssIdStart=多边形数。 */
  resize(totalUids: number, ssIdStart: number): void {
    this.ssIdStart = ssIdStart;
    const rows = totalUids - ssIdStart;
    let rebuilt = false;
    if (rows > this.dataHeight) {
      rebuilt = true;
      this.dataHeight = rows;
      this.idMap = new Int8Array(rows);
      this.__pureMap = new Int8Array(rows);
      this.ssIdCounter = new Uint8Array(rows);
    }
    if (totalUids > this.dataWidth) {
      rebuilt = true;
      this.dataWidth = totalUids;
    }
    if (rebuilt) {
      const grid = this.restingGrid;
      grid.length = 0;
      for (let i = 0; i !== rows; ++i) {
        grid[i] = new Uint8Array(totalUids);
      }
    }
    this.width = totalUids;
    this.height = rows;
    this.freeAll();
  }

  freeAll(): void {
    this.pool.freeAll();
    this.__entry = null;
    this.__tail = null;
    for (let row = 0; row !== this.height; ++row) {
      this.idMap[row] = -1;
    }
    for (let row = 0; row !== this.height; ++row) {
      this.ssIdCounter[row] = 0;
    }
    const grid = this.restingGrid;
    for (let r = 0; r !== this.height; ++r) {
      for (let c = 0; c !== this.width; ++c) {
        grid[r][c] = 0;
      }
    }
    this.nIslands = 0;
    this.totalItems = 0;
    this.needsUpdate = false;
  }

  isResting(idi: number, idj: number): boolean {
    const cell = this.restingGrid[idi - this.ssIdStart][idj];
    if (cell !== 0 && cell !== 1) {
      throw this.log(), new Error(`resting grid error: ${cell}idi,idj: ${idi}->${idj}`);
    }
    return cell !== 0;
  }

  markReupdate(ballUid: number): void {
    if (this.needsPure) this.__pureIslands();
    const island = this.pool.indexAt(this.idMap[ballUid - this.ssIdStart]);
    if (island !== undefined && island !== null) island.needsUpdate = true;
  }

  getNContacts(ballUid: number): number {
    return this.ssIdCounter[ballUid - this.ssIdStart];
  }

  getIslandByIdi(ballUid: number): Island | null {
    const id = this.idMap[ballUid - this.ssIdStart];
    return id !== -1 ? this.pool.indexAt(id) : null;
  }

  add(contact: ContactBase): void {
    contact.markedAsKilled = false;
    if (contact.isSS) this.__addSS(contact);
    else this.__addSP(contact);
    this.totalItems++;
  }

  private pureCheck(): void {
    if (this.needsPure) this.__pureIslands();
  }

  private __addSP(contact: ContactBase): void {
    this.pureCheck();
    const row = contact.idi - this.ssIdStart;
    this.ssIdCounter[row]++;
    this.restingGrid[row][contact.idj]++;
    const id = this.idMap[row];
    if (id !== -1) {
      this.pool.indexAt(id).push(contact);
    } else {
      const island = this.pool.acquire();
      island.setEntry(contact);
      this.idMap[row] = island.id;
      if (this.__tail) {
        this.__tail.next = island;
        island.prev = this.__tail;
        this.__tail = island;
      } else {
        this.__entry = island;
        this.__tail = island;
      }
      this.nIslands++;
    }
  }

  private __addSS(contact: ContactBase): void {
    this.pureCheck();
    const map = this.idMap;
    const rowI = contact.idi - this.ssIdStart;
    const rowJ = contact.idj - this.ssIdStart;
    const idI = map[rowI];
    const idJ = map[rowJ];
    this.ssIdCounter[rowI]++;
    this.ssIdCounter[rowJ]++;
    this.restingGrid[rowI][contact.idj]++;
    this.restingGrid[rowJ][contact.idi]++;
    if (idI !== -1) {
      const islandI = this.pool.indexAt(idI);
      if (idJ !== -1 && idI !== idJ) {
        // 两球属不同岛 → 合并（三联通增量）
        const islandJ = this.pool.indexAt(idJ);
        islandI.merge(islandJ);
        this.__removeIsland(islandJ);
        for (let row = 0; row !== this.height; ++row) {
          if (map[row] === idJ) map[row] = idI;
        }
      } else {
        map[rowJ] = idI;
      }
      islandI.push(contact);
    } else if (idJ !== -1) {
      this.pool.indexAt(idJ).push(contact);
      map[rowI] = idJ;
    } else {
      const island = this.pool.acquire();
      island.setEntry(contact);
      map[rowI] = island.id;
      map[rowJ] = island.id;
      if (this.__tail) {
        this.__tail.next = island;
        island.prev = this.__tail;
        this.__tail = island;
      } else {
        this.__entry = island;
        this.__tail = island;
      }
      this.nIslands++;
    }
  }

  private __removeIsland(island: Island): void {
    const prev = island.prev;
    const next = island.next;
    if (prev) prev.next = next;
    else this.__entry = next;
    if (next) next.prev = prev;
    else this.__tail = prev; // 原作尾=前驱（单岛时为 null）
    this.nIslands--;
    island.free();
  }

  private __pureIslands(): void {
    this.needsPure = false;
    let island = this.__entry;
    for (; island; ) {
      const next = island.next;
      if (island.needsPure) this.__pureIsland(island);
      island = next;
    }
  }

  /** 移除球的全部接触（inactivateBall 路径）；J 侧计数归零时清它的 idMap 位。 */
  removeAllContactsWithId(ballUid: number): void {
    const map = this.idMap;
    const row = ballUid - this.ssIdStart;
    const counters = this.ssIdCounter;
    if (map[row] === -1) {
      if (counters[row] !== 0) {
        throw new Error("HERER>>>>");
      }
      return;
    }
    const island = this.pool.indexAt(map[row]);
    const grid = this.restingGrid;
    let item = island.itemEntry;
    while (item) {
      const next = item.next;
      let otherRow = -1;
      if (item.idi === ballUid) {
        this.totalItems--;
        grid[row][item.idj]--;
        island.remove(item);
        item.free();
        if (item.isSS) {
          otherRow = item.idj - this.ssIdStart;
          grid[otherRow][ballUid]--;
          if (--counters[otherRow] === 0) map[otherRow] = -1;
        }
      } else if (item.idj === ballUid) {
        // idj 是球、idi 是多边形的组合不会出现在此容器（SP 总是 ball idi），原作分支保留
        this.totalItems--;
        grid[row][item.idi]--;
        island.remove(item);
        item.free();
        otherRow = item.idi - this.ssIdStart;
        grid[otherRow][ballUid]--;
        if (--counters[otherRow] === 0) map[otherRow] = -1;
      }
      void otherRow;
      item = next;
    }
    counters[row] = 0;
    map[row] = -1;
    if (island.totalItems === 0) {
      this.__removeIsland(island);
    } else if (island.totalItems > 1) {
      island.needsPure = true;
      this.needsPure = true;
    }
  }

  remove(contact: ContactBase, doFree: boolean): void {
    this.totalItems--;
    const map = this.idMap;
    const row = contact.idi - this.ssIdStart;
    const island = this.pool.indexAt(map[row]);
    const counters = this.ssIdCounter;
    const grid = this.restingGrid;
    island.remove(contact);
    if (contact.isSS) {
      const otherRow = contact.idj - this.ssIdStart;
      let islandAlive = true;
      grid[row][contact.idj]--;
      grid[otherRow][contact.idi]--;
      if (--counters[row] === 0) {
        map[row] = -1;
        islandAlive = false;
      }
      if (--counters[otherRow] === 0) {
        map[otherRow] = -1;
        islandAlive = false;
      }
      if (island.totalItems === 0) this.__removeIsland(island);
      else if (islandAlive) {
        island.needsPure = true;
        this.needsPure = true;
      }
    } else {
      grid[row][contact.idj]--;
      if (--counters[row] === 0) map[row] = -1;
      if (island.totalItems === 0) this.__removeIsland(island);
    }
    if (doFree) contact.free();
  }

  /**
   * 连通分量重切分（原作 L14494-14547 逐行 1:1）。
   * 组件 1 保留原岛（岛 id 不变，链位置不变）；其余组件各得新岛并追加到容器尾。
   */
  private __pureIsland(island: Island): void {
    const pure = this.__pureMap;
    const map = this.idMap;
    const start = this.ssIdStart;
    for (let row = 0; row !== this.height; ++row) {
      pure[row] = -1;
    }
    splitBuffer[0] = island;
    let componentIndex = 0;
    let pending: ContactBase | null = island.itemEntry;
    while (pending) {
      const componentIsland = splitBuffer[componentIndex];
      const componentId = componentIsland.id;
      // —— 连续段扫描 ——
      const seedRow = pending.idi - start;
      pure[seedRow] = componentIndex;
      map[seedRow] = componentId;
      if (pending.isSS) {
        const seedRowJ = pending.idj - start;
        pure[seedRowJ] = componentIndex;
        map[seedRowJ] = componentId;
      }
      let componentEnd = pending;
      let count = 1;
      let scan = pending.next;
      while (scan) {
        const rowI = scan.idi - start;
        const rowJ = scan.idj - start;
        if (pure[rowI] === componentIndex) {
          map[rowI] = componentId;
          if (scan.isSS) {
            pure[rowJ] = componentIndex;
            map[rowJ] = componentId;
          }
          componentEnd = scan;
          count++;
        } else {
          if (pure[rowJ] !== componentIndex) break;
          pure[rowI] = componentIndex;
          map[rowI] = componentId;
          map[rowJ] = componentId;
          componentEnd = scan;
          count++;
        }
        scan = scan.next;
      }
      // —— 二遍搬移：把后段中连着组件的接触搬进组件链尾 ——
      // 原作（L14519-14535）推进用「搬移后 i.next」：搬移把不连通项挤到链尾，残段重扫可终止并回抓；
      // 提前捕获 nextScan 会错过后置连通项（5 球回字用例曾错拆两岛，已冻结）。
      scan = componentEnd.next;
      while (scan) {
        const rowI = scan.idi - start;
        const rowJ = scan.idj - start;
        if (pure[rowI] === componentIndex || pure[rowJ] === componentIndex) {
          pure[rowI] = componentIndex;
          map[rowI] = componentId;
          if (scan.isSS) {
            pure[rowJ] = componentIndex;
            map[rowJ] = componentId;
          }
          scan.prev!.next = scan.next;
          if (scan.next) scan.next.prev = scan.prev;
          if (componentEnd.next) componentEnd.next.prev = scan;
          scan.next = componentEnd.next;
          componentEnd.next = scan;
          scan.prev = componentEnd;
          componentEnd = scan;
          count++;
        }
        scan = scan.next;
      }
      // —— 收束本组件岛（原作顺序：先捕残留，再断链）——
      const leftoverNext = componentEnd.next;
      pending.prev = null;
      componentEnd.next = null;
      componentIsland.itemEntry = pending;
      componentIsland.itemTail = componentEnd;
      componentIsland.totalItems = count;
      componentIsland.needsPure = false;
      // —— 下个组件 ——
      pending = leftoverNext;
      if (pending) {
        const fresh = this.pool.acquire();
        componentIndex++;
        splitBuffer[componentIndex] = fresh;
      }
    }
    for (let i = 1; i <= componentIndex; ++i) {
      const extra = splitBuffer[i];
      this.__tail!.next = extra;
      extra.prev = this.__tail;
      this.__tail = extra;
      extra.dirty = true;
      this.nIslands++;
    }
    splitBuffer.length = 0;
  }

  logPenes(): void {
    let island = this.entry;
    let count = 0;
    for (; island; island = island.next) {
      for (let item = island.itemEntry; item; item = item.next) {
        if (item.penetration < -Vec3.EPSILON) {
          console.log(`pene: ${item.penetration},${item.label}`);
          count++;
        }
      }
    }
    console.log(`pene in island: ${count}`);
  }

  logIslandByIds(ids: number[]): void {
    // 原作调试输出（L14556-14577）：遍历 entry，命中指定 uid 的岛打印
    let island = this.entry;
    const start = this.ssIdStart;
    let text = "";
    let count = 0;
    for (; island; island = island.next) {
      for (let item = island.itemEntry; item; item = item.next) {
        if (ids.indexOf(item.idi - start) !== -1 || ids.indexOf(item.idj - start) !== -1) {
          text += `${island.toString()}\n`;
          count++;
          break;
        }
      }
    }
    console.log(`--- Island List:(${count}) ----------------`);
    console.log(text);
    console.log("/////////////////////////////////////");
  }

  log(): void {
    console.log(`--- Island List:(${this.nIslands}) ----------------`);
    let island = this.entry;
    for (; island; island = island.next) {
      console.log(`\t>${island.toString()}`);
    }
    const counters: string[] = [];
    for (let row = 0; row !== this.height; ++row) {
      if (this.ssIdCounter[row] !== 0) {
        counters.push(`${row + this.ssIdStart}(${this.ssIdCounter[row]})`);
      }
    }
    console.log(`\tcounter: [${counters.join(",")}]`);
    console.log("/////////////////////////////////////");
  }
}
