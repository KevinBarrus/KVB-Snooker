import { Vec3 } from "../math/vec3.js";
import { BodySphere } from "../physics/ball.js";

// PCOL L12273-12282
export class Ball extends BodySphere {
  readonly spot: Vec3;

  constructor(
    readonly number: number, radius: number, mass: number,
    x: number, y: number, z: number, readonly index: number
  ) {
    super(radius, mass);
    this.spot = new Vec3(x, y, z);
  }
}
