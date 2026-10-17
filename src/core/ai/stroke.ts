import { Vec3 } from "../math/vec3.js";
import type { Simulator } from "../simulator/simulator.js";
import type { StrokeVars } from "../simulator/shot-result.js";
import type { AIRoute } from "./route-cache.js";

// PCOL L1216-1221、L5090-5114、L5155-5230、L5448-5455、L7615-7620
export function makeStrokeVars(sim: Simulator, route: AIRoute): StrokeVars {
  const radius = sim.ballRadius;
  const tipRadius = 0.005;
  const maxOffset = Math.min(0.6 * radius, 0.99 * (radius - 0.01));
  const tipOffset = Math.max(-1, Math.min(1, route.fbSpin)) * maxOffset;
  const elevation = route.fbSpin < 0 ? 0.025 * Math.PI : 0;
  const horizontal = new Vec3(route.dx, 0, route.dz).normalize();
  const along = horizontal.clone().scale(Math.cos(elevation)).add(new Vec3(0, -Math.sin(elevation), 0));
  const up = horizontal.scale(Math.sin(elevation)).add(new Vec3(0, Math.cos(elevation), 0));
  const support = along.scale(-0.66).addScaled(up, 0.5 * radius + 0.01);
  const tip = up.scale(tipOffset);
  const direction = tip.sub(support).normalize();
  const projection = support.dot(direction);
  const contactDistance = -projection - Math.sqrt(projection * projection - support.lengthSq() + (radius + tipRadius) ** 2);
  const contact = support.addScaled(direction, contactDistance).add(sim.getCueBallPosition());
  const power = Math.min(1, Math.max(0, 0.3 + route.powerFactor));
  const speed = (0.5 + 11 * power) * (3.2 + 6 * power);
  return new Float32Array([contact.x, contact.y, contact.z, direction.x, direction.y, direction.z, speed, tipRadius]);
}
