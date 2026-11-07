import { performance } from "node:perf_hooks";

export function serverNowMs(): number {
  return performance.timeOrigin + performance.now();
}
