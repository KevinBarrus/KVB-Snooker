import { describe, expect, it } from "vitest";
import { NetShotLauncher } from "../../app-net-shot.js";
import { PersonController } from "../../controller/person-controller.js";
import { EventBus } from "../../core/event-bus.js";
import { MeshBody } from "../../core/physics/mesh-body.js";
import { Simulator } from "../../core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../core/simulator/scene.js";
import { NetSessionState } from "../../net/net-session-state.js";
import { RemoteView } from "../../net/remote-view.js";
import { NET_PROTOCOL_VERSION, type SnapshotMessage } from "../../net/protocol.js";

function setup(interpolationDelayMs = 100) {
  const simulator = new Simulator(new MeshBody({ ground: {
    p: [-10, .88, -10, 10, .88, -10, 10, .88, 10, -10, .88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } }), { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, .3, 0] });
  const session = new NetSessionState({ commandIdFactory: () => "shot" });
  session.onWelcome({ type: "welcome", protocolVersion: NET_PROTOCOL_VERSION,
    roomId: "test", seat: 0, seats: [], stateVersion: 0, serverTimeMs: 0,
    match: { ruleset: "classic", mode: "single-play", tickHz: 60, snapshotHz: 20, prepareLeadMs: 700 },
    latency: { enabled: false, inboundMs: 0, outboundMs: 0, jitterMs: 0, appliesTo: "one-way-per-direction" }
  }, 0);
  const remote = new RemoteView({ interpolationDelayMs });
  const snapshot = (time: number, distance = 0, phase: SnapshotMessage["phase"] = "ready"): SnapshotMessage => ({
    type: "snapshot", version: distance ? 2 : 0, eventSeq: 0, serverTimeMs: time, phase,
    context: { playerIndex: 0, ballOn: 1, inHand: 0, scores: [0, 0], round: 0 },
    balls: Array.from({ length: simulator.getBallCount() }, (_, index) => {
      const ball = simulator.getBallView(index);
      return { index, number: ball.number, active: true, x: ball.position.x + (index === 0 ? distance : 0),
        y: ball.position.y, z: ball.position.z, qx: 0, qy: 0, qz: 0, qw: 1 };
    }), checkpoint: null, pendingShot: phase === "ready" ? { shotId: "shot-1", seat: 0, touchAtServerMs: 700, vars: [0, .9, 0, 1, 0, 0, 20, .005] } : null
  });
  const initial = snapshot(0);
  session.onSnapshot(initial, 0);
  remote.pushSnapshot(initial, 0);
  remote.update(0);
  const person = new PersonController({
    getBallCount: () => remote.getBallCount(), getBallView: i => remote.getBallView(i),
    getCueBallPosition: () => remote.getCueBallPosition(), getResult: () => remote.getResult(),
    predict: (vars, distance) => simulator.predict(vars, distance)
  }, new EventBus(), simulator.ballRadius);
  person.gotoState1(true);
  for (let i = 0; i < 30; i++) person.update(.016);
  let now = 0;
  const commands: string[] = [];
  const launcher = new NetShotLauncher({ session, now: () => now, send: c => commands.push(c.commandId) });
  expect(launcher.launch(person)).toBe(true);
  const acknowledge = (at: number, accepted = true) => session.onAck({
    type: "ack", commandId: "shot", accepted, stateVersion: 1, serverTimeMs: 0,
    duplicate: false, shotId: "shot-1", touchAtServerMs: 700
  }, at);
  const frame = (at: number) => {
    const dt = (at - now) / 1000;
    now = at;
    remote.update(at);
    launcher.update(at, remote.interpolationStats.targetServerMs);
    person.update(Math.min(dt, .25));
  };
  const move = (at = 750) => remote.pushSnapshot(snapshot(at, .2, "simulating"), at);
  return { session, person, launcher, remote, frame, acknowledge, move, commands, snapshot };
}

describe("联机球杆与母球共用显示时间线", () => {
  it.each([0, 100, 500])("插值延迟 %ims：运动快照已到达，画面仍须等触球才移动", delay => {
    const t = setup(delay);
    t.acknowledge(20);
    t.frame(20);
    if (delay > 0) t.move();
    t.frame(699 + delay);
    expect(t.launcher.isStruck).toBe(false);
    expect(t.remote.getCueBallPosition().x).toBe(0);
    expect(t.person.stick.leadingSpace).toBeLessThan(0);
    const contact = t.person.stick.kissPoint.clone();
    const direction = t.person.stick.kissDir.clone();
    if (delay === 0) t.move(710);
    t.frame(710 + delay);
    expect(t.remote.getCueBallPosition().x).toBeGreaterThan(0);
    expect(t.launcher.isStruck).toBe(true);
    expect(t.person.stick.leadingSpace).toBeGreaterThanOrEqual(-1e-8);
    const offset = t.person.stick.position.subtract(contact);
    expect(offset.x * direction.x + offset.y * direction.y + offset.z * direction.z).toBeGreaterThanOrEqual(-1e-8);
  });

  it("确认晚到时同帧追赶球杆，不在已移动的母球后重新后拉", () => {
    const t = setup();
    t.acknowledge(900);
    t.move();
    t.frame(900);
    expect(t.remote.getCueBallPosition().x).toBe(.2);
    expect(t.launcher.isStruck).toBe(true);
    expect(t.person.stick.leadingSpace).toBeGreaterThanOrEqual(0);
    expect(t.session.timing().animationTouchAtMs).toBe(900);
    expect(t.commands).toHaveLength(1);
  });

  it("校时前跳或回拨不能让球杆提前触球，球杆与球位继续共用连续时间", () => {
    const t = setup();
    t.acknowledge(20);
    t.frame(20);
    t.remote.setClockOffset(1600);
    t.frame(700);
    expect(t.launcher.isStruck).toBe(false);
    expect(t.remote.getCueBallPosition().x).toBe(0);
    t.move();
    t.remote.setClockOffset(-1600);
    t.frame(799);
    expect(t.launcher.isStruck).toBe(false);
    t.frame(810);
    expect(t.launcher.isStruck).toBe(true);
    expect(t.remote.getCueBallPosition().x).toBeGreaterThan(0);
    expect(t.person.stick.leadingSpace).toBeGreaterThanOrEqual(0);
  });

  it("一帧跨过触球时刻，球杆与母球一起追赶且记录实际观察帧", () => {
    const t = setup();
    t.acknowledge(20);
    t.frame(20);
    t.move();
    t.frame(950);
    expect(t.launcher.isStruck).toBe(true);
    expect(t.person.stick.leadingSpace).toBeGreaterThanOrEqual(0);
    expect(t.session.timing().animationTouchAtMs).toBe(950);
  });

  it("权威结算先到也不跳过滞后显示中的触球", () => {
    const t = setup(500);
    t.acknowledge(20);
    t.frame(20);
    t.move();
    t.session.onEvent({ type: "event", seq: 2, serverTimeMs: 800, event: {
      type: "shot-settled", shotId: "shot-1", seat: 0, score: 0, foulCode: 0,
      potted: [], outOfBounds: [], settledAtServerMs: 800
    } }, 800);
    t.frame(800);
    expect(t.launcher.busy).toBe(true);
    expect(t.launcher.isStruck).toBe(false);
    expect(t.remote.getCueBallPosition().x).toBe(0);
    t.frame(1210);
    expect(t.launcher.isStruck).toBe(true);
  });

  it.each(["natural", "cue", "object"] as const)("%s：自动观察结束从当前画面交接，不跳回底层旧注视点", mode => {
    const t = setup();
    t.person.camera.shotView.mode = mode;
    t.person.camera.lookTo(-.4, .2, true);
    t.person.update(.02);
    t.acknowledge(20);
    t.frame(20);
    for (let at = 40; at <= 4000; at += 20) t.frame(at);
    expect(t.person.camera.stateRatio).toBe(0);
    const target = t.person.camera.target.clone();
    t.launcher.finish();
    for (let i = 0; i < 120; i++) {
      t.person.update(.02);
      expect(t.person.camera.target.x).toBeCloseTo(target.x, 8);
      expect(t.person.camera.target.z).toBeCloseTo(target.z, 8);
    }
  });

  it.each(["natural", "cue", "object"] as const)("%s：手动观察后结束出杆不能拉回旧自动焦点", mode => {
    const t = setup();
    t.person.camera.shotView.mode = mode;
    t.acknowledge(20);
    t.frame(20);
    for (let at = 40; at <= 4000; at += 20) t.frame(at);
    t.person.camera.moveLookAt(.7, .4);
    for (let at = 4020; at <= 7000; at += 20) t.frame(at);
    expect(t.person.camera.shotView.manual).toBe(true);
    const position = t.person.camera.position.clone();
    const target = t.person.camera.target.clone();
    t.launcher.finish();
    for (let i = 0; i < 120; i++) t.person.update(.02);
    expect(t.person.camera.position.x).toBeCloseTo(position.x, 8);
    expect(t.person.camera.position.z).toBeCloseTo(position.z, 8);
    expect(t.person.camera.target.x).toBeCloseTo(target.x, 8);
    expect(t.person.camera.target.z).toBeCloseTo(target.z, 8);
    expect(t.person.camera.shotView.active).toBe(false);
    t.person.activate();
    for (let i = 0; i < 120; i++) t.person.update(.02);
    expect(t.person.camera.target.x).toBeCloseTo(target.x, 8);
    expect(t.person.camera.target.z).toBeCloseTo(target.z, 8);
    t.person.gotoState1();
    for (let i = 0; i < 120; i++) t.person.update(.02);
    expect(t.person.isReadyToStroke()).toBe(true);
  });

  it("拒绝出杆不播触球、不解锁出球画面，也不会重复发命令", () => {
    const t = setup();
    t.acknowledge(20, false);
    t.frame(20);
    expect(t.launcher.busy).toBe(false);
    expect(t.session.timing().animationTouchAtMs).toBeNull();
    expect(t.remote.getCueBallPosition().x).toBe(0);
    expect(t.commands).toHaveLength(1);
  });
});
