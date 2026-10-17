import { describe, expect, it } from "vitest";
import { BodySphere } from "../../src/core/physics/ball.js";
import { ContactSS } from "../../src/core/physics/contact.js";
import { ScenePendings } from "../../src/core/physics/pendings.js";

// PCOL L14006-14112（原模 91）。栈底基线对齐：构造后 contact.cdRoundI = bi.cdRound（isOutdated 假）。
const T_REMAINING = 0.0167;

function makeContact(): ContactSS {
  const bi = new BodySphere(1, 1, 0, 0, 0);
  const bj = new BodySphere(1, 1, 2, 0, 0);
  bi.uid = 10;
  bj.uid = 11;
  const contact = new ContactSS(null, -1);
  contact.resetWithBiBj(bi, bj);
  // 模 37 resetPending 语义：cdRound 基线同步（isOutdated = false）
  contact.cdRoundI = bi.cdRound;
  contact.cdRoundJ = bj.cdRound;
  return contact;
}

describe("ScenePendings（PCOL L14006-14112）", () => {
  it("add 置脏 → step2 触发 resort；降序弹簇窗口 = 最早+tPrecision", () => {
    const pendings = new ScenePendings();
    const c1 = makeContact();
    const c2 = makeContact();
    const c3 = makeContact();
    c1.toi = 0.01;
    c2.toi = 0.008;
    c3.toi = 0.005;
    pendings.add(c1);
    pendings.add(c2);
    pendings.add(c3);
    const out: ContactSS[] = [];
    const stepped = pendings.step2(T_REMAINING, out);
    // resort 降序 [0.01, 0.008, 0.005] → 尾扫：0.005 ≤ T 弹出，窗口收窄 0.0053 → 0.008 越窗 break
    expect(out.length).toBe(1);
    expect(out[0].toi).toBeCloseTo(0.005, 10);
    expect(stepped).toBeCloseTo(0.005, 10);
    // 栈内剩余推进时间轴（toi −= t, life += t）
    expect(c2.toi).toBeCloseTo(0.003, 10);
    expect(c2.life).toBeCloseTo(0.005, 10);
    expect(c1.toi).toBeCloseTo(0.005, 10);
    // 弹出项不在栈内
    expect(pendings.length).toBe(2);
  });

  it("同撞刻簇（间距 ≤ tPrecision）全弹且推进量 = 组内最大（e[last] 怪癖）", () => {
    const pendings = new ScenePendings();
    const c1 = makeContact();
    const c2 = makeContact();
    c1.toi = 0.0051;
    c2.toi = 0.005;
    pendings.add(c1);
    pendings.add(c2);
    const out: ContactSS[] = [];
    const stepped = pendings.step2(T_REMAINING, out);
    expect(out.length).toBe(2);
    expect(out[0].toi).toBeCloseTo(0.005, 10); // 栈尾 = 最小先弹
    expect(out[1].toi).toBeCloseTo(0.0051, 10);
    expect(stepped).toBeCloseTo(0.0051, 10); // 怪癖：取组内最大
    expect(pendings.length).toBe(0);
  });

  it("越界窗：step2 返回 remaining 本身且无弹出", () => {
    const pendings = new ScenePendings();
    const c1 = makeContact();
    c1.toi = 0.1; // > T
    pendings.add(c1);
    const out: ContactSS[] = [];
    const stepped = pendings.step2(T_REMAINING, out);
    expect(out.length).toBe(0);
    // 无弹出 → t 保持 remaining；且 toi −= t、life += t（推进面向 World 完整步进）
    expect(stepped).toBe(T_REMAINING);
    expect(c1.toi).toBeCloseTo(0.1 - T_REMAINING, 10);
    expect(c1.life).toBeCloseTo(T_REMAINING, 10);
  });

  it("空栈：step2 返回 remaining 原值", () => {
    expect(new ScenePendings().step2(T_REMAINING, [])).toBe(T_REMAINING);
  });

  it("removeAllSS：SS 全释放、非 SS 保序换栈", () => {
    const pendings = new ScenePendings();
    const ss = makeContact();
    const pseudoSP = makeContact();
    (pseudoSP as unknown as { isSS: boolean }).isSS = false;
    pendings.add(ss);
    pendings.add(pseudoSP);
    pendings.removeAllSS();
    expect(ss.bi).toBeNull(); // SS 已 free
    expect(pendings.length).toBe(1); // SP 换栈保留
  });

  it("outdateAllSSWithId 标记 killed → 下一轮 resort 弹出释放", () => {
    const pendings = new ScenePendings();
    const c1 = makeContact();
    c1.toi = 0.005;
    pendings.add(c1);
    pendings.outdateAllSSWithId(10);
    expect(c1.markedAsKilled).toBe(true);
    pendings.step2(T_REMAINING, []);
    expect(pendings.length).toBe(0);
  });
});
