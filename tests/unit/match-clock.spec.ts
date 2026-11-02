import { describe, expect, it } from "vitest";
import { MatchClock } from "../../src/core/match-clock.js";

describe("900 match clock", () => {
  it("pauses placement and settlement without consuming either budget", () => {
    const clock = new MatchClock();
    clock.advance(60);
    expect(clock.view).toMatchObject({ frameSeconds: 900, shotSeconds: 20, phase: "placement" });
    expect(clock.strike()).toBe(false);
    expect(clock.confirmPlacement()).toBe(true);
    clock.advance(3);
    expect(clock.strike()).toBe(true);
    clock.advance(7);
    expect(clock.view).toMatchObject({ frameSeconds: 890, shotSeconds: 17, phase: "rolling" });
    clock.settle(); clock.advance(120);
    expect(clock.view).toMatchObject({ frameSeconds: 890, shotSeconds: 17, phase: "settling" });
    clock.beginTurn(false);
    expect(clock.view).toMatchObject({ frameSeconds: 890, shotSeconds: 20, phase: "aiming" });
  });

  it("repeated placement cannot restore time spent aiming", () => {
    const clock = new MatchClock();
    clock.confirmPlacement(); clock.advance(12);
    clock.beginPlacement(); clock.advance(40);
    clock.beginPlacement(); clock.advance(50);
    clock.confirmPlacement();
    expect(clock.confirmPlacement()).toBe(false);
    expect(clock.view).toMatchObject({ frameSeconds: 888, shotSeconds: 8 });
    expect(clock.advance(8)).toBe("shot");
    expect(clock.strike()).toBe(false);
    expect(clock.beginPlacement()).toBe(false);
  });

  it("expires once on a large delayed update and ignores post-expiry time", () => {
    const clock = new MatchClock();
    clock.confirmPlacement();
    expect(clock.advance(100)).toBe("shot");
    expect(clock.view).toMatchObject({ frameSeconds: 880, shotSeconds: 0 });
    expect(clock.advance(100)).toBeNull();
    clock.beginTurn(true); clock.advance(10);
    expect(clock.view).toMatchObject({ frameSeconds: 880, shotSeconds: 20 });
  });

  it("accepts a contact before the deadline and preserves the rolling shot when frame expires", () => {
    const clock = new MatchClock();
    clock.confirmPlacement(); clock.advance(19.999);
    expect(clock.strike()).toBe(true);
    expect(clock.strike()).toBe(false);
    expect(clock.beginPlacement()).toBe(false);
    expect(clock.advance(900)).toBe("frame");
    expect(clock.view.phase).toBe("frame-expired");
    clock.settle();
    expect(clock.advance(10)).toBeNull();
    expect(clock.strike()).toBe(false);
  });

  it("rejects contact exactly at the shot deadline", () => {
    const clock = new MatchClock();
    clock.confirmPlacement();
    expect(clock.advance(20)).toBe("shot");
    expect(clock.strike()).toBe(false);
  });

  it("prioritizes frame expiry when both deadlines coincide", () => {
    const clock = new MatchClock();
    clock.confirmPlacement(); clock.strike(); clock.advance(880);
    clock.settle(); clock.beginTurn(false);
    expect(clock.advance(20)).toBe("frame");
    expect(clock.advance(1)).toBeNull();
  });

  it.each([30, 60, 144])("independent frame and shot durations at %s FPS", fps => {
    const clock = new MatchClock();
    clock.confirmPlacement();
    for (let i = 0; i < 3 * fps; ++i) clock.advance(1 / fps);
    expect(clock.view.frameSeconds).toBeCloseTo(897, 8);
    expect(clock.view.shotSeconds).toBeCloseTo(17, 8);
    clock.strike();
    for (let i = 0; i < 5 * fps; ++i) clock.advance(1 / fps);
    expect(clock.view.frameSeconds).toBeCloseTo(892, 8);
    expect(clock.view.shotSeconds).toBeCloseTo(17, 8);
  });

  it("shootout has a shot clock but cannot expire the completed frame again", () => {
    const clock = new MatchClock();
    clock.startShootout(); clock.advance(200);
    expect(clock.view).toMatchObject({ frameSeconds: 0, shotSeconds: 20, shootout: true });
    clock.confirmPlacement();
    expect(clock.advance(20)).toBe("shot");
    clock.beginTurn(true); clock.confirmPlacement(); clock.strike();
    expect(clock.advance(200)).toBeNull();
    clock.finish(); clock.advance(20);
    expect(clock.strike()).toBe(false);
    clock.reset();
    expect(clock.view).toEqual({ frameSeconds: 900, shotSeconds: 20, phase: "placement", shootout: false });
  });

  it("rejects invalid intervals before changing state and returns independent views", () => {
    const clock = new MatchClock();
    clock.confirmPlacement();
    const before = clock.view;
    for (const value of [-1, NaN, Infinity]) expect(() => clock.advance(value)).toThrow("Invalid clock interval");
    expect(clock.view).toEqual(before);
    expect(clock.view).not.toBe(before);
    expect(clock.advance(0)).toBeNull();
  });
});
