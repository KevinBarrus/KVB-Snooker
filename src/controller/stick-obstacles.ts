import * as B from "babylonjs/es6.js";

export type Point3 = Readonly<{ x: number; y: number; z: number }>;
interface Obstacle { center: B.Vector3; radius: number; escape: number }
interface Cushion { a: B.Vector3; b: B.Vector3; ab: B.Vector3; normal: B.Vector3; point: B.Vector3; toi: number }

// PCOL L4927-4940
export function sphereRayDistance(direction: Point3, offset: Point3, radiusSquared: number): number {
  const projection = offset.x * direction.x + offset.y * direction.y + offset.z * direction.z;
  const outside = offset.x ** 2 + offset.y ** 2 + offset.z ** 2 - radiusSquared;
  if (outside > 0 && projection > 0) return Number.MAX_VALUE;
  const discriminant = projection * projection - outside;
  if (discriminant <= 0) return Number.MAX_VALUE;
  const distance = -projection - Math.sqrt(discriminant);
  return distance < 1e-6 ? 0 : distance;
}

// PCOL L369-372
const bounds = [1.713, .897, .074, .897, .028, 1.005, -.028, 1.005, -.074, .897, -1.713, .897,
  -1.824, .978, -1.876, .925, -1.797, .808, -1.797, -.808, -1.876, -.925, -1.824, -.978,
  -1.713, -.897, -.074, -.897, -.028, -1.005, .028, -1.005, .074, -.897, 1.713, -.897,
  1.824, -.978, 1.876, -.925, 1.797, -.808, 1.797, .808, 1.876, .925, 1.824, .978];

// PCOL L235-328, L4943-4961, L5275-5318
export class StickObstacles {
  private readonly cushions: Cushion[] = [];
  private activeCushions: Cushion[] = [];
  private current: Cushion | null = null;

  constructor() {
    for (let i = 0; i < bounds.length; i += 2) {
      const next = (i + 2) % bounds.length;
      const a = new B.Vector3(bounds[i], 0, bounds[i + 1]);
      const b = new B.Vector3(bounds[next], 0, bounds[next + 1]);
      const ab = b.subtract(a);
      this.cushions.push({ a, b, ab, normal: B.Vector3.Cross(ab, B.Vector3.Up()).normalize(),
        point: B.Vector3.Zero(), toi: 0 });
    }
  }

  filter(target: B.Vector3, reach: number): void {
    this.current = null;
    this.activeCushions = this.cushions.filter(cushion => {
      if (Math.abs(B.Vector3.Dot(target.subtract(cushion.a), cushion.normal)) >= reach) return false;
      const side = this.pointOnSide(target, cushion);
      return side === 0 || B.Vector3.DistanceSquared(target.subtract(new B.Vector3(0, target.y, 0)),
        side === -1 ? cushion.a : cushion.b) < reach * reach;
    });
  }

  private pointOnSide(point: B.Vector3, cushion: Cushion): number {
    if (B.Vector3.Dot(point.subtract(cushion.a), cushion.ab) < 0) return -1;
    return B.Vector3.Dot(point.subtract(cushion.b), cushion.ab) >= 0 ? 1 : 0;
  }

  private detectCushion(tip: B.Vector3, back: B.Vector3, cushion: Cushion): boolean {
    const distance = B.Vector3.Dot(tip.subtract(cushion.a), cushion.normal);
    if (Math.abs(distance) < 1e-5) {
      cushion.toi = 0;
      cushion.point.copyFrom(tip);
      return this.pointOnSide(cushion.point, cushion) === 0;
    }
    const denominator = B.Vector3.Dot(back, cushion.normal);
    if (Math.abs(denominator) < 1e-5) return false;
    cushion.toi = -distance / denominator;
    if (cushion.toi < 0) return false;
    cushion.point.copyFrom(tip.add(back.scale(cushion.toi)));
    return this.pointOnSide(cushion.point, cushion) === 0;
  }

  private cushionObstacle(tip: B.Vector3, back: B.Vector3, midRadius: number, obstacles: Obstacle[]): void {
    const previous = this.current;
    if (!previous || !this.detectCushion(tip, back, previous)) {
      this.current = null;
      for (const cushion of this.activeCushions) {
        if (cushion !== previous && this.detectCushion(tip, back, cushion) &&
          (!this.current || cushion.toi < this.current.toi)) this.current = cushion;
      }
    }
    if (!this.current) return;
    const point = this.current.point;
    const height = 0.92 + midRadius;
    if (point.y < height) obstacles.push({ center: new B.Vector3(point.x, height, point.z), radius: 0,
      escape: height - point.y });
  }

  correct(tip: B.Vector3, support: B.Vector3, radius: number, midRadius: number,
    maxEscape: number, balls: readonly Point3[]): boolean {
    const back = support.subtract(tip);
    const normal = B.Vector3.Cross(back, B.Vector3.Up()).normalize();
    if (normal.x === 0 && normal.y === 0 && normal.z === 0) return false;
    const escapeDirection = B.Vector3.Cross(normal, back).normalize();
    const obstacles: Obstacle[] = [];
    const expandedRadius = radius + midRadius;
    for (const position of balls) {
      const ball = new B.Vector3(position.x, position.y, position.z);
      if (B.Vector3.Dot(tip.subtract(ball), back) > 0) continue;
      const distance = B.Vector3.Dot(ball.subtract(tip), normal);
      if (Math.abs(distance) - expandedRadius >= -1e-6) continue;
      const center = ball.subtract(normal.scale(distance));
      const projectedRadius = Math.sqrt(expandedRadius * expandedRadius - distance * distance);
      obstacles.push({ center, radius: projectedRadius,
        escape: projectedRadius + B.Vector3.Dot(center.subtract(tip), escapeDirection) });
    }
    this.cushionObstacle(tip, back, midRadius, obstacles);
    if (obstacles.length === 0) return false;
    let escape = 0;
    for (const obstacle of obstacles) if (obstacle.escape > escape) escape = obstacle.escape;
    if (escape - maxEscape <= 1e-6) {
      const correction = escapeDirection.scale(escape);
      tip.addInPlace(correction);
      support.addInPlace(correction);
    } else {
      if (maxEscape > 1e-6) tip.addInPlace(escapeDirection.scale(maxEscape));
      let angle = Math.PI / 2;
      for (const obstacle of obstacles) {
        const offset = obstacle.center.subtract(tip);
        const distance = offset.length();
        const candidate = Math.acos(offset.y / distance) - Math.asin(obstacle.radius / distance);
        if (candidate < angle) angle = candidate;
      }
      const sine = Math.sin(angle);
      support.copyFromFloats(tip.x + 0.66 * normal.z * sine, tip.y + 0.66 * Math.cos(angle),
        tip.z - 0.66 * normal.x * sine);
    }
    return true;
  }
}
