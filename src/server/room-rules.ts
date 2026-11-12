import { GAME_STATE, type GameSession } from "../core/game.js";
import { REJECT, type DecideTurnAction, type RejectReason, type SeatIndex } from "../net/protocol.js";
import type { RuleAction, RulesView } from "../net/rule-view.js";
import { ensureCueBallActive } from "./cue-placement.js";

export function rulesView(game: GameSession): RulesView {
  const freeBall = game.freeBallAvailable, nomination = game.getNomination(0, 0);
  const enabled = !game.finished && game.state === GAME_STATE.READY && (freeBall || game.context.ballOn === 252);
  return {
    players: game.players.map(p => ({ pts: p.pts, penalty: p.penalty, brk: p.brk })),
    decision: game.decision ? { playerIndex: game.decision.playerIndex, canReplace: game.decision.canReplace } : null,
    freeBall,
    nomination: { enabled, selected: nomination.manual ? nomination.ballIndex : null,
      options: enabled ? game.simulator.getBalls().filter(b => b.active && b.index > 0 &&
        (freeBall ? (2 ** b.number & game.context.ballOn) === 0 : b.number > 1)).map(b => b.index) : [] },
    touching: [...game.touchingBallIndices]
  };
}

export function applyRuleAction(game: GameSession, seat: SeatIndex, action: RuleAction | DecideTurnAction): RejectReason | null {
  if (seat !== game.context.playerIndex) return REJECT.NOT_YOUR_TURN;
  if (game.finished) return REJECT.WRONG_PHASE;
  let accepted = false;
  switch (action.type) {
    case "decide-turn": accepted = game.chooseNextPlayer(seat, action.takeOver ? seat : 1 - seat); break;
    case "replace-shot": accepted = game.restorePreviousShot(seat); break;
    case "nominate": accepted = game.nominate(seat, action.ballIndex); break;
    case "place-cue": accepted = game.placeCueBall(action.x, game.simulator.spotY, action.z); break;
  }
  if (!accepted) return REJECT.WRONG_PHASE;
  if (action.type === "decide-turn") ensureCueBallActive(game, game.simulator);
  return null;
}
