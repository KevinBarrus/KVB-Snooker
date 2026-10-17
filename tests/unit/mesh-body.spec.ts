import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { MeshEdge, CollisionPolygon } from "../../src/core/physics/collision-polygon.js";
import { MeshBody, type CollisionMeshData } from "../../src/core/physics/mesh-body.js";

const TABLE_JSON = new URL("../../analysis/tiger-club-sno-rgb.json", import.meta.url).pathname;

/** 合成小台面：ground + side 两分区；验证边共享/反向克隆/包围球/旗标查表。 */
function syntheticTable(): CollisionMeshData {
  // 正方形台面 + 一条竖直软库（۴边形）
  return {
    ground: {
      p: [0, 0.88, 0, 1, 0.88, 0, 1, 0.88, 1, 0, 0.88, 1],
      q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
    },
    side: {
      p: [
        -0.1, 0.92, 0.4,
        1.1, 0.92, 0.4,
        1.1, 0.6, 0.4,
        -0.1, 0.6, 0.4
      ],
      q: [
        { i: [0, 1, 2, 3], n: [0, 0, 1], f: ["sidesoft"], s: [0.5, 0.76, 0.4, 0.79], uv: [0, 0, 1, 0, 1, 1, 0, 1] }
      ]
    }
  };
}

describe("MeshEdge（PCOL L13453）", () => {
  it("vab/abDotAb/共享计数与反向克隆", () => {
    const va = new Vec3(0, 0, 0);
    const vb = new Vec3(3, 4, 0);
    const edge = new MeshEdge(va, vb);
    expect(edge.vab).toEqual({ x: 3, y: 4, z: 0 });
    expect(edge.abDotAb).toBe(25);
    const shared = edge.sharedData;
    const reversed = edge.cloneReversed();
    expect(reversed).not.toBe(edge);
    expect(reversed.va).toBe(vb);
    expect(reversed.vb).toBe(va);
    expect(reversed.sharedData).toBe(shared); // 反向共享同一份
    expect(shared.count).toBe(2); // 两次构造各 +1
  });
});

describe("CollisionPolygon（PCOL L13360）", () => {
  it("edgeXNormals = vab × normal", () => {
    const normal = new Vec3(0, 1, 0);
    const edges = [
      new MeshEdge(new Vec3(0, 0.88, 0), new Vec3(1, 0.88, 0)),
      new MeshEdge(new Vec3(1, 0.88, 0), new Vec3(1, 0.88, 1)),
      new MeshEdge(new Vec3(1, 0.88, 1), new Vec3(0, 0.88, 1)),
      new MeshEdge(new Vec3(0, 0.88, 1), new Vec3(0, 0.88, 0))
    ];
    const poly = new CollisionPolygon(normal, edges);
    expect(poly.a).toBe(0);
    expect(poly.b).toBe(1);
    expect(poly.c).toBe(0);
    expect(poly.d).toBeCloseTo(-0.88, 12);
    expect(poly.centerPosition).toEqual({ x: 0.5, y: 0.88, z: 0.5 });
    expect(poly.edgeXNormals[0]).toEqual({ x: 0, y: 0, z: 1 }); // (1,0,0)×Y
    expect(poly.distanceFromPointToPlane(new Vec3(0, 2, 0))).toBeCloseTo(1.12, 12);
  });

  it("size 顶点 bbox：原作 maxX 从 0 起算（负区间面会算大，1:1 保留）", () => {
    const poly = new CollisionPolygon(
      new Vec3(0, 0, 1),
      [
        new MeshEdge(new Vec3(-2, 0, 0), new Vec3(-1, 0, 0)),
        new MeshEdge(new Vec3(-1, 1, 0), new Vec3(-2, 1, 0))
      ]
    );
    // max 起点 0：全负坐标时 maxX 停在 0 → size.x = 0 − (−2) = 2（原作行为）
    expect(poly.size.x).toBe(2);
    expect(poly.size.y).toBe(1);
    expect(poly.size.z).toBe(0);
  });

  it("toStringShort 布位与碰撞组", () => {
    const poly = new CollisionPolygon(new Vec3(0, 1, 0), [
      new MeshEdge(new Vec3(0, 0, 0), new Vec3(1, 0, 0))
    ]);
    poly.sidehard = true;
    poly.collisionGroup = 4;
    expect(poly.toStringShort()).toContain("sidehard");
    expect(poly.toStringShort()).toContain("cg: 4");
  });
});

describe("MeshBody（PCOL L13472）", () => {
  it("分区装载：多边形 uid 分配、旗标透传、碰撞组位、弹性查表", () => {
    const table = new MeshBody(syntheticTable());
    expect(table.groups.map((g) => g.name)).toEqual(["ground", "side"]); // 排序 ground(0) < side(1)
    expect(table.nPolygons).toBe(2);
    // ground 面：collisionGroup = 2（ground 组位）
    const ground = table.ground!;
    expect(ground).not.toBeNull();
    expect(ground.collisionGroup).toBe(2);
    expect(ground.restitution).toBe(0.3); // 查表 ground
    expect(ground.friction).toBe(0.15);
    expect(ground.uid).toBe(0);
    // side 面：组位 4 + sidesoft 弹性
    const side = table.getGroupByName("side")!.polys[0];
    expect(side.collisionGroup).toBe(4);
    expect(side.restitution).toBe(0.45); // sidesoft
    expect(side.uid).toBe(1);
    expect(side.uv).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // 包围球透传
    expect(side.bR).toBeCloseTo(0.79, 12);
    expect(side.bCenter).toEqual({ x: 0.5, y: 0.76, z: 0.4 });
  });

  it("lowestPosition = 最低多边形质心（落袋判定阈值）", () => {
    const table = new MeshBody(syntheticTable());
    expect(table.lowestPosition.y).toBeCloseTo(0.76, 12); // side 质心 0.76 低于 0.88
  });

  it("getPolygonByID / getGroupByName / slice 名单切割", () => {
    const table = new MeshBody(syntheticTable());
    const side = table.getGroupByName("side")!.polys[0];
    expect(table.getPolygonByID(1)).toBe(side);
    expect(table.getPolygonByID(99)).toBeNull();
    expect(table.getGroupByName("tunnel")).toBeNull();
    const sliced = table.slice("ground");
    expect(sliced.groups.map((g) => g.name)).toEqual(["ground"]);
    // 裸对象（原作鸭子类型）
    expect(Object.getPrototypeOf(sliced)).toBeNull();
  });

  it("顶点索引扩展短于 3 抛错", () => {
    const bad: CollisionMeshData = {
      ground: {
        p: [0, 0, 0, 1, 0, 0, 0, 0, 1],
        q: [{ i: [0, 1], n: [0, 1, 0] }]
      }
    };
    expect(() => new MeshBody(bad)).toThrow("PolyGroup Error: invalid indices length2");
  });
});

describe("真实台面数据回归（本地 analysis 资产在位时）", () => {
  const itLocal = existsSync(TABLE_JSON) ? it : it.skip;

  itLocal("tiger-club-sno-rgb.json：多边形数/分区/落袋阈值", () => {
    const table = new MeshBody(JSON.parse(readFileSync(TABLE_JSON, "utf8")) as CollisionMeshData);
    expect(table.nPolygons).toBe(66); // side 60 + tunnel 5 + ground 1（end 旗标是 tunnel 组内 1 面）
    expect(table.getGroupByName("side")!.polys.length).toBe(60);
    // ground 面存在且组位 2
    const ground = table.ground!;
    expect(ground.collisionGroup).toBe(2);
    expect(ground.restitution).toBeCloseTo(0.3, 12);
    // 落袋阈值 = tunnel 底缘 y=0.6033
    expect(table.lowestPosition.y).toBeCloseTo(0.6033, 12);
  });
});
