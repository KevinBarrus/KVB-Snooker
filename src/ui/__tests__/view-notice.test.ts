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
