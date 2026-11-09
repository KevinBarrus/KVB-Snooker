import { PHYSICS } from "../physics/constants.js";
import { TABLE_TUNING } from "../physics/table-tuning.js";
import { readSimulatorCheckpoint, type SimulatorCheckpoint } from "./checkpoint.js";
import { Vec3 } from "../math/vec3.js";
import type { ContactBase } from "../physics/contact.js";
import type { MeshBody } from "../physics/mesh-body.js";
import { WorldClient } from "../physics/world-client.js";
import { Ball } from "./ball.js";
import { DEFAULT_SCENE, type SceneParameters } from "./scene.js";
import { ContactRecorder, type ContactEvidence, type CushionEvidence } from "./contact-evidence.js";
import { contactImpact, cueImpact, type ImpactEvent } from "./impact.js";
import {
  makeShotResult, type ShotResult, type StrokeVars, type SerialData,
  type BallView, type PredictionContext
} from "./shot-result.js";

// PCOL L12286-12510
export class Simulator {
  private readonly world = new WorldClient();
  private readonly contacts = new ContactRecorder(() => this.world.evolution, contact => {
    if (this.impactListeners.size && contact.isSS) {
      this.rememberTableSpeed(contact.bi as Ball); this.rememberTableSpeed(contact.bj as Ball);
    }
  });
  private readonly balls: Ball[] = [];
  private readonly shotResult = makeShotResult();
  private syncList: SceneParameters = { sceneId: "", ballSet: [], ballRadius: 0, ballMass: 0 };
  private readonly checkpointGeometry: string;
  private awakened = 0;
  private scene = "";
  private spotHeight = NaN;
  private readonly impactListeners = new Set<(event: ImpactEvent) => void>();
  private readonly tableSpeeds = new Map<number, number>();

  constructor(mesh: MeshBody, scene: SceneParameters = DEFAULT_SCENE) {
    if (!mesh.ground) throw new Error("Simulator requires a ground polygon");
    this.world.stepSize = 0.0167;
    this.world.solver = this.contacts;
    this.world.setMeshBody(mesh);
    this.world.onTouchPresolve(contact => this.onTouch(contact));
    this.world.onOutOfBounds(ball => this.shotResult.outOfBoundsIndices.push((ball as Ball).index));
    this.checkpointGeometry = JSON.stringify(mesh.groups.map(group => [group.name, group.polys.map(poly => [
      poly.normal, poly.edges.map(edge => edge.va), poly.friction, poly.restitution, poly.collisionGroup,
      poly.ground, poly.sidehard, poly.sidesoft, poly.tunnel, poly.pocket, poly.end, poly.uv, poly.bCenter, poly.bR
    ])]));
    this.sync(scene);
    this.reset(true, true);
  }

  get sceneId(): string { return this.scene; }
  get ground() { return this.world.meshBody!.ground!; }
  get sidePolyGroups() { return this.world.meshBody!.getGroupByName("side"); }
  get ballRadius(): number { return this.syncList.ballRadius; }
  get spotY(): number { return this.spotHeight; }
  get evolution(): number { return this.world.evolution; }
  get nAwakened(): number { return this.awakened; }
  get result(): ShotResult { return this.shotResult; }

  private onTouch(contact: ContactBase): void {
    if (this.impactListeners.size) {
      const ball = contact.bi as Ball;
      const entrySpeed = ball.position.y < this.spotHeight - Vec3.EPSILON ? this.tableSpeeds.get(ball.index) : undefined;
      const event = contactImpact(contact, this.world.evolution * this.world.stepSize, entrySpeed);
      if (event) this.emitImpact(event);
    }
    const result = this.shotResult;
    if (contact.isSS) {
      const bi = contact.bi as Ball;
      const bj = contact.bj as Ball;
      let target: Ball | null = null;
      if (bi.number === 0) { result.nKissed++; target = bj; }
      else if (bj.number === 0) { result.nKissed++; target = bi; }
      if (result.nKissed === 1 && target) result.firstKissIndex = target.index;
    } else if (contact.bj && "end" in contact.bj && contact.bj.end) {
      const ball = contact.bi as Ball;
      this.world.inactivateBall(ball);
      result.pottedIndices.push(ball.index);
    }
  }

  private sync(parameters: Partial<SceneParameters>): void {
    this.syncList = { ...this.syncList, ...parameters, ballSet: [...(parameters.ballSet ?? this.syncList.ballSet)] };
    this._checkSyncList();
  }

  private _checkSyncList(): void {
    const { sceneId, ballSet, ballRadius, ballMass } = this.syncList;
    this.scene = sceneId;
    if (this.balls.length === 0 || this.balls.length !== ballSet.length / 3 ||
        this.balls[0].radius !== ballRadius || this.balls[0].mass !== ballMass) {
      if (!Number.isFinite(ballRadius) || !Number.isFinite(ballMass) || ballRadius <= 0 || ballMass <= 0) {
        throw new Error(`invalid simulator sync opts: mass, radius: ${ballMass}, ${ballRadius}`);
      }
      if (ballSet.length === 0 || ballSet.length % 3 !== 0 || !ballSet.every(Number.isFinite)) {
        throw new Error(`invalid simulator sync opts: ballSet.length: ${ballSet.length}`);
      }
      this.world.emptyBalls();
      this.balls.length = 0;
      this.spotHeight = this.ground.centerPosition.y + ballRadius;
      for (let index = 0; index !== ballSet.length / 3; ++index) {
        const ball = new Ball(ballSet[3 * index], ballRadius, ballMass,
          ballSet[3 * index + 1], this.spotHeight, ballSet[3 * index + 2], index);
        this.balls.push(ball);
        this.world.addBall(ball);
      }
    }
  }

  reset(hard: boolean, respot: boolean): void {
    this.contacts.clear();
    if (hard) for (const ball of this.balls) this.resetBallPosition(ball, ball.spot);
    if (respot) this.clearResult();
    this.world.reset();
  }

  getBalls(): Ball[] { return this.balls; }
  getBallAtIndex(index: number): Ball { return this.balls[index]; }
  getBallCount(): number { return this.balls.length; }
  getCueBallPosition(): Readonly<Vec3> { return this.balls[0].position.clone(); }

  // PCOL L1886-1900
  getBallView(index: number): BallView {
    const ball = this.balls[index];
    const { position, orientation } = ball.states;
    return { index: ball.index, number: ball.number, active: ball.active,
      position: ball.position.clone(), async: ball.active && !ball.asleep,
      renderPosition: { x: position.x, y: position.y, z: position.z },
      renderOrientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w } };
  }

  getResult(): Readonly<ShotResult> {
    return { ...this.shotResult, pottedIndices: [...this.shotResult.pottedIndices],
      outOfBoundsIndices: [...this.shotResult.outOfBoundsIndices] };
  }

  getContactEvidence(): ContactEvidence | null { return this.contacts.snapshot(); }
  getCushionEvidence(): CushionEvidence | null { return this.contacts.cushionSnapshot(); }

  onImpact(listener: (event: ImpactEvent) => void): () => void {
    this.impactListeners.add(listener);
    return () => { this.impactListeners.delete(listener); };
  }

  private emitImpact(event: ImpactEvent): void {
    Object.freeze(event);
    for (const listener of [...this.impactListeners]) listener(event);
  }

  private rememberTableSpeed(ball: Ball): void {
    if (ball.active && Math.abs(ball.position.y - this.spotHeight) <= Vec3.EPSILON) {
      this.tableSpeeds.set(ball.index, Math.hypot(ball.v.x, ball.v.z));
    }
  }

  respotIndexDefault(index: number): void {
    const ball = this.balls[index];
    this.resetBallPosition(ball, ball.spot);
  }

  respotIndexXYZ(index: number, x: number, y: number, z: number): void {
    this.resetBallXYZ(this.balls[index], x, y, z);
  }

  resetBallPosition(ball: Ball, spot: Vec3 | null): void {
    if (spot) this.resetBallXYZ(ball, spot.x, spot.y, spot.z);
    else { this.world.inactivateBall(ball); this.awakened++; }
  }

  resetBallXYZ(ball: Ball, x: number, y: number, z: number): void {
    this.tableSpeeds.delete(ball.index);
    ball.reset(x, y, z);
    ball.syncStates(0);
    ball.active = true;
    this.awakened++;
  }

  touchBalls(index: number, spot: Vec3, clearance = 1.02 * this.ballRadius): boolean {
    const gap = clearance + this.ballRadius;
    return this.balls.some((ball, i) => i !== index && ball.active &&
      ball.position.distanceToSq(spot) < gap * gap - Vec3.EPSILON);
  }

  step(dt: number): number {
    if (this.impactListeners.size) for (const ball of this.balls) this.rememberTableSpeed(ball);
    const simulated = this.world.step(dt);
    this.contacts.checkSeparation();
    this.awakened = this.world.nAwakened;
    return simulated;
  }

  stroke(vars: StrokeVars): void {
    this.clearResult();
    this.contacts.begin(this.balls);
    const event = cueImpact(this.balls[0], vars, this.world.evolution * this.world.stepSize);
    this.world.shoot(this.balls[0], vars);
    this.rememberTableSpeed(this.balls[0]);
    this.emitImpact(event);
    this.awakened++;
  }

  private clearResult(): void {
    this.tableSpeeds.clear();
    const result = this.shotResult;
    result.nKissed = result.firstKissIndex = 0;
    result.pottedIndices.length = result.outOfBoundsIndices.length = 0;
  }

  serialize(): SerialData { return this.world.serialize({ balls: [], mbid: "", evolution: 0 }); }

  restore(data: SerialData): void {
    this.world.restore(data);
    this.contacts.clear();
    this.clearResult();
    for (const ball of this.balls) ball.syncStates(0);
    this.awakened = this.world.nAwakened;
  }

  exportCheckpoint(): SimulatorCheckpoint {
    if (this.nAwakened || this.balls.some(ball => ball.active && !ball.asleep)) throw new Error("Checkpoint requires settled balls");
    const data: SimulatorCheckpoint = { format: 1,
      configuration: JSON.stringify(["physics-1", this.syncList, PHYSICS, TABLE_TUNING, this.checkpointGeometry]),
      world: this.serialize(), resting: this.world.exportRestingState(), accumulatorSeconds: this.world.accumulator, poses: this.balls.map(ball => [ball.position.x, ball.position.y, ball.position.z,
        ball.orientation.x, ball.orientation.y, ball.orientation.z, ball.orientation.w]),
      residuals: this.balls.map(ball => ({ rollingPower: ball.rfPower,
        rollingDirection: [ball.rfDir.x, ball.rfDir.y, ball.rfDir.z], penetration: ball.penetration,
        penetrationOffset: [ball.peneOffset.x, ball.peneOffset.y, ball.peneOffset.z] })),
      result: this.getResult(), contacts: this.getContactEvidence(), cushions: this.getCushionEvidence() };
    return readSimulatorCheckpoint(data, data.configuration, data.world.mbid, this.balls.length, this.world.meshBody!.nPolygons);
  }

  validateCheckpoint(value: unknown): SimulatorCheckpoint {
    const configuration = JSON.stringify(["physics-1", this.syncList, PHYSICS, TABLE_TUNING, this.checkpointGeometry]);
    return readSimulatorCheckpoint(value, configuration, this.world.meshBody!.id, this.balls.length, this.world.meshBody!.nPolygons);
  }

  restoreCheckpoint(value: unknown): void {
    const data = this.validateCheckpoint(value);
    this.restore(data.world);
    this.world.accumulator = data.accumulatorSeconds;
    this.balls.forEach((ball, index) => {
      const residual = data.residuals[index];
      ball.rfPower = residual.rollingPower;
      ball.rfDir.set(residual.rollingDirection[0], residual.rollingDirection[1], residual.rollingDirection[2]);
      ball.penetration = residual.penetration;
      ball.peneOffset.set(residual.penetrationOffset[0], residual.penetrationOffset[1], residual.penetrationOffset[2]);
      if (!ball.active) {
        const pose = data.poses[index];
        ball.position.set(pose[0], pose[1], pose[2]);
        ball.orientation.set(pose[3], pose[4], pose[5], pose[6]);
        ball.setSleep();
      }
      ball.syncStates(0);
    });
    this.world.restoreRestingState(data.resting);
    Object.assign(this.shotResult, data.result);
    this.contacts.restoreSettled(this.balls, data.contacts, data.cushions);
  }

  predict(vars: StrokeVars, maxDist = Infinity): PredictionContext {
    this.world.save();
    const context = this.world.predict(this.balls[0], vars, maxDist);
    this.world.solver = this.contacts;
    // PCOL L14626-14681
    const point = (value: Readonly<Vec3>) => ({ x: value.x, y: value.y, z: value.z });
    return { impactV1: context.impactV1.clone(), impactOccured: context.impactOccured,
      p0: point(context.p0), p1: point(context.p1), cue: point(context.cue), cueVSq: context.cueVSq,
      p2: point(context.p2), target: point(context.target), targetVSq: context.targetVSq,
      targetNumber: context.targetNumber, hasImpactTarget: context.hasImpactTarget };
  }
}
