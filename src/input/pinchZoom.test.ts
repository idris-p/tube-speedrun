import { describe, expect, it } from "vitest";
import { getPinchGesture } from "./pinchZoom";

describe("pinch zoom gesture", () => {
  it("measures the midpoint and distance between two touches", () => {
    expect(getPinchGesture(new Map([
      [3, { x: 20, y: 30 }],
      [7, { x: 80, y: 110 }],
    ]))).toEqual({
      midpoint: { x: 50, y: 70 },
      distance: 100,
    });
  });

  it("waits for two distinct touch points", () => {
    expect(getPinchGesture(new Map([[3, { x: 20, y: 30 }]]))).toBeNull();
    expect(getPinchGesture(new Map([
      [3, { x: 20, y: 30 }],
      [7, { x: 20.2, y: 30.2 }],
    ]))).toBeNull();
  });
});
