import { describe, expect, it } from "vitest";
import { validateBlenderGeometry } from "../blender-table.js";

describe("Blender geometry contract", () => {
  const outline = [{ x: 1.797, z: .8966, pocket: false }, { x: 1.83, z: .93, pocket: true }];
  const manifest = { outline, scale: 1, bed: .88 };
  it("accepts the same immutable physical outline", () => {
    expect(() => validateBlenderGeometry(manifest, outline)).not.toThrow();
  });
  it("rejects stale jaw positions, flags and invalid scale instead of silently misaligning", () => {
    for (const value of [null, {}, { ...manifest, scale: .01 }, { ...manifest, bed: .89 },
      { ...manifest, outline: outline.slice(1) },
      { ...manifest, outline: [{ ...outline[0], x: 1.80 }, outline[1]] },
      { ...manifest, outline: [{ ...outline[0], pocket: true }, outline[1]] }]) {
      expect(() => validateBlenderGeometry(value, outline)).toThrow();
    }
  });
});
