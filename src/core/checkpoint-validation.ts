export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid checkpoint object");
  return value as Record<string, unknown>;
}

export function finite(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error("Invalid checkpoint number");
  }
  return value;
}

export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, min, max);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid checkpoint integer");
  return result;
}

export function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid checkpoint string");
  return value;
}

export function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid checkpoint boolean");
  return value;
}

export function choice<T extends string | number>(value: unknown, values: readonly T[]): T {
  const result = values.find(item => item === value);
  if (result === undefined) throw new Error("Invalid checkpoint choice");
  return result;
}

export function list<T>(value: unknown, parse: (entry: unknown) => T, min = 0, max = 10000): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("Invalid checkpoint array");
  return value.map(parse);
}

export function nullable<T>(value: unknown, parse: (entry: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

export function requireCheckpoint(condition: boolean): asserts condition {
  if (!condition) throw new Error("Inconsistent or incompatible checkpoint");
}
