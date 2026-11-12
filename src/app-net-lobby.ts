import { isLobbyView, type LobbyView } from "./net/lobby.js";
import type { NetSessionState } from "./net/net-session-state.js";

export async function roomRequest(path: string, body?: object): Promise<LobbyView | null> {
  const response = await fetch(`/api/rooms${path}`, { method: body ? "POST" : "GET", credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data: unknown = await response.json();
  if (response.status === 404 && path.endsWith("/leave")) return null;
  if (!response.ok) {
    const code = data && typeof data === "object" && "error" in data ? String(data.error) : "service-unavailable";
    const errors: Record<string, string> = { unauthenticated: "登录已失效，请重新登录", "room-not-found": "房间不存在",
      "room-full": "房间已满", "match-started": "对局已经开始", "already-in-room": "你已有房间，请先返回或离开",
      "not-a-member": "你不属于这个房间", "match-in-progress": "对局尚未结束，不能单方面离开房间" };
    throw new Error(errors[code] ?? "房间服务暂不可用，请重试");
  }
  if (data && typeof data === "object" && "room" in data) {
    if (data.room === null || isLobbyView(data.room)) return data.room;
    throw new Error("房间信息无效");
  }
  return null;
}

export class NetLobbyPanel {
  readonly element = document.createElement("section");
  private readonly title = document.createElement("h2");
  private readonly players = document.createElement("p");
  private readonly ready = document.createElement("button");
  private readonly leave = document.createElement("button");
  private readonly error = document.createElement("p");
  private lastView = "";
  constructor(private readonly session: NetSessionState, send: (ready: boolean) => boolean) {
    this.element.className = "net-lobby-panel"; this.element.hidden = true;
    this.element.setAttribute("aria-label", "联机房间"); this.error.setAttribute("role", "status");
    this.ready.type = this.leave.type = "button"; this.leave.textContent = "离开房间";
    this.ready.onclick = () => {
      const player = session.lobby?.players.find(p => p.seat === session.seat);
      if (!send(!player?.ready)) this.error.textContent = "连接不可用，请刷新重连";
    };
    this.leave.onclick = async () => {
      try { await roomRequest(`/${session.roomId}/leave`, {}); location.assign("/?multiplayer"); }
      catch (error) { this.error.textContent = error instanceof Error ? error.message : "离开失败"; }
    };
    this.element.append(this.title, this.players, this.ready, this.leave, this.error); document.body.append(this.element);
  }
  sync(): void {
    const lobby = this.session.lobby;
    this.element.hidden = !lobby || lobby.phase === "playing";
    if (!lobby) return;
    const key = JSON.stringify([lobby, this.session.connectionState]);
    if (key === this.lastView) return;
    this.lastView = key;
    this.title.textContent = `房间 ${lobby.roomId} · ${lobby.bestOf} 局 ${Math.floor(lobby.bestOf / 2) + 1} 胜`;
    this.players.textContent = [0, 1].map(seat => {
      const p = lobby.players.find(player => player.seat === seat);
      return p ? `${p.name} · ${!p.connected ? "未连接" : p.ready ? "已准备" : "未准备"}` : "等待朋友加入";
    }).join("　/　");
    this.ready.hidden = lobby.phase !== "waiting";
    this.ready.disabled = this.session.connectionState !== "ready";
    this.ready.textContent = lobby.players.find(p => p.seat === this.session.seat)?.ready ? "取消准备" : "准备";
  }
  dispose(): void { this.element.remove(); }
}
