import { describe, expect, it } from "vitest";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { makeRuleTestSetup } from "../../src/devtools/presets.js";
import { makePocketTable } from "../fixtures/table.js";

describe("本局开球方与重开轮换", () => {
  it.each([["USER", "AI"], ["USER", "USER"]] as const)("%s/%s：中途重开也交换先手，比分和回合重置", (first, second) => {
    const game = new GameSession(new Simulator(makePocketTable()), "single-play", { players: [first, second] });
    expect(game.openingPlayerIndex).toBe(0);
    for (const index of [1, 0, 1]) {
      game.players[0].pts = 20;
      game.context.playerIndex = 1;
      game.reset();
      expect(game.openingPlayerIndex).toBe(index);
      expect(game.context).toEqual({ ballOn: 2, inHand: 2, playerIndex: index, nRounds: 0 });
      expect(game.players[0].pts).toBe(0);
    }
  });

  it("允许装配根传入开球方，非法席位不改台面", () => {
    const sim = new Simulator(makePocketTable());
    const before = sim.serialize();
    for (const openingPlayerIndex of [-1, 2, .5, NaN]) {
      expect(() => new GameSession(sim, "single-play", { openingPlayerIndex })).toThrow("Invalid opening player");
      expect(sim.serialize()).toEqual(before);
    }
    const game = new GameSession(sim, "single-play", { openingPlayerIndex: 1 });
    expect(game.context.playerIndex).toBe(1);
    game.reset(); expect(game.openingPlayerIndex).toBe(0);
  });

  it("争黑依据本局开球方，不依据最后击球方，不交换下一局应有的开球方", () => {
    const game = new GameSession(new Simulator(makePocketTable()), "single-play", {
      openingPlayerIndex: 1, setup: { ...makeRuleTestSetup("black-tie"), scores: [7, 0] }
    });
    const p = game.simulator.getCueBallPosition();
    expect(game.stroke(0, new Float32Array([p.x - .03125, p.y, p.z, 1, 0, 0, 0, .005]))).toBe(true);
    for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
    expect(game.context.playerIndex).toBe(0);
    expect(game.context.ballOn).toBe(128);
    expect(game.context.inHand).toBe(2);
    expect(game.openingPlayerIndex).toBe(1);
    expect(game.decision).toBeNull();
    game.reset(); expect(game.openingPlayerIndex).toBe(1);
    expect(game.context.playerIndex).toBe(0);
  });

  it("自由练习重置始终同一玩家", () => {
    const game = new GameSession(new Simulator(makePocketTable()), "practice");
    game.reset(); game.reset();
    expect(game.context.playerIndex).toBe(0);
    expect(game.context.ballOn).toBe(65535);
  });
});
