import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MeshBody, type CollisionMeshData } from "../core/physics/mesh-body.js";

/** 与 src/app.ts 使用同一份物理台面资源与摘要（architecture §4.3）。 */
export const PHYSICS_TABLE_PATH = "public/assets/physics/table.json";
export const PHYSICS_TABLE_SHA256 = "04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9";
/** 客户端用 SerialData.mbid 校验 restore 目标，服务器必须与 src/app.ts 一致。 */
export const TABLE_MESH_ID = "tiger-club-sno-rgb";

export interface LoadedTable {
  readonly path: string;
  readonly sha256: string;
  readonly data: CollisionMeshData;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));
}

function isCollisionFlag(value: unknown): boolean {
  return typeof value === "string" &&
    ["ground", "sidehard", "sidesoft", "pocket", "tunnel", "end"].includes(value);
}

/** 与 core 模 84 的输入形状一致的最小结构校验，避免把坏 JSON 当作台面。 */
export function isCollisionMeshData(data: unknown): data is CollisionMeshData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data).every((group: unknown) => {
    if (!group || typeof group !== "object" || !("p" in group) || !("q" in group)) return false;
    if (!isNumberArray(group.p) || group.p.length % 3 !== 0 || !Array.isArray(group.q)) return false;
    const vertices = group.p.length / 3;
    return group.q.every((poly: unknown) => {
      if (!poly || typeof poly !== "object" || !("i" in poly) || !("n" in poly)) return false;
      return isNumberArray(poly.i) && poly.i.length >= 3 &&
        poly.i.every(index => Number.isInteger(index) && index >= 0 && index < vertices) &&
        isNumberArray(poly.n) && poly.n.length === 3 &&
        (!("f" in poly) || (Array.isArray(poly.f) && poly.f.every(isCollisionFlag))) &&
        (!("s" in poly) || (isNumberArray(poly.s) && poly.s.length === 4)) &&
        (!("uv" in poly) || isNumberArray(poly.uv));
    });
  });
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export async function loadPhysicsTable(path = PHYSICS_TABLE_PATH): Promise<LoadedTable> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`物理台面资产缺失：${path}。请先运行 npm run assets:prepare 生成 public/assets/physics/table.json`);
    }
    throw error;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== PHYSICS_TABLE_SHA256) {
    throw new Error(`物理台面摘要不符：${path} 期望 ${PHYSICS_TABLE_SHA256}，实际 ${sha256}`);
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isCollisionMeshData(parsed)) throw new Error(`物理台面结构非法：${path}`);
  return { path, sha256, data: parsed };
}

/** 每个房间拥有独立 MeshBody；只共享已校验的只读 JSON 数据。 */
export function createTableMesh(data: CollisionMeshData): MeshBody {
  const mesh = new MeshBody(data);
  mesh.id = TABLE_MESH_ID;
  return mesh;
}
