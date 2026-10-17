import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { CollisionPolygon, MeshEdge } from "../../src/core/physics/collision-polygon.js";
import { ObjectPool, type PoolHost } from "../../src/core/physics/pool.js";
import { Island } from "../../src/core/physics/island.js";
import { ActiveContactSet } from "../../src/core/physics/actings.js";
import { ContactSS, ContactSP } from "../../src/core/physics/index.js";

const EPS = 1e-6;

function makeSSContact(a: BodySphere, b: BodySphere): ContactSS {
  const contact = new ContactSS(null, -1);
  contact.resetWithBiBj(a, b);
  contact.resetRestingWithPeneNormal(0, new Vec3(1, 0, 0));
  return contact;
}

function makeSPContact(ball: BodySphere, poly: CollisionPolygon): ContactSP {
  const contact = new ContactSP(null, -1);
  contact.resetWithBiBj(ball, poly as unknown as Parameters<ContactSS["resetWithBiBj"]>[1] & { uid: number } as never);
  return contact;
}

/** 简单地面多边形：normal (0,1,0)，正方形。 */
function makeGroundPoly(): CollisionPolygon {
  const p = (x: number, z: number) => new Vec3(x, 0.88, z);
  return new CollisionPolygon(new Vec3(0, 1, 0), [
    new MeshEdge(p(0, 0), p(1, 0)),
    new MeshEdge(p(1, 0), p(1, 1)),
    new MeshEdge(p(1, 1), p(0, 1)),
    new MeshEdge(p(0, 1), p(0, 0))
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Island（PCOL L14170 原模 93）", () => {
  it("activate/setEntry/push/remove/merge 计数链手术", () => {
    const host: PoolHost = { freeIndex: vi.fn() };
    const island = new Island(host, 3);
    island.activate();
    expect(island.inUse).toBe(true);

    const a = { next: null, prev: null } as ContactSS;
    const b = { next: null, prev: null } as ContactSS;
    const c = { next: null, prev: null } as ContactSS;
    island.setEntry(a);
    expect(island.totalItems).toBe(1);
    expect(island.dirty).toBe(true);
    island.push(b);
    island.push(c);
    expect(island.totalItems).toBe(3);
    expect(island.itemTail).toBe(c);
    expect(c.next).toBeNull();
    // 摘除 b
    island.remove(b);
    expect(island.totalItems).toBe(2);
    expect(a.next).toBe(c);
    expect(c.prev).toBe(a);
    expect(b.prev).toBeNull();
    expect(b.next).toBeNull();
    // 合并：b 组件（含 d/e）
    const d = { next: null, prev: null } as ContactSS;
    const host2: PoolHost = { freeIndex: vi.fn() };
    const island2 = new Island(host2, 4);
    island2.setEntry(b);
    island2.push(d);
    island.merge(island2);
    expect(island.totalItems).toBe(4);
    expect(island.itemTail).toBe(d);
    // 移除尾部
    island.remove(d);
    expect(island.totalItems).toBe(3);
    island.free();
    expect(island.itemEntry).toBeNull();
    expect(host.freeIndex).toHaveBeenCalledWith(3);
  });

  it("getGroundContact：非 SS 且 bj.ground 的现有接触优先", () => {
    const island = new Island({ freeIndex: vi.fn() }, 0);
    const ballContact = { isSS: true, idi: 9, next: null, prev: null, bj: { ground: true } } as unknown as ContactSS;
    const groundContact = { isSS: false, idi: 9, next: null, prev: null, bj: { ground: true } } as unknown as ContactSS;
    island.setEntry(ballContact);
    island.push(groundContact);
    expect(island.getGroundContact(9)).toBe(groundContact);
  });
});

describe("ObjectPool（PCOL L11708 原模 38）", () => {
  it("acquire：freed 栈 LIFO 回收", () => {
    const pool = new ObjectPool("t", Island, 2);
    const i0 = pool.indexAt(0);
    pool.freeIndex(0);
    expect(pool.acquire()).toBe(i0);
  });

  it("acquire：栈空时循环扫描，再无命中扩容 + WARN", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = new ObjectPool("t", Island, 2);
    expect(pool.size).toBe(2);
    pool.acquire();
    pool.acquire();
    pool.acquire(); // 全占用 → 扩容 floor(2/3)+1 = 1 项（min(2,1)）
    expect(pool.size).toBe(3);
    expect(warn).toHaveBeenCalledWith(`::: POOL EXPANDED ::: 3(t)`);
    // nInUse
    expect(pool.nInUse).toBe(3);
  });

  it("freeAll：全员回收 + 指针复位", () => {
    const pool = new ObjectPool("t", Island, 4);
    pool.acquire();
    pool.acquire();
    pool.freeAll();
    expect(pool.nInUse).toBe(0);
    expect(pool.poolIndex).toBe(-1);
  });
});

describe("ContactSP（PCOL L14110 原模 92）", () => {
  it("默认 CP 法线：无 custom 时 = bi.position − contactPoint 归一", () => {
    const ball = new BodySphere(1, 1, 0.5, 1.38, 0.5);
    const poly = makeGroundPoly();
    const contact = makeSPContact(ball, poly);
    contact.resetRestingWithPeneCP(-0.02, new Vec3(0.5, 0.88, 0.5));
    const normal = contact.normal;
    expect(normal.x).toBeCloseTo(0, 12);
    expect(normal.y).toBeCloseTo(1, 12);
    expect(normal.z).toBeCloseTo(0, 12);
    expect(contact.penetration).toBe(-0.02);
  });

  it("退化情形：接触点≈球心 → 回退 poly.normal", () => {
    const ball = new BodySphere(1, 1, 0.5, 0.88, 0.5); // 球心就在接触点上
    const poly = makeGroundPoly();
    const contact = makeSPContact(ball, poly);
    contact.resetRestingWithPeneCP(-1, new Vec3(0.5, 0.88, 0.5));
    expect(contact.normal).toEqual({ x: 0, y: 1, z: 0 }); // poly normal
  });

  it("customNormalHandler 通道", () => {
    const ball = new BodySphere(1, 1, 0.5, 1.38, 0.5);
    const poly = makeGroundPoly();
    poly.hasCustomNormalHandler = true;
    poly.customNormalHandler = (cp, out) => {
      out.set(0.6, 0.8, 0); // 模拟 nt 法线图注入
      void cp;
    };
    const contact = makeSPContact(ball, poly);
    contact.resetRestingWithPeneCP(-0.02, new Vec3(0.7, 0.9, 0.2));
    expect(contact.normal).toEqual({ x: 0.6, y: 0.8, z: 0 });
    expect(contact.contactPoint).toEqual({ x: 0.7, y: 0.9, z: 0.2 });
  });

  it("pending 装填：toi/pene/cdRound/life；法线同值不触发相关脏", () => {
    const ball = new BodySphere(1, 1, 1.5, 1.38, 0.5);
    ball.cdRound = 7;
    const poly = makeGroundPoly();
    const contact = makeSPContact(ball, poly);
    // 预置接触法线与装填法线同值 → 装填不应触发相关脏
    const self = contact as unknown as { _normal: Vec3; normalDirty: boolean; impulseTransformDirty: boolean };
    self._normal.set(0, 1, 0);
    self.normalDirty = false;
    self.impulseTransformDirty = false;
    contact.resetRestingWithPeneNormal(0, new Vec3(0, 1, 0));
    expect(self.impulseTransformDirty).toBe(false); // 同值 → 不置相关脏
    expect(self.normalDirty).toBe(false);
    // pending CP：contactPoint 更新 + markNormalDirty
    contact.resetPendingWithToiPeneCP(ball, poly, 0.25, -0.3, new Vec3(1.2, 0.88, 0.5));
    expect(contact.toi).toBe(0.25);
    expect(contact.penetration).toBe(-0.3);
    expect(contact.contactPoint).toEqual({ x: 1.2, y: 0.88, z: 0.5 });
    expect(self.normalDirty).toBe(true);
  });

  it("updateForceArm：单侧（I），armLen = 球半径", () => {
    const ball = new BodySphere(2, 1, 2, 0, 0);
    const poly = makeGroundPoly();
    const contact = makeSPContact(ball, poly);
    contact.resetRestingWithPeneNormal(0, new Vec3(1, 0, 0));
    contact.markNormalDirty();
    expect(contact.armLenI).toBe(2);
    expect(contact.armI.x).toBe(-2);
  });
});

describe("ActiveContactSet（PCOL L14264 原模 94）", () => {
  function makeSet(capacity = 4): ActiveContactSet {
    const set = new ActiveContactSet(capacity);
    set.resize(11, 5);   // 多边形 uid 0-4，球 uid 5-10
    return set;
  }

  it("resize/freeAll 清零；初始 isResting 全 false", () => {
    const set = makeSet();
    expect(set.isResting(5, 0)).toBe(false);
    expect(set.nIslands).toBe(0);
    expect(set.height).toBe(6);
    expect(set.ssIdStart).toBe(5);
  });

  it("SP 接触：按球建岛；SS 合并双岛；remove 降计数", () => {
    const ballA = new BodySphere(1, 1, 2, 0, 0); // uid 5
    const ballB = new BodySphere(1, 1, 0, 0, 0); // uid 6
    ballA.uid = 5;
    ballB.uid = 6;
    const set = makeSet();

    // SP：A-地面(3)
    set.add(makeSPContact(ballA, groundPoly(3)));
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(1);
    expect(set.isResting(5, 3)).toBe(true);
    expect(set.getIslandByIdi(5)).not.toBeNull();
    expect(set.getIslandByIdi(6)).toBeNull(); // B 无岛

    // SS：A-B（同球已有一接触 → push 到 A 岛）
    set.add(makeSSContact(ballA, ballB));
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(2);
    expect(set.getNContacts(5)).toBe(2); // A:1(SP)+1(SS)
    expect(set.getNContacts(6)).toBe(1);
    expect(set.isResting(6, 5)).toBe(true);
    expect(set.isResting(5, 6)).toBe(true);
    expect(set.getIslandByIdi(6)).toBe(set.getIslandByIdi(5)); // 同岛

    // remove SS 接触 → B 计数归零 idMap 清位
    const ss = set.getIslandByIdi(5)!.itemEntry!.next!;
    set.remove(ss, true);
    expect(set.totalItems).toBe(1);
    expect(set.getNContacts(6)).toBe(0);
    expect(set.getIslandByIdi(6)).toBeNull();
    expect(set.isResting(6, 5)).toBe(false);
  });

  it("removeAllContactsWithId：三球链移除中间球清三行；J 侧计数联动 idMap", () => {
    const a = new BodySphere(1, 1, 0, 0, 0);
    const b = new BodySphere(1, 1, 1, 0, 0);
    const c = new BodySphere(1, 1, 2, 0, 0);
    a.uid = 5; b.uid = 6; c.uid = 7;
    const set = makeSet();
    const ab = makeSSContact(a, b);
    const bc = makeSSContact(b, c);
    set.add(ab);
    set.add(bc);
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(2);

    set.removeAllContactsWithId(6); // 移除 B

    expect(set.totalItems).toBe(0);
    expect(set.nIslands).toBe(0);
    expect(set.getIslandByIdi(5)).toBeNull();
    expect(set.getIslandByIdi(7)).toBeNull();
    expect(set.getNContacts(5)).toBe(0);
    expect(set.getNContacts(6)).toBe(0);
    expect(set.getNContacts(7)).toBe(0);
    expect(set.entry).toBeNull();
  });

  it("needsPure：去除中间接触后的连通分量重切分（原作 isResting 语义：两侧计数不归零才切）", () => {
    // 链 a-b-c-d，四球：a(5) b(6) c(7) d(8)，接触 AB/BC/CD 同岛
    const a = new BodySphere(1, 1, 0, 0, 0);
    const b = new BodySphere(1, 1, 1, 0, 0);
    const c = new BodySphere(1, 1, 2, 0, 0);
    const d = new BodySphere(1, 1, 3, 0, 0);
    a.uid = 5; b.uid = 6; c.uid = 7; d.uid = 8;
    const set = makeSet();
    set.add(makeSSContact(a, b));
    const bc = makeSSContact(b, c);
    set.add(bc);
    set.add(makeSSContact(c, d));
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(3);

    // 移除 BC：a 的计数 1→保持（AB），c 的计数 2→1（CD）→ 两侧未归零 → 需要重切分
    set.remove(bc, true);
    expect(set.needsPure).toBe(true);

    const entry = set.entry; // 触发 __pureIslands
    expect(set.nIslands).toBe(2);
    // 第一岛 = a-b（保留原岛与岛 id）
    expect(entry!.totalItems).toBe(1);
    expect(entry!.itemEntry!.label).toBe("5->6");
    // 第二岛 = c-d（新岛，追加容器尾）
    const second = entry!.next!;
    expect(second.totalItems).toBe(1);
    expect(second.itemEntry!.label).toBe("7->8");
    expect(set.entry === set.tail!.prev);
    // 岛归属：a/b → 第一岛；c/d → 第二岛
    expect(set.getIslandByIdi(5)).toBe(entry);
    expect(set.getIslandByIdi(6)).toBe(entry);
    expect(set.getIslandByIdi(7)).toBe(second);
    expect(set.getIslandByIdi(8)).toBe(second);
  });

  it("SP 球分离多岛；markReupdate 置需要更新的岛 needsUpdate", () => {
    const ballX = new BodySphere(1, 1, 0, 0, 0);
    const ballY = new BodySphere(1, 1, 5, 0, 0);
    ballX.uid = 5; ballY.uid = 6;
    const set = makeSet();
    set.add(makeSPContact(ballX, groundPoly(1)));
    set.add(makeSPContact(ballY, groundPoly(2)));
    expect(set.nIslands).toBe(2);
    set.markReupdate(5);
    expect(set.getIslandByIdi(5)!.needsUpdate).toBe(true);
    expect(set.getIslandByIdi(6)!.needsUpdate).toBe(false);
  });

  it("__pureIsland 拆分：5 球回字链 remove 一接触后仍为一个连通岛（原作 L14519-14535 推进语义）", () => {
    // 最小复现（曾因二遍搬移提前捕获 nextScan 而错拆为两岛）：接触按 A-B、D-E、C-D、B-C 加入
    const set = makeSet();
    const A = new BodySphere(1, 1, 0, 0, 0); A.uid = 5;
    const B = new BodySphere(1, 1, 0, 0, 0); B.uid = 6;
    const C = new BodySphere(1, 1, 0, 0, 0); C.uid = 7;
    const D = new BodySphere(1, 1, 0, 0, 0); D.uid = 8;
    const E = new BodySphere(1, 1, 0, 0, 0); E.uid = 9;
    set.add(makeSSContact(A, B));
    set.add(makeSSContact(D, E));
    set.add(makeSSContact(C, D));
    set.add(makeSSContact(B, C));
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(4);
    // 移除 A-B → 岛剩 D-E/C-D/B-C（仍全连通）→ needsPure 重切分
    const removed = set.getIslandByIdi(5)!.itemEntry!;
    set.remove(removed, true);
    expect(set.nIslands).toBe(1);        // 不可拆成两岛
    expect(set.totalItems).toBe(3);
    expect(set.getNContacts(5)).toBe(0); // A 无接触
    expect(set.getNContacts(6)).toBe(1); // B-C
    expect(set.getNContacts(7)).toBe(2); // B-C + C-D
    expect(set.getNContacts(8)).toBe(2); // C-D + D-E
    expect(set.getNContacts(9)).toBe(1); // D-E
  });
});

const groundPolyCache: Record<number, CollisionPolygon> = {};
function groundPoly(uid: number): CollisionPolygon {
  if (!groundPolyCache[uid]) {
    const poly = makeGroundPoly();
    groundPolyCache[uid] = poly;
  }
  const poly = groundPolyCache[uid];
  poly.uid = uid;
  return poly;
}
