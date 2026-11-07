import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD, PointerGesture } from "../pointer-gesture.js";

describe("PointerGesture", () => {
  it("未超过阈值松开算点击，超过阈值算拖动", () => {
    const gesture = new PointerGesture();
    expect(gesture.down(1, 100, 100)).toBe(true);
    expect(gesture.move(1, 100 + DRAG_THRESHOLD, 100)).toEqual({ dragging: false, dx: 0, dy: 0 });
    expect(gesture.up(1)).toBe("click");
    expect(gesture.active).toBe(false);
    gesture.down(2, 100, 100);
    expect(gesture.move(2, 100 + DRAG_THRESHOLD + 1, 100)).toEqual({ dragging: true, dx: DRAG_THRESHOLD + 1, dy: 0 });
    expect(gesture.up(2)).toBe("drag");
  });

  it("越过阈值时给出从按下点累计的位移，之后给每次移动的增量", () => {
    const gesture = new PointerGesture();
    gesture.down(1, 100, 100);
    expect(gesture.move(1, 100, 103)).toEqual({ dragging: false, dx: 0, dy: 0 });
    expect(gesture.move(1, 100, 110)).toEqual({ dragging: true, dx: 0, dy: 10 });
    expect(gesture.move(1, 100, 114)).toEqual({ dragging: true, dx: 0, dy: 4 });
  });

  it("忽略其他指针，并可取消当前手势", () => {
    const gesture = new PointerGesture();
    gesture.down(1, 0, 0);
    expect(gesture.down(2, 0, 0)).toBe(false);
    expect(gesture.move(2, 50, 50)).toBeNull();
    expect(gesture.up(2)).toBeNull();
    gesture.cancel();
    expect(gesture.active).toBe(false);
    expect(gesture.up(1)).toBeNull();
  });
});
