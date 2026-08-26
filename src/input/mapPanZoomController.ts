import type { Point } from "../data/types";
import type { MapRenderer } from "../rendering/mapRenderer";
import { getPinchGesture, type PinchGesture } from "./pinchZoom";

export type MapPanZoomBinding = {
  reset: () => void;
  dispose: () => void;
};

export function bindMapPanZoom(
  renderer: MapRenderer,
  render: () => void,
): MapPanZoomBinding {
  const { svg } = renderer;
  let panPointerId: number | null = null;
  let lastPanPoint: Point | null = null;
  const touchPoints = new Map<number, Point>();
  let pinchGesture: PinchGesture | null = null;

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    renderer.zoomByWheel(event.deltaY, { x: event.clientX, y: event.clientY });
    render();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      svg.setPointerCapture(event.pointerId);
      if (touchPoints.size >= 2) {
        pinchGesture = getPinchGesture(touchPoints);
        panPointerId = null;
        lastPanPoint = null;
      } else {
        panPointerId = event.pointerId;
        lastPanPoint = { x: event.clientX, y: event.clientY };
      }
    } else {
      panPointerId = event.pointerId;
      lastPanPoint = { x: event.clientX, y: event.clientY };
      svg.setPointerCapture(event.pointerId);
    }
    svg.classList.add("tube-map-panning");
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size >= 2) {
        const nextGesture = getPinchGesture(touchPoints);
        if (pinchGesture && nextGesture) {
          renderer.panByClientDelta(
            nextGesture.midpoint.x - pinchGesture.midpoint.x,
            nextGesture.midpoint.y - pinchGesture.midpoint.y,
          );
          renderer.zoomByFactor(nextGesture.distance / pinchGesture.distance, nextGesture.midpoint);
        }
        pinchGesture = nextGesture;
        render();
        event.preventDefault();
        return;
      }
    }
    if (panPointerId !== event.pointerId || !lastPanPoint) return;
    renderer.panByClientDelta(event.clientX - lastPanPoint.x, event.clientY - lastPanPoint.y);
    lastPanPoint = { x: event.clientX, y: event.clientY };
    render();
    svg.classList.add("tube-map-panning");
  };

  const endPointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && touchPoints.delete(event.pointerId)) {
      releasePointer(event.pointerId);
      const remainingTouch = touchPoints.entries().next().value as [number, Point] | undefined;
      pinchGesture = null;
      if (remainingTouch) {
        panPointerId = remainingTouch[0];
        lastPanPoint = remainingTouch[1];
      } else {
        stopPanning();
      }
      return;
    }
    if (panPointerId !== event.pointerId) return;
    releasePointer(event.pointerId);
    stopPanning();
  };

  const releasePointer = (pointerId: number): void => {
    if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
  };

  const stopPanning = (): void => {
    panPointerId = null;
    lastPanPoint = null;
    svg.classList.remove("tube-map-panning");
  };

  const reset = (): void => {
    for (const pointerId of touchPoints.keys()) releasePointer(pointerId);
    if (panPointerId !== null) releasePointer(panPointerId);
    touchPoints.clear();
    pinchGesture = null;
    stopPanning();
  };

  const dispose = (): void => {
    reset();
    svg.removeEventListener("wheel", handleWheel);
    svg.removeEventListener("pointerdown", handlePointerDown);
    svg.removeEventListener("pointermove", handlePointerMove);
    svg.removeEventListener("pointerup", endPointer);
    svg.removeEventListener("pointercancel", endPointer);
    svg.removeEventListener("lostpointercapture", endPointer);
  };

  svg.addEventListener("wheel", handleWheel, { passive: false });
  svg.addEventListener("pointerdown", handlePointerDown);
  svg.addEventListener("pointermove", handlePointerMove);
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("lostpointercapture", endPointer);
  return { reset, dispose };
}
