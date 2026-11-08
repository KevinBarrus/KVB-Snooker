import {
  CUSTOM_SHAPE_LIMIT, normalizeShapeName, isValidShapeName, parseCustomShape, purgeExpiredShapes,
  type CustomShapeBall, type CustomShapeRecord, type CustomShapesSnapshot
} from "./core/practice/custom-shapes.js";

export interface CreateShapeResult {
  readonly ok: boolean;
  readonly record?: CustomShapeRecord;
  readonly reason?: "full" | "invalid";
}

export type RestoreShapeResult = "ok" | "full" | "missing";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredFile {
  readonly version: 1;
  readonly shapes: readonly CustomShapeRecord[];
}

const STORAGE_KEY = "snk.practice.shapes.v1";

function sortByCreatedAt(records: readonly CustomShapeRecord[]): CustomShapeRecord[] {
  return [...records].sort((left, right) => right.createdAt - left.createdAt);
}

export class MyShapesStore {
  constructor(private readonly storage: KeyValueStorage,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => crypto.randomUUID()) {}

  load(): CustomShapesSnapshot {
    const now = this.now();
    const records = this.read();
    const purged = purgeExpiredShapes(records, now);
    if (purged.length !== records.length) this.write(purged);
    return {
      active: sortByCreatedAt(purged.filter(record => record.deletedAt === null)),
      recycle: [...purged.filter(record => record.deletedAt !== null)]
        .sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0))
    };
  }

  create(name: string, balls: readonly CustomShapeBall[]): CreateShapeResult {
    const normalized = normalizeShapeName(name);
    if (!isValidShapeName(normalized)) return { ok: false, reason: "invalid" };
    const records = this.read();
    if (records.filter(record => record.deletedAt === null).length >= CUSTOM_SHAPE_LIMIT) {
      return { ok: false, reason: "full" };
    }
    const record: CustomShapeRecord = {
      id: this.newId(), name: normalized, balls: balls.map(ball => ({ ...ball })),
      createdAt: this.now(), deletedAt: null
    };
    this.write([...records, record]);
    return { ok: true, record };
  }

  saveLayout(id: string, balls: readonly CustomShapeBall[]): boolean {
    const records = this.read();
    const record = records.find(entry => entry.id === id);
    if (!record) return false;
    this.write(records.map(entry => entry.id === id
      ? { ...entry, balls: balls.map(ball => ({ ...ball })) } : entry));
    return true;
  }

  rename(id: string, name: string): boolean {
    const normalized = normalizeShapeName(name);
    if (!isValidShapeName(normalized)) return false;
    const records = this.read();
    if (!records.some(entry => entry.id === id)) return false;
    this.write(records.map(entry => entry.id === id ? { ...entry, name: normalized } : entry));
    return true;
  }

  remove(id: string): boolean {
    const records = this.read();
    const record = records.find(entry => entry.id === id);
    if (!record || record.deletedAt !== null) return false;
    const now = this.now();
    this.write(records.map(entry => entry.id === id ? { ...entry, deletedAt: now } : entry));
    return true;
  }

  restore(id: string): RestoreShapeResult {
    const records = this.read();
    const record = records.find(entry => entry.id === id);
    if (!record || record.deletedAt === null) return "missing";
    if (records.filter(entry => entry.deletedAt === null).length >= CUSTOM_SHAPE_LIMIT) return "full";
    this.write(records.map(entry => entry.id === id ? { ...entry, deletedAt: null } : entry));
    return "ok";
  }

  purge(id: string): boolean {
    const records = this.read();
    const record = records.find(entry => entry.id === id);
    if (!record) return false;
    this.write(records.filter(entry => entry.id !== id));
    return true;
  }

  private read(): CustomShapeRecord[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<StoredFile>;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shapes)) return [];
      return parsed.shapes.map(parseCustomShape).filter((record): record is CustomShapeRecord => record !== null);
    } catch {
      return [];
    }
  }

  private write(records: readonly CustomShapeRecord[]): void {
    const file: StoredFile = { version: 1, shapes: records };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(file));
  }
}

export { STORAGE_KEY };
