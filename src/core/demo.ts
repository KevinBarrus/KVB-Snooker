import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AIController } from "./ai/task-pipeline.js";
import { AI_PROFILES } from "./ai/profiles.js";
import { createGameView } from "./ai/play-area.js";
import { makeStrokeVars } from "./ai/stroke.js";
import { GAME_STATE, GameSession } from "./game.js";
import { MeshBody, type CollisionMeshData } from "./physics/mesh-body.js";
import { SeededRandom, setCoreRandom } from "./rng.js";
import { Simulator } from "./simulator/simulator.js";

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));
}

function isMeshData(data: unknown): data is CollisionMeshData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data).every((group: unknown) => {
    if (!group || typeof group !== "object" || !("p" in group) || !("q" in group)) return false;
    if (!isNumberArray(group.p) || group.p.length % 3 !== 0 || !Array.isArray(group.q)) return false;
    const vertices = group.p.length / 3;
    return group.q.every((poly: unknown) => {
      if (!poly || typeof poly !== "object" || !("i" in poly) || !("n" in poly)) return false;
      return isNumberArray(poly.i) && poly.i.length >= 3 && poly.i.every(index => Number.isInteger(index) && index >= 0 && index < vertices)
        && isNumberArray(poly.n) && poly.n.length === 3
        && (!("f" in poly) || (Array.isArray(poly.f) && poly.f.every((flag: unknown) =>
          typeof flag === "string" && ["ground", "sidehard", "sidesoft", "pocket", "tunnel", "end"].includes(flag))))
        && (!("s" in poly) || (isNumberArray(poly.s) && poly.s.length === 4))
        && (!("uv" in poly) || isNumberArray(poly.uv));
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    mode: { type: "string", default: "single-play" },
    seed: { type: "string", default: "2026" },
    "max-rounds": { type: "string" },
    table: { type: "string", default: "analysis/tiger-club-sno-rgb.json" }
  } });
  if (values.mode !== "practice" && values.mode !== "single-play") throw new Error("mode must be practice or single-play");
  const seed = Number(values.seed);
  const maxRounds = Number(values["max-rounds"] ?? (values.mode === "practice" ? 3 : 2000));
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(maxRounds) || maxRounds <= 0) throw new Error("seed/max-rounds must be integers; max-rounds > 0");
  const data: unknown = JSON.parse(await readFile(values.table, "utf8"));
  if (!isMeshData(data)) throw new Error("invalid collision mesh data");
  const table = new MeshBody(data);
  table.id = values.table;
  setCoreRandom(new SeededRandom(seed));
  try {
    const sim = new Simulator(table);
    const game = new GameSession(sim, values.mode);
    const view = createGameView(sim);
    const brains = game.players.map(() => new AIController(AI_PROFILES.HARD));
    console.log(`M1 ${values.mode}: ${game.players.map(player => player.type).join(" / ")}, seed=${seed}, balls=${sim.getBallCount()}`);
    while (!game.finished && game.context.nRounds < maxRounds) {
      if (game.context.inHand === 2) {
        const cue = sim.getCueBallPosition();
        let placed = game.placeCueBall(cue.x, sim.spotY, cue.z);
        for (let depth = 0; !placed && depth <= 9; ++depth) {
          for (let across = -9; !placed && across <= 9; ++across) {
            placed = game.placeCueBall(-1.04 - depth * 0.03, sim.spotY, across * 0.03);
          }
        }
        if (!placed) throw new Error("No legal D-area cue placement");
      }
      const index = game.context.playerIndex;
      const brain = brains[index];
      brain.checkRestart(sim, game.context);
      let route = null;
      for (let count = 0; count < 10000 && !route; ++count) route = brain.step(view, sim);
      if (!route) throw new Error("AI pipeline did not finish");
      if (!game.stroke(index, makeStrokeVars(sim, route))) throw new Error("Turn ownership rejected stroke");
      for (let frame = 0; game.state === GAME_STATE.SIMULATING && frame < 2000; ++frame) game.step(0.1);
      const decision = game.decision;
      if (decision) game.chooseNextPlayer(decision.playerIndex, decision.playerIndex);
      if (game.state !== GAME_STATE.READY) throw new Error("Shot did not settle");
      if (game.result.score !== 0 || game.context.nRounds % 10 === 0) {
        console.log(`round=${game.context.nRounds} player=${index} score=${game.result.score} foul=${game.result.foulCode} break=${game.players[index].brk} next=${game.context.playerIndex} ballOn=${game.context.ballOn}`);
      }
      for (const ball of sim.getBalls()) {
        if (![ball.position.x, ball.position.y, ball.position.z, ball.v.lengthSq(), ball.w.lengthSq()].every(Number.isFinite)) {
          throw new Error(`Non-finite ball state: ${ball.index}`);
        }
      }
    }
    const scores = game.players.map((player, index) => ({
      player: index, type: player.type, pts: player.pts,
      total: player.pts - (game.players[1 - index]?.penalty ?? 0),
      penalty: player.penalty, maxBreak: player.maxbrk, shots: player.shootingCount
    }));
    console.log(JSON.stringify({ completed: game.finished, mode: game.mode, rounds: game.context.nRounds, ballOn: game.context.ballOn, scores }));
    if (game.mode === "single-play" && !game.finished) throw new Error("Frame incomplete at max-rounds");
  } finally { setCoreRandom(null); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
