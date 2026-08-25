import type { Point } from "../data/types";
import { directionFromVelocity, type MovementDirection } from "../game/movement";

export const TOUCH_SWIPE_MIN_DISTANCE = 36;

export type TouchGameplayGesture = {
  pointerId: number;
  start: Point;
  current: Point;
  maximumDistance: number;
  cancelled: boolean;
};

export type TouchGameplayAction =
  | { type: "move"; direction: MovementDirection }
  | { type: "cycle-line"; offset: -1 | 1 };

export function beginTouchGameplayGesture(
  pointerId: number,
  point: Point,
): TouchGameplayGesture {
  return {
    pointerId,
    start: point,
    current: point,
    maximumDistance: 0,
    cancelled: false,
  };
}

export function updateTouchGameplayGesture(
  gesture: TouchGameplayGesture,
  pointerId: number,
  point: Point,
): TouchGameplayGesture {
  if (gesture.pointerId !== pointerId) return gesture;
  return {
    ...gesture,
    current: point,
    maximumDistance: Math.max(
      gesture.maximumDistance,
      Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y),
    ),
  };
}

export function cancelTouchGameplayGesture(
  gesture: TouchGameplayGesture,
): TouchGameplayGesture {
  return { ...gesture, cancelled: true };
}

export function getTouchGameplayAction(
  gesture: TouchGameplayGesture,
  gameplayMidpointX: number,
  minimumSwipeDistance = TOUCH_SWIPE_MIN_DISTANCE,
): TouchGameplayAction | null {
  if (gesture.cancelled) return null;

  const dx = gesture.current.x - gesture.start.x;
  const dy = gesture.current.y - gesture.start.y;
  const releaseDistance = Math.hypot(dx, dy);
  const crossedSwipeThreshold = Math.max(gesture.maximumDistance, releaseDistance) >=
    minimumSwipeDistance;

  if (crossedSwipeThreshold) {
    if (releaseDistance < minimumSwipeDistance) return null;
    return {
      type: "move",
      direction: directionFromVelocity(dx, dy, "east", minimumSwipeDistance),
    };
  }

  return {
    type: "cycle-line",
    offset: gesture.start.x < gameplayMidpointX ? -1 : 1,
  };
}
