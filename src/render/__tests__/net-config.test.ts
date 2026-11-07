import { describe, expect, it } from "vitest";
import { parseConfig } from "../../app-net-support.js";

describe("联机显示缓冲配置", () => {
  it.each([
    ["", 100], ["&interp=0", 0], ["&interp=500", 500], ["&interp=-1", 100], ["&interp=oops", 100]
  ])("显式 server 下 interp %s 使用 %ims", (query, expected) => {
    const config = parseConfig(`?net=test&server=ws://localhost:8787/net${query}`);
    expect(config?.interpolationDelayMs).toBe(expected);
  });
});
