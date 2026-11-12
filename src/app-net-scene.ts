import * as B from "babylonjs/es6.js";
import { Simulator } from "./core/simulator/simulator.js";
import { MeshBody, type CollisionMeshData } from "./core/physics/mesh-body.js";
import { applyTableGeometry } from "./core/physics/table-geometry.js";
import type { RemoteView } from "./net/remote-view.js";

interface DisplaySource extends Pick<Simulator, "getBallCount" | "getBallView" | "getCueBallPosition" | "getResult" | "predict"> {}
const DIGEST = "04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9";

export async function loadSimulator(): Promise<Simulator> {
  const response = await fetch("/assets/physics/table.json");
  if (!response.ok) throw new Error(`Physics table: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== DIGEST) throw new Error("Physics table digest mismatch");
  const mesh = new MeshBody(applyTableGeometry(JSON.parse(new TextDecoder().decode(bytes)) as CollisionMeshData));
  mesh.id = "tiger-club-sno-rgb";
  return new Simulator(mesh);
}

export function createDisplaySource(remote: RemoteView, simulator: Simulator): DisplaySource {
  return {
    getBallCount: () => remote.getBallCount(),
    getBallView: index => remote.getBallView(index),
    getCueBallPosition: () => remote.getCueBallPosition(),
    getResult: () => remote.getResult(),
    predict: (vars, maxDist) => {
      const checkpoint = remote.getCheckpoint();
      if (checkpoint) simulator.restore(checkpoint);
      return simulator.predict(vars, maxDist);
    }
  };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
