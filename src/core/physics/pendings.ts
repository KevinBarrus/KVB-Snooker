import { PHYSICS } from "./constants.js";
import type { ContactBase } from "./contact.js";

// PCOL L14006-14112（原模 91）：待处理接触集合。双栈 swap + 撞击时刻相近的接触分簇弹出。
export class ScenePendings {
  static TOISorter = (t: ContactBase, e: ContactBase): number => {
    const d = e.toi - t.toi;
    return d !== 0 ? d : e.penetration - t.penetration;
  };

  private __stack1: ContactBase[] = [];
  private __stack2: ContactBase[] = [];
  stack = this.__stack1;
  idleStack = this.__stack2;
  private __stackOrderDirty = false;

  get length(): number {
    return this.stack.length;
  }

  freeAll(): void {
    const stack = this.stack;
    for (let i = 0, n = stack.length; i !== n; ++i) stack[i].free();
    stack.length = 0;
    this.__stackOrderDirty = false;
  }

  add(contact: ContactBase): void {
    contact.markedAsKilled = false;
    this.__stackOrderDirty = true;
    this.stack.push(contact);
  }

  /** SS 全部释放，剩余 SP 换栈保留（无序；保序由下一轮 resort 恢复）。 */
  removeAllSS(): void {
    const stack = this.stack;
    const idle = this.idleStack;
    let s = -1;
    for (let i = 0, n = stack.length; i !== n; ++i) {
      const contact = stack[i];
      if (contact.isSS) contact.free();
      else idle[++s] = contact;
    }
    stack.length = 0;
    this.stack = idle;
    this.idleStack = stack;
  }

  outdateAllSSWithId(uid: number): void {
    const stack = this.stack;
    for (let i = 0, n = stack.length; i !== n; ++i) {
      const contact = stack[i];
      if (contact.isSS && (contact.idi === uid || contact.idj === uid)) {
        contact.markedAsKilled = true;
      }
    }
  }

  resort(): void {
    this.__stackOrderDirty = false;
    const stack = this.stack;
    const idle = this.idleStack;
    let s = -1;
    for (let i = 0, n = stack.length; i !== n; ++i) {
      const contact = stack[i];
      if (contact.isOutdated()) contact.free();
      else idle[++s] = contact;
    }
    stack.length = 0;
    idle.sort(ScenePendings.TOISorter);
    this.stack = idle;
    this.idleStack = stack;
  }

  /**
   * 从栈尾（脏栈 resort 后按 TOISorter、干净栈按插入序的退化扫描）弹出
   * "同撞刻组"（toi ≤ min(remaining, 最早+tPrecision) 的全部接触）入 out，
   * 返回推进时长：非空组 = 组内最大 toi（e[out.length−1]，原作怪癖）；
   * 空组 = remaining 本身。弹出后对栈内剩余接触推进时间轴（toi −= t，life += t）。
   */
  step2(t: number, out: ContactBase[]): number {
    let h = t;
    let popped = false;
    let index = this.stack.length; // 扫描下标（原作 a）
    let liveCount = index;         // 剩余计数（原作 n）——与扫描下标分离
    if (this.__stackOrderDirty) {
      this.resort();
      const sorted = this.stack;
      index = liveCount = sorted.length;
      while (index > 0) {
        const contact = sorted[--index];
        if (contact.toi > h) break;
        out.push(contact);
        liveCount--;
        if (!popped) {
          popped = true;
          h = Math.min(t, contact.toi + PHYSICS.tPrecision);
        }
      }
    } else {
      while (index > 0) {
        const contact = this.stack[--index];
        if (contact.isOutdated()) {
          contact.free();
          liveCount--;
          continue;
        }
        if (contact.toi > h) break;
        out.push(contact);
        liveCount--;
        if (!popped) {
          popped = true;
          h = Math.min(t, contact.toi + PHYSICS.tPrecision);
        }
      }
    }
    this.stack.length = liveCount;
    if (out.length !== 0) t = out[out.length - 1].toi;
    if (t > 0) {
      const rest = this.stack; // resort 可能已换栈：扫当前实效栈
      for (let i = 0, n = rest.length; i !== n; ++i) {
        rest[i].toi -= t;
        rest[i].life += t;
      }
    }
    return t;
  }
}
