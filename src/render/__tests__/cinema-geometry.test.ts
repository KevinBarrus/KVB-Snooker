import { afterEach, describe, expect, it } from "vitest";
import * as B from "babylonjs/es6.js";
import { applyTableGeometry, tableJawShift } from "../../core/physics/table-geometry.js";
import { buildCushions, type CushionOutline } from "../table-cushions.js";
import { buildFrame } from "../table-frame.js";
import { buildLeather } from "../pocket-leather.js";
import { buildNet } from "../pocket-net.js";
import { CINEMA_TABLE_STYLE } from "../cinema-style.js";
import { TABLE_STYLE } from "../table-style.js";

const engines: B.NullEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });
function scene(): B.Scene {
  const engine = new B.NullEngine(); engines.push(engine);
  return new B.Scene(engine);
}

describe("cinema table geometry", () => {
  it("uses all physical cushion endpoints exactly at ball contact height", () => {
    const side = applyTableGeometry({}).side;
    const outline: CushionOutline = side.q.map(face => ({
      x: side.p[face.i[0] * 3], z: side.p[face.i[0] * 3 + 2], pocket: face.f?.includes("pocket") ?? false
    }));
    const mesh = buildCushions(outline).applyTo(new B.Mesh("cushions", scene()));
    const positions = mesh.getVerticesData("position")!;
    const contact = new Set<string>();
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions.slice(i, i + 3).every(Number.isFinite)).toBe(true);
      if (Math.abs(positions[i + 1] - 0.90625) < 1e-7) contact.add(`${positions[i].toFixed(6)},${positions[i + 2].toFixed(6)}`);
    }
    outline.forEach((point, index) => {
      if (point.pocket) return;
      for (const end of [point, outline[(index + 1) % outline.length]]) {
        expect(contact.has(`${end.x.toFixed(6)},${end.z.toFixed(6)}`)).toBe(true);
      }
    });
  });

  it("keeps default geometry and presets isolated while building cinema pockets", () => {
    const target = scene();
    const before = structuredClone(TABLE_STYLE);
    const original = buildFrame().wood.applyTo(new B.Mesh("before", target)).getVerticesData("position");
    const shift = tableJawShift();
    const net = buildNet(shift, CINEMA_TABLE_STYLE);
    const shapes = [buildFrame(CINEMA_TABLE_STYLE).wood, buildLeather(shift, CINEMA_TABLE_STYLE), net.net, net.liner];
    for (const [index, shape] of shapes.entries()) {
      const mesh = shape.applyTo(new B.Mesh(`part-${index}`, target));
      expect(mesh.getVerticesData("position")!.every(Number.isFinite)).toBe(true);
      expect(mesh.getTotalIndices()).toBeGreaterThan(0);
    }
    expect(buildFrame().wood.applyTo(new B.Mesh("after", target)).getVerticesData("position")).toEqual(original);
    expect(TABLE_STYLE).toEqual(before);
  });

  it("rejects invalid outlines rather than creating corrupt GPU buffers", () => {
    expect(() => buildCushions([])).toThrow("Invalid");
    expect(() => buildCushions([{ x: NaN, z: 0, pocket: false }])).toThrow("Invalid");
  });
});
