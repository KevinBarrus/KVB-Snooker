import { MATCH_LENGTHS } from "./core/match-progress.js";
import { roomRequest } from "./app-net-lobby.js";
import type { LobbyView } from "./net/lobby.js";
import "./multiplayer.css";

export async function openMultiplayer(): Promise<void> {
  const host = document.createElement("main"); host.className = "multiplayer-entry";
  const title = document.createElement("h1"); title.textContent = "双人对战";
  const format = document.createElement("p"); format.textContent = "经典斯诺克";
  const back = document.createElement("a"); back.href = "/"; back.textContent = "返回主页";
  const create = document.createElement("form"); const join = document.createElement("form");
  const length = document.createElement("select"); length.setAttribute("aria-label", "比赛局数");
  for (const bestOf of MATCH_LENGTHS) {
    const option = document.createElement("option"); option.value = String(bestOf);
    option.textContent = `${bestOf} 局 ${Math.floor(bestOf / 2) + 1} 胜`; length.append(option);
  }
  length.value = "3";
  const createButton = document.createElement("button"); createButton.textContent = "创建房间";
  const code = document.createElement("input"); code.setAttribute("aria-label", "房间码"); code.placeholder = "朋友的房间码";
  code.required = true; code.maxLength = 6; code.minLength = 6; code.pattern = "[A-Za-z2-9]{6}"; code.autocomplete = "off";
  const joinButton = document.createElement("button"); joinButton.textContent = "加入房间";
  const error = document.createElement("p"); error.setAttribute("role", "status");
  const current = document.createElement("section"); current.setAttribute("aria-label", "已有房间");
  create.append(length, createButton); join.append(code, joinButton); host.append(back, title, format, create, join, current, error);
  document.body.append(host);
  const navigate = (room: LobbyView | null): void => { if (!room) throw new Error("房间信息缺失"); location.assign(`/?room=${encodeURIComponent(room.roomId)}`); };
  const refresh = async (): Promise<void> => {
    const room = await roomRequest("/current"); current.replaceChildren();
    if (!room) return;
    const resume = document.createElement("button"); resume.textContent = `返回房间 ${room.roomId}`; resume.onclick = () => navigate(room);
    current.append(resume);
    if (room.phase !== "playing") {
      const leave = document.createElement("button"); leave.textContent = "离开已有房间";
      leave.onclick = () => { void run(async () => { await roomRequest(`/${room.roomId}/leave`, {}); await refresh(); }); };
      current.append(leave);
    }
  };
  const run = async (operation: () => Promise<void>): Promise<void> => {
    createButton.disabled = joinButton.disabled = true; error.textContent = "";
    try { await operation(); }
    catch (caught) { error.textContent = caught instanceof Error ? caught.message : "连接失败，请重试"; }
    finally { createButton.disabled = joinButton.disabled = false; }
  };
  create.onsubmit = event => { event.preventDefault(); void run(async () => {
    try { navigate(await roomRequest("", { ruleset: "classic", bestOf: Number(length.value) })); }
    catch (caught) { await refresh().catch(() => {}); throw caught; }
  }); };
  join.onsubmit = event => { event.preventDefault(); void run(async () => navigate(await roomRequest(`/${code.value.trim().toUpperCase()}/join`, {}))); };
  await run(refresh);
}
