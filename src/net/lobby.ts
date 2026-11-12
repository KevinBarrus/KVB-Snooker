export interface NetIdentity { readonly userId: string; readonly name: string }
export interface LobbyView {
  readonly roomId: string;
  readonly bestOf: number;
  readonly ruleset: "classic";
  readonly phase: "waiting" | "playing" | "finished";
  readonly players: readonly { readonly seat: 0 | 1; readonly name: string; readonly connected: boolean; readonly ready: boolean }[];
}
export interface LobbyMessage { readonly type: "lobby"; readonly lobby: LobbyView }
export interface LobbyReadyMessage { readonly type: "lobby-ready"; readonly ready: boolean }

export function isLobbyView(value: unknown): value is LobbyView {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LobbyView>;
  return typeof v.roomId === "string" && /^[A-Z2-9]{6}$/.test(v.roomId) && typeof v.bestOf === "number" &&
    Number.isInteger(v.bestOf) && v.bestOf > 0 && v.bestOf <= 35 && v.ruleset === "classic" &&
    ["waiting", "playing", "finished"].includes(String(v.phase)) && Array.isArray(v.players) && v.players.length <= 2 &&
    v.players.every(p => p && (p.seat === 0 || p.seat === 1) && typeof p.name === "string" && p.name.length <= 80 &&
      typeof p.connected === "boolean" && typeof p.ready === "boolean") && new Set(v.players.map(p => p.seat)).size === v.players.length;
}
