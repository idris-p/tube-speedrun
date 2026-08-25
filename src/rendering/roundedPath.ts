import type { Point } from "../data/types";

export function createRoundedPathData(points: Point[], radius: number): string {
  const simplified = simplifyPolylinePoints(points);
  if (simplified.length === 0) return "";
  if (simplified.length === 1) return `M ${formatPoint(simplified[0])}`;

  const commands = [`M ${formatPoint(simplified[0])}`];
  for (let index = 1; index < simplified.length - 1; index += 1) {
    const previous = simplified[index - 1];
    const corner = simplified[index];
    const next = simplified[index + 1];
    const incomingLength = distance(previous, corner);
    const outgoingLength = distance(corner, next);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const beforeCorner = pointTowards(corner, previous, cornerRadius);
    const afterCorner = pointTowards(corner, next, cornerRadius);

    commands.push(`L ${formatPoint(beforeCorner)}`, `Q ${formatPoint(corner)} ${formatPoint(afterCorner)}`);
  }
  commands.push(`L ${formatPoint(simplified[simplified.length - 1])}`);
  return commands.join(" ");
}

export function sampleRoundedPathPoints(
  points: Point[],
  radius: number,
  maximumCurveSegmentLength = 2,
): Point[] {
  const simplified = simplifyPolylinePoints(points);
  if (simplified.length < 3) return simplified;

  const sampled = [simplified[0]];
  for (let index = 1; index < simplified.length - 1; index += 1) {
    const previous = simplified[index - 1];
    const corner = simplified[index];
    const next = simplified[index + 1];
    const incomingLength = distance(previous, corner);
    const outgoingLength = distance(corner, next);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const beforeCorner = pointTowards(corner, previous, cornerRadius);
    const afterCorner = pointTowards(corner, next, cornerRadius);
    appendDistinctPoint(sampled, beforeCorner);

    const estimatedCurveLength = distance(beforeCorner, corner) + distance(corner, afterCorner);
    const stepCount = Math.max(1, Math.ceil(estimatedCurveLength / maximumCurveSegmentLength));
    for (let step = 1; step <= stepCount; step += 1) {
      const progress = step / stepCount;
      appendDistinctPoint(sampled, quadraticPoint(beforeCorner, corner, afterCorner, progress));
    }
  }
  appendDistinctPoint(sampled, simplified.at(-1)!);
  return sampled;
}

export function simplifyPolylinePoints(points: Point[]): Point[] {
  const deduplicated = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  if (deduplicated.length < 3) return deduplicated;

  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    const incoming = { x: point.x - previous.x, y: point.y - previous.y };
    const outgoing = { x: next.x - point.x, y: next.y - point.y };
    const crossProduct = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dotProduct = incoming.x * outgoing.x + incoming.y * outgoing.y;
    return crossProduct !== 0 || dotProduct <= 0;
  });
}

function pointTowards(from: Point, to: Point, distanceFromStart: number): Point {
  const segmentLength = distance(from, to);
  if (segmentLength === 0) return from;
  const scale = distanceFromStart / segmentLength;
  return {
    x: from.x + (to.x - from.x) * scale,
    y: from.y + (to.y - from.y) * scale,
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, progress: number): Point {
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
  };
}

function appendDistinctPoint(points: Point[], point: Point): void {
  const previous = points.at(-1);
  if (!previous || previous.x !== point.x || previous.y !== point.y) {
    points.push(point);
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
