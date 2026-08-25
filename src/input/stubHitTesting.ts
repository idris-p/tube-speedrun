import type { Point } from "../data/types";

export function getSvgPoint(element: SVGGraphicsElement, clientX: number, clientY: number): Point | null {
  const matrix = element.getScreenCTM();
  if (!matrix) {
    return null;
  }
  const transformed = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

export function getStubHitDistance(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point,
): number | null {
  const segment = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  };
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared === 0) {
    return null;
  }

  const relativePoint = {
    x: point.x - segmentStart.x,
    y: point.y - segmentStart.y,
  };
  const progress =
    (relativePoint.x * segment.x + relativePoint.y * segment.y) / lengthSquared;
  if (progress < 0 || progress > 1) {
    return null;
  }

  const closestPoint = {
    x: segmentStart.x + segment.x * progress,
    y: segmentStart.y + segment.y * progress,
  };
  return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
}

export function getStubPathHitDistance(point: Point, path: readonly Point[]): number | null {
  let closestDistance: number | null = null;
  for (let index = 1; index < path.length; index += 1) {
    const distance = getStubHitDistance(point, path[index - 1], path[index]);
    if (distance !== null && (closestDistance === null || distance < closestDistance)) {
      closestDistance = distance;
    }
  }
  return closestDistance;
}

export function isPointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crossesHorizontalRay =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crossesHorizontalRay) {
      inside = !inside;
    }
  }
  return inside;
}
