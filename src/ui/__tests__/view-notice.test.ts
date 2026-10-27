import { expect, it } from "vitest";
import { ViewNotice } from "../view-notice.js";

it("观察模式提示替换旧文案并按时间自动消失", () => {
  const notice = new ViewNotice();
  notice.show("视线跟随母球"); notice.update(2);
  expect(notice.remaining).toBeGreaterThan(0);
  notice.show("视线跟随子球"); notice.update(.5);
  expect(notice.text).toBe("视线跟随子球");
  expect(notice.remaining).toBeCloseTo(1.7);
  notice.update(3); expect(notice.remaining).toBe(0);
});

it("手动关闭观察提示不改文案，新提示仍可自动过期", () => {
  const notice = new ViewNotice();
  notice.show("自然起身");
  notice.close();
  expect(notice.remaining).toBe(0);
  expect(notice.text).toBe("自然起身");
  notice.update(1);
  expect(notice.remaining).toBe(0);
  notice.show("视线跟随母球");
  expect(notice.remaining).toBe(2.2);
  notice.update(2.3);
  expect(notice.remaining).toBe(0);
});
