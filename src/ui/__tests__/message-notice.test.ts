import { expect, it } from "vitest";
import { FoulNotice } from "../foul-notice.js";

it("贴球消息沿用犯规计时公式，到时自动消失并保持关闭", () => {
  const notice = new FoulNotice();
  notice.show("TOUCHING BALL", "Play away without moving the red.");
  const duration = 1 + .08 * (notice.head.length + notice.body.length);
  expect(notice.autoCloseTimer).toBe(duration);
  notice.update(duration - .1);
  expect(notice.active).toBe(true);
  notice.update(.2);
  expect(notice.active).toBe(false);
  notice.update(20);
  expect(notice.active).toBe(false);
});

it("手动关闭取消计时，新消息可以再次显示且上限仍为15秒", () => {
  const notice = new FoulNotice();
  notice.show("TOUCHING BALL", "red");
  notice.close();
  expect(notice.active).toBe(false);
  expect(notice.autoCloseTimer).toBe(-1);
  notice.show("TOUCHING BALL", "red ".repeat(100));
  expect(notice.active).toBe(true);
  expect(notice.autoCloseTimer).toBe(15);
  notice.showFoul(-4, "MISS TARGET.");
  expect(notice.head).toBe("FOUL");
  expect(notice.body).toBe("-4: MISS TARGET.");
  expect(notice.autoCloseTimer).toBe(1 + .08 * (notice.head.length + notice.body.length));
});
