import { MatchPause } from "../core/match-pause.js";
import type { PauseAction, SeatIndex } from "../net/protocol.js";

export class RoomPause extends MatchPause {
  constructor() { super({ players: 2, maxPerPlayer: null, maxSeconds: null, countdownSeconds: 3 }); }

  command(seat: SeatIndex, action: PauseAction): boolean {
    switch (action.type) {
      case "pause-request": return this.request(seat);
      case "pause-accept": return this.respond(seat, true);
      case "pause-decline": return this.respond(seat, false);
      case "pause-cancel": return this.cancel(seat);
      case "pause-ready": return this.ready(seat);
    }
  }
}
