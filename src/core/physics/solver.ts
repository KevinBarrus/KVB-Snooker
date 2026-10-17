import { Vec3 } from "../math/vec3.js";
import type { ContactBase, ContactSS } from "./contact.js";

interface SolverIsland {
  dirty: boolean;
  totalItems: number;
  itemEntry: ContactBase | null;
  next: SolverIsland | null;
}

const localVelocity = new Vec3();
const targetVelocity = new Vec3();
const localImpulse = new Vec3();
const worldImpulse = new Vec3();
const penetrationOffset = new Vec3();

// PCOL L9322-9417（原模 21）
export class Solver {
  static sharedInstance = new Solver();
  maxIter = 4;

  solveContact(contact: ContactBase): void {
    const velocityToImpulse = contact.transformLocVel2Imp;
    const localToWorld = contact.spaceTransformL2W;
    const restitutionScale = -1 - contact.restitution;
    localToWorld.transformTranspose(contact.getRelativeVelocity(), localVelocity);
    const normalVelocity = localVelocity.x >= contact.bounceThreshold
      ? -localVelocity.x
      : restitutionScale * localVelocity.x;
    targetVelocity.set(normalVelocity, -localVelocity.y, -localVelocity.z);
    velocityToImpulse.transform(targetVelocity, localImpulse);
    const tangentImpulse = Math.sqrt(
      localImpulse.y * localImpulse.y + localImpulse.z * localImpulse.z
    );
    const frictionLimit = localImpulse.x * contact.friction;
    if (tangentImpulse > frictionLimit) {
      const scale = frictionLimit / tangentImpulse;
      localImpulse.y *= scale;
      localImpulse.z *= scale;
    }
    const rollingImpulse = localImpulse.x * contact.rollingFriction;
    localToWorld.transform(localImpulse, worldImpulse);
    contact.bi!.applyImpulseAtPoint(worldImpulse, contact.armI, rollingImpulse / contact.armLenI);
    if (contact.isSS) {
      const sphereContact = contact as ContactSS;
      worldImpulse.scale(-1);
      contact.bj!.applyImpulseAtPoint(
        worldImpulse, sphereContact.armJ, rollingImpulse / sphereContact.armLenJ
      );
    }
  }

  solveList(list: { entry: SolverIsland | null }, all: boolean): void {
    for (let island = list.entry; island; island = island.next) {
      if (all || island.dirty) this.solveIsland(island);
    }
  }

  solveIsland(island: SolverIsland): void {
    island.dirty = false;
    for (let iteration = 0, limit = this.maxIter; iteration !== limit; ++iteration) {
      if (this._solveMostUrgentChildren(island)) break;
    }
    this._sloveChildrenPene(island);
  }

  private _solveMostUrgentChildren(island: SolverIsland): boolean {
    if (island.totalItems === 1) {
      const contact = island.itemEntry!;
      if (contact.getCloseSpeed() < -Vec3.EPSILON) this.solveContact(contact);
      return true;
    }
    for (let solved = 0, total = island.totalItems; solved !== total; ++solved) {
      let mostUrgent: ContactBase | null = null;
      let minSpeed = 0;
      for (let contact = island.itemEntry; contact; contact = contact.next) {
        const speed = contact.getCloseSpeed();
        if (speed < minSpeed) {
          minSpeed = speed;
          mostUrgent = contact;
        }
      }
      if (!mostUrgent || minSpeed >= -Vec3.EPSILON) return true;
      this.solveContact(mostUrgent);
    }
    return false;
  }

  private _sloveChildrenPene(island: SolverIsland): void {
    for (let contact = island.itemEntry; contact; contact = contact.next) {
      if (contact.penetration < -Vec3.EPSILON) {
        const depth = contact.penetration;
        penetrationOffset.scaleVector(0.5 * -depth, contact.normal);
        contact.bi!.addPeneOffset(depth, penetrationOffset);
        if (contact.isSS) contact.bj!.addPeneOffset(depth, penetrationOffset.scale(-1));
      }
    }
  }
}
