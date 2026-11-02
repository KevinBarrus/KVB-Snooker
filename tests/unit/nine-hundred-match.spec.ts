import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { NineHundredMatch, type ShootoutBall, type ShootoutSimulator, type TimedContext } from "../../src/core/nine-hundred-match.js";

class FakeBall implements ShootoutBall {
  active: boolean;
  position: Vec3;
  readonly spot: Vec3;
  constructor(public readonly index: number, public readonly number: number, x: number, z: number, active = true) {
    this.spot = new Vec3(x, 0.88, z);
    this.position = this.spot.clone();
    this.active = active;
  }
}

class FakeSim implements ShootoutSimulator {
  readonly balls = [
    new FakeBall(0, 0, -1.04, 0),
    new FakeBall(1, 1, 0.5, 0.2),
    new FakeBall(2, 5, 0, 1)
  ];
  potted: number[] = [];
  cushions: { ballIndex: number; kind: "cushion" | "jaw"; x: number; z: number }[] | null = null;
  respotted: number[] = [];
  reset: number[] = [];
  getBalls() { return this.balls; }
  getResult() { return { pottedIndices: this.potted }; }
  getCushionEvidence() { return this.cushions && { contacts: this.cushions }; }
  respotIndexDefault(index: number) {
    this.respotted.push(index);
    const ball = this.balls.find(item => item.index === index)!;
    ball.position.copy(ball.spot); ball.active = true;
  }
  resetBallPosition(ball: ShootoutBall) {
    this.reset.push(ball.index);
    (ball as FakeBall).active = false;
  }
}

function timed(playerIndex = 0): TimedContext {
  return { ballOn: 2, inHand: 0, playerIndex };
}

describe("900 正常比分终局", () => {
  it("分高者获胜并关闭球桌状态", () => {
    const match = new NineHundredMatch(), ctx = timed();
    match.endFrame([10, 20], 0, new FakeSim(), ctx);
    expect(match.finished).toBe(true);
    expect(match.winner).toBe(1);
    expect(match.shootout).toBeNull();
    expect(ctx).toEqual({ ballOn: 0, inHand: 0, playerIndex: 0 });
    expect(match.clock.view.phase).toBe("finished");
  });
});

describe("900 蓝球决胜启动", () => {
  it("平分进入决胜：非开球方先打、蓝球与母球归位、其余球离台", () => {
    const match = new NineHundredMatch(), sim = new FakeSim(), ctx = timed();
    match.endFrame([7, 7], 0, sim, ctx);
    expect(match.finished).toBe(false);
    expect(match.shootout).toEqual({ attempts: [0, 0], potted: [0, 0] });
    expect(ctx.playerIndex).toBe(1);
    expect(ctx.ballOn).toBe(32);
    expect(ctx.inHand).toBe(2);
    expect(match.clock.view).toMatchObject({ shootout: true, frameSeconds: 0, shotSeconds: 20 });
    expect(sim.respotted).toEqual([0, 2]);
    expect(sim.reset).toEqual([1]);
  });

  it("开球方为 1 时由 0 先打决胜", () => {
    const ctx = timed(1);
    new NineHundredMatch().endFrame([3, 3], 1, new FakeSim(), ctx);
    expect(ctx.playerIndex).toBe(0);
  });
});

describe("900 蓝球决胜轮次", () => {
  it("同等尝试次数后比较合法直接进球，胜者在追加尝试时确定", () => {
    const match = new NineHundredMatch(), sim = new FakeSim(), ctx = timed();
    match.endFrame([7, 7], 0, sim, ctx);
    match.completeAttempt(false, sim, ctx);
    expect(ctx.playerIndex).toBe(0);
    match.completeAttempt(false, sim, ctx);
    expect(ctx.playerIndex).toBe(1);
    expect(match.shootout).toEqual({ attempts: [1, 1], potted: [0, 0] });
    match.completeAttempt(true, sim, ctx);
    expect(ctx.playerIndex).toBe(0);
    match.completeAttempt(false, sim, ctx);
    expect(match.finished).toBe(true);
    expect(match.winner).toBe(1);
    expect(ctx.ballOn).toBe(0);
  });

  it("未进入决胜时禁止提交尝试", () => {
    expect(() => new NineHundredMatch().completeAttempt(true, new FakeSim(), timed())).toThrow();
  });
});

describe("900 合法直接进球判定", () => {
  function potted(): FakeSim {
    const sim = new FakeSim();
    sim.potted = [2];
    return sim;
  }

  it("蓝球入袋且无犯规、无碰库则有效", () => {
    expect(new NineHundredMatch().isDirectBluePot(potted(), 0)).toBe(true);
    const sim = potted();
    sim.cushions = [{ ballIndex: 2, kind: "jaw", x: 0, z: 1 }];
    expect(new NineHundredMatch().isDirectBluePot(sim, 0)).toBe(true);
  });

  it("碰库、犯规或未入袋均无效", () => {
    const sim = potted();
    sim.cushions = [{ ballIndex: 2, kind: "cushion", x: 0, z: 1 }];
    expect(new NineHundredMatch().isDirectBluePot(sim, 0)).toBe(false);
    expect(new NineHundredMatch().isDirectBluePot(potted(), 4)).toBe(false);
    expect(new NineHundredMatch().isDirectBluePot(new FakeSim(), 0)).toBe(false);
  });

  it("蓝球入袋后远离的库面接触视为已先碰库", () => {
    const sim = potted();
    sim.cushions = [{ ballIndex: 2, kind: "jaw", x: 0, z: 5 }];
    expect(new NineHundredMatch().isDirectBluePot(sim, 0)).toBe(false);
  });
});

describe("900 复位", () => {
  it("复位清空决胜、胜负与计时", () => {
    const match = new NineHundredMatch(), sim = new FakeSim(), ctx = timed();
    match.endFrame([7, 7], 0, sim, ctx);
    match.reset(true);
    expect(match.shootout).toBeNull();
    expect(match.finished).toBe(false);
    expect(match.winner).toBeNull();
    expect(match.clock.view).toMatchObject({ frameSeconds: 900, shotSeconds: 20, phase: "placement" });
  });
});
