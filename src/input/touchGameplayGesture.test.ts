import { describe, expect, it } from "vitest";
import {
  beginTouchGameplayGesture,
  cancelTouchGameplayGesture,
  getTouchGameplayAction,
  TOUCH_SWIPE_MIN_DISTANCE,
  updateTouchGameplayGesture,
} from "./touchGameplayGesture";

describe("touch gameplay gestures", () => {
  it.each([
    [40, 0, "east"],
    [40, 40, "southeast"],
    [0, 40, "south"],
    [-40, 40, "southwest"],
    [-40, 0, "west"],
    [-40, -40, "northwest"],
    [0, -40, "north"],
    [40, -40, "northeast"],
  ] as const)("snaps a swipe vector (%s, %s) to %s", (dx, dy, direction) => {
    let gesture = beginTouchGameplayGesture(7, { x: 100, y: 100 });
    gesture = updateTouchGameplayGesture(gesture, 7, { x: 100 + dx, y: 100 + dy });

    expect(getTouchGameplayAction(gesture, 200)).toEqual({ type: "move", direction });
  });

  it("cycles backward or forward for taps on the corresponding half", () => {
    const leftTap = beginTouchGameplayGesture(7, { x: 80, y: 100 });
    const rightTap = beginTouchGameplayGesture(8, { x: 320, y: 100 });

    expect(getTouchGameplayAction(leftTap, 200)).toEqual({ type: "cycle-line", offset: -1 });
    expect(getTouchGameplayAction(rightTap, 200)).toEqual({ type: "cycle-line", offset: 1 });
  });

  it("does not treat a swipe that returns to its start as a tap", () => {
    let gesture = beginTouchGameplayGesture(7, { x: 80, y: 100 });
    gesture = updateTouchGameplayGesture(
      gesture,
      7,
      { x: 80 + TOUCH_SWIPE_MIN_DISTANCE + 10, y: 100 },
    );
    gesture = updateTouchGameplayGesture(gesture, 7, { x: 82, y: 100 });

    expect(getTouchGameplayAction(gesture, 200)).toBeNull();
  });

  it("ignores cancelled multi-touch gestures", () => {
    const gesture = cancelTouchGameplayGesture(
      beginTouchGameplayGesture(7, { x: 80, y: 100 }),
    );

    expect(getTouchGameplayAction(gesture, 200)).toBeNull();
  });
});
