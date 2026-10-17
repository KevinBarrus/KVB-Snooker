import { it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { MeshEdge, CollisionPolygon } from "../../src/core/physics/collision-polygon.js";
import { ObjectPool } from "../../src/core/physics/pool.js";
import { ContactSS } from "../../src/core/physics/contact.js";
import { ContactSP } from "../../src/core/physics/sp-contact.js";
import { ActiveContactSet } from "../../src/core/physics/actings.js";
import { ccd } from "../../src/core/physics/ccd.js";

it("probe initIslands", () => {
  const set = new ActiveContactSet(4);
  set.resize(11, 5);
  const a = new BodySphere(1, 1, 1.5, 0, 0);
  const b = new BodySphere(1, 1, 0, 0, 0);
  a.uid = 5; b.uid = 6;
  const poly = new CollisionPolygon(new Vec3(0, 1, 0), [
    new MeshEdge(new Vec3(0, 0.88, 0), new Vec3(10, 0.88, 0)),
    new MeshEdge(new Vec3(10, 0.88, 0), new Vec3(10, 0.88, 10))
  ]);
  poly.uid = 0;
  const mesh = { groups: [{ name: "ground", polys: [poly] }] };
  const ssPool = new ObjectPool<ContactSS>("ss", ContactSS, 4);
  const spPool = new ObjectPool<ContactSP>("sp", ContactSP, 4);
  ccd.initIslands([a, b], mesh, set, ssPool as never, spPool as never);
  console.log("islands:", set.nIslands, "items:", set.totalItems, "c5:", set.getNContacts(5), "c6:", set.getNContacts(6), "rest53:", set.isResting(5, 3), "rest60:", set.isResting(6, 0), "rest56:", set.isResting(5, 6));
});
