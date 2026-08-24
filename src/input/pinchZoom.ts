import type { Point } from "../data/types";

export type PinchGesture = {
  midpoint: Point;
  distance: number;
};

export function getPinchGesture(points: ReadonlyMap<number, Point>): PinchGesture | null {
  const iterator = points.values();
  const first = iterator.next().value as Point | undefined;
  const second = iterator.next().value as Point | undefined;
  if (!first || !second) {
    return null;
  }

  const distance = Math.hypot(second.x - first.x, second.y - first.y);
  if (distance < 1) {
    return null;
  }
  return {
    midpoint: {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    },
    distance,
  };
}
