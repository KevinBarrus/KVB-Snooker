import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { ContactRecorder } from "../../src/core/simulator/contact-evidence.js";
import { Ball } from "../../src/core/simulator/ball.js";
import { ContactSS } from "../../src/core/physics/contact.js";
import { Solver } from "../../src/core/physics/solver.js";
import { Vec3 } from "../../src/core/math/vec3.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { makePocketTable } from "../fixtures/table.js";

function makeGame(touchingNumber: number, extra: number[] = []) {
  return new GameSession(new Simulator(makePocketTable(), { ...DEFAULT_SCENE,
    ballSet: [0, 0, .2, touchingNumber, -.0525, .2, ...extra] }));
}

function stroke(game: GameSession, dx = 1) {
  const sim = game.simulator, p = sim.getCueBallPosition();
  const vars = new Float32Array([p.x - dx * .03125, p.y, p.z, dx, 0, 0, 6, .005]);
  expect(game.stroke(0, vars)).toBe(true);
  for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
  expect(game.state).not.toBe(GAME_STATE.SIMULATING);
  return sim.getContactEvidence()!;
}

describe("贴球规则与只读接触记录", () => {
  it.each([1, 2])("记录第一组同时接触，双红合法，红与%d按实际目标判定", number => {
    const game = new GameSession(new Simulator(makePocketTable(), { ...DEFAULT_SCENE,
      ballSet: [0, 0, .2, 1, .2, .17, number, .2, .23] }));
    const evidence = stroke(game);
    expect([...evidence.firstContactIndices].sort()).toEqual([1, 2]);
    expect(game.result.score).toBe(number === 1 ? 0 : -4);
    expect(game.result.foulCode).toBe(number === 1 ? 0 : FOUL.ILLEGAL_FIRST_HIT);
  });

  it("打离合法红球，无需再碰任何球", () => {
    const game = makeGame(1);
    expect(game.touchingBallIndices).toEqual([1]);
    const evidence = stroke(game);
    expect(evidence.touchingIndices).toEqual([1]);
    expect(evidence.firstContactIndices).toEqual([]);
    expect(evidence.pushedIndices).toEqual([]);
    expect(game.result).toEqual({ score: 0, foulCode: 0 });
  });

  it("打离非目标黑球不误算首碰，仍需击中红球", () => {
    const missed = makeGame(7);
    expect(stroke(missed).firstContactIndices).toEqual([]);
    expect(missed.result).toEqual({ score: -4, foulCode: FOUL.MISS_TARGET });
    const hit = makeGame(7, [1, .15, .2]);
    expect(stroke(hit).firstContactIndices).toEqual([2]);
    expect(hit.result).toEqual({ score: 0, foulCode: 0 });
  });

  it("推向贴球造成直接冲量，判推杆；不依赖整杆结束的位置漂移", () => {
    const game = makeGame(1);
    const evidence = stroke(game, -1);
    expect(evidence.pushedIndices).toEqual([1]);
    expect(game.result.foulCode & FOUL.PUSH_STROKE).toBe(FOUL.PUSH_STROKE);
    expect(game.result.score).toBe(-4);
  });

  it("进红后提名贴住的彩球可打离，提名另一彩球仍须首碰它", () => {
    const allowed = makeGame(7, [2, 1, .5]); allowed.context.ballOn = 252;
    expect(allowed.nominate(0, 1)).toBe(true);
    stroke(allowed);
    expect(allowed.result.foulCode).toBe(0);
    const missed = makeGame(7, [2, 1, .5]); missed.context.ballOn = 252;
    expect(missed.nominate(0, 2)).toBe(true);
    stroke(missed);
    expect(missed.result).toEqual({ score: -4, foulCode: FOUL.MISS_TARGET });
  });

  it("接触观测不改变求解结果；分离后再碰原贴球仍记录首碰但不误判推杆", () => {
    const solve = (record: boolean) => {
      const cue = new Ball(0, .02625, 1.5, 0, 0, 0, 0), target = new Ball(1, .02625, 1.5, .0525, 0, 0, 1);
      cue.reset(0, 0, 0); target.reset(.0525, 0, 0);
      const recorder = new ContactRecorder(() => 1); recorder.begin([cue, target]);
      cue.position.x = -.1; recorder.checkSeparation(); cue.position.x = 0;
      cue.v.set(1, 0, 0); cue.vChangedCount++; cue.__vStateDirty = cue.vProp_dirty = cue.wProp_dirty = true;
      const contact = new ContactSS(null, -1);
      contact.resetWithBiBj(cue, target); contact.resetRestingWithPeneNormal(0, new Vec3(-1, 0, 0));
      contact.startResting();
      (record ? recorder : Solver.sharedInstance).solveContact(contact);
      return { velocity: [cue.v.clone(), target.v.clone(), cue.w.clone(), target.w.clone()], evidence: recorder.snapshot() };
    };
    const recorded = solve(true);
    expect(recorded.velocity).toEqual(solve(false).velocity);
    expect(recorded.evidence).toEqual({ touchingIndices: [1], firstContactIndices: [1], pushedIndices: [] });
  });

  it("预测不污染证据；对外快照隔离；reset与restore清空证据", () => {
    const game = makeGame(1), sim = game.simulator;
    const evidence = stroke(game);
    const saved = sim.serialize(), p = sim.getCueBallPosition();
    sim.predict(new Float32Array([p.x - .03125, p.y, p.z, 1, 0, 0, 6, .005]), .1);
    expect(sim.getContactEvidence()).toEqual(evidence);
    Object.assign(evidence, { pushedIndices: [999] });
    expect(sim.getContactEvidence()!.pushedIndices).toEqual([]);
    sim.restore(saved); expect(sim.getContactEvidence()).toBeNull();
    sim.stroke(new Float32Array([p.x - .03125, p.y, p.z, 1, 0, 0, 0, .005]));
    sim.reset(false, true); expect(sim.getContactEvidence()).toBeNull();
  });
});
