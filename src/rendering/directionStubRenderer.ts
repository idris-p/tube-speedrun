import { LINE_BY_ID } from "../data/lines";
import type { LineId, Point } from "../data/types";
import type { MovementDirection } from "../game/movement";
import { STUB_STROKE_WIDTH } from "./lineStyles";
import { sampleRoundedPathPoints } from "./roundedPath";

const SVG_NS = "http://www.w3.org/2000/svg";
const STUB_ARROW_FORWARD_EXTENSION = 4;
export const DEFAULT_DIRECTION_STUB_LENGTH = 40 + STUB_ARROW_FORWARD_EXTENSION;
const STUB_HIT_WIDTH = 40;
const STUB_ARROW_OUTER_CORNER_INSET = 14;
const STUB_ARROW_TAIL_INSET = 21 + STUB_ARROW_FORWARD_EXTENSION;
const STUB_ARROW_INNER_INSET = 12 + STUB_ARROW_FORWARD_EXTENSION;
const STUB_ARROW_OUTER_HALF_WIDTH = 13;
const STUB_ARROW_INNER_HALF_WIDTH = STUB_STROKE_WIDTH / 2;
const STUB_SHAFT_OVERLAP = 2;
const STUB_CORNER_RADIUS = 20;

export type DirectionStubRenderOptions = {
  lineId: LineId;
  start: Point;
  unit: Point;
  normal?: Point;
  routePoints?: Point[];
  offset?: number;
  length?: number;
  hitStartInset?: number;
  interaction?: {
    direction: MovementDirection;
    label: string;
  };
};

export function renderDirectionStub(
  layer: SVGGElement,
  {
    lineId,
    start,
    unit,
    normal = { x: -unit.y, y: unit.x },
    routePoints,
    offset = 0,
    length = DEFAULT_DIRECTION_STUB_LENGTH,
    hitStartInset = 0,
    interaction,
  }: DirectionStubRenderOptions,
): SVGGElement {
  const pathPoints = getDirectionStubPathPoints(routePoints, start, unit, normal, offset, length);
  const offsetStart = pathPoints[0];
  const hitPathPoints = getPolylineSlice(pathPoints, hitStartInset, length);
  const shaftPathPoints = getPolylineSlice(
    pathPoints,
    0,
    length - (STUB_ARROW_INNER_INSET - STUB_SHAFT_OVERLAP),
  );
  const arrowEnd = getDirectionStubArrowEnd(pathPoints, unit);

  const control = document.createElementNS(SVG_NS, "g");
  control.setAttribute("class", "direction-stub-control");
  control.style.transformOrigin = `${offsetStart.x}px ${offsetStart.y}px`;
  if (interaction) {
    control.setAttribute("role", "button");
    control.setAttribute("tabindex", "0");
    control.setAttribute("aria-label", interaction.label);
    control.dataset.movementDirection = interaction.direction;
  } else {
    control.setAttribute("aria-hidden", "true");
  }

  const hitTarget = document.createElementNS(SVG_NS, "path");
  hitTarget.setAttribute("d", getPolylinePathData(hitPathPoints));
  hitTarget.dataset.pathPoints = serializePathPoints(hitPathPoints);
  hitTarget.setAttribute("stroke", "transparent");
  hitTarget.setAttribute("stroke-width", String(STUB_HIT_WIDTH));
  hitTarget.setAttribute("stroke-linecap", "butt");
  hitTarget.setAttribute("stroke-linejoin", "round");
  hitTarget.setAttribute("fill", "none");
  hitTarget.setAttribute("class", "direction-stub-hit");
  control.append(hitTarget);

  const visual = document.createElementNS(SVG_NS, "g");
  visual.setAttribute("class", "direction-stub-visual");
  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("d", getPolylinePathData(shaftPathPoints));
  line.dataset.pathPoints = serializePathPoints(shaftPathPoints);
  line.setAttribute("stroke", LINE_BY_ID[lineId].color);
  line.setAttribute("stroke-width", String(STUB_STROKE_WIDTH));
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("fill", "none");
  line.setAttribute("class", "direction-stub");
  if (lineId === "walk") {
    line.setAttribute("stroke-dasharray", "8 6");
  }
  visual.append(line);

  const arrowHead = document.createElementNS(SVG_NS, "polygon");
  arrowHead.setAttribute(
    "points",
    getStubArrowHeadPoints(arrowEnd, unit, normal)
      .map((point) => `${point.x},${point.y}`)
      .join(" "),
  );
  arrowHead.setAttribute("fill", LINE_BY_ID[lineId].color);
  arrowHead.setAttribute("class", "direction-stub-arrowhead");
  visual.append(arrowHead);

  control.append(visual);
  layer.append(control);
  return control;
}

export function getDirectionStubPathPoints(
  routePoints: Point[] | undefined,
  start: Point,
  unit: Point,
  normal: Point,
  offset: number,
  length: number,
): Point[] {
  const offsetStart = {
    x: start.x + normal.x * offset,
    y: start.y + normal.y * offset,
  };
  if (!routePoints || routePoints.length < 2) {
    return [
      offsetStart,
      {
        x: offsetStart.x + unit.x * length,
        y: offsetStart.y + unit.y * length,
      },
    ];
  }

  const routeStart = routePoints[0];
  const alignedRoute = routePoints.map((point) => ({
    x: point.x + offsetStart.x - routeStart.x,
    y: point.y + offsetStart.y - routeStart.y,
  }));
  const sampledRoute = sampleRoundedPathPoints(alignedRoute, STUB_CORNER_RADIUS);
  return extendAndCropPolyline(sampledRoute, length, unit);
}

export function getStubArrowHeadPoints(end: Point, unit: Point, normal: Point): Point[] {
  const point = (inset: number, normalOffset: number): Point => ({
    x: end.x - unit.x * inset + normal.x * normalOffset,
    y: end.y - unit.y * inset + normal.y * normalOffset,
  });
  return [
    end,
    point(STUB_ARROW_OUTER_CORNER_INSET, STUB_ARROW_OUTER_HALF_WIDTH),
    point(STUB_ARROW_TAIL_INSET, STUB_ARROW_OUTER_HALF_WIDTH),
    point(STUB_ARROW_INNER_INSET, STUB_ARROW_INNER_HALF_WIDTH),
    point(STUB_ARROW_INNER_INSET, -STUB_ARROW_INNER_HALF_WIDTH),
    point(STUB_ARROW_TAIL_INSET, -STUB_ARROW_OUTER_HALF_WIDTH),
    point(STUB_ARROW_OUTER_CORNER_INSET, -STUB_ARROW_OUTER_HALF_WIDTH),
  ];
}

export function getStubShaftEnd(end: Point, unit: Point): Point {
  return {
    x: end.x - unit.x * (STUB_ARROW_INNER_INSET - STUB_SHAFT_OVERLAP),
    y: end.y - unit.y * (STUB_ARROW_INNER_INSET - STUB_SHAFT_OVERLAP),
  };
}

export function getDirectionStubArrowEnd(pathPoints: Point[], unit: Point): Point {
  const pathLength = getPolylineLength(pathPoints);
  const shaftEndDistance = Math.max(
    0,
    pathLength - (STUB_ARROW_INNER_INSET - STUB_SHAFT_OVERLAP),
  );
  const shaftEnd = getPointAtPolylineDistance(
    pathPoints,
    getCumulativeLengths(pathPoints),
    shaftEndDistance,
  );
  return {
    x: shaftEnd.x + unit.x * STUB_ARROW_OUTER_CORNER_INSET,
    y: shaftEnd.y + unit.y * STUB_ARROW_OUTER_CORNER_INSET,
  };
}

function extendAndCropPolyline(points: Point[], length: number, fallbackUnit: Point): Point[] {
  const targetLength = Math.max(0, length);
  const currentLength = getPolylineLength(points);
  if (currentLength >= targetLength) {
    return getPolylineSlice(points, 0, targetLength);
  }

  const end = points.at(-1) ?? { x: 0, y: 0 };
  const finalUnit = getFinalUnit(points, fallbackUnit);
  return [
    ...points,
    {
      x: end.x + finalUnit.x * (targetLength - currentLength),
      y: end.y + finalUnit.y * (targetLength - currentLength),
    },
  ];
}

function getPolylineSlice(points: Point[], fromDistance: number, toDistance: number): Point[] {
  if (points.length < 2) return points;
  const cumulativeLengths = getCumulativeLengths(points);
  const totalLength = cumulativeLengths.at(-1)!;
  const startDistance = Math.max(0, Math.min(totalLength, fromDistance));
  const endDistance = Math.max(startDistance, Math.min(totalLength, toDistance));
  const result = [getPointAtPolylineDistance(points, cumulativeLengths, startDistance)];

  for (let index = 1; index < points.length - 1; index += 1) {
    if (cumulativeLengths[index] > startDistance && cumulativeLengths[index] < endDistance) {
      result.push(points[index]);
    }
  }
  appendDistinctPoint(result, getPointAtPolylineDistance(points, cumulativeLengths, endDistance));
  return result;
}

function getPointAtPolylineDistance(
  points: Point[],
  cumulativeLengths: number[],
  distance: number,
): Point {
  for (let index = 1; index < points.length; index += 1) {
    if (cumulativeLengths[index] < distance) continue;
    const segmentStartDistance = cumulativeLengths[index - 1];
    const segmentLength = cumulativeLengths[index] - segmentStartDistance;
    if (segmentLength === 0) return points[index];
    const progress = (distance - segmentStartDistance) / segmentLength;
    return {
      x: points[index - 1].x + (points[index].x - points[index - 1].x) * progress,
      y: points[index - 1].y + (points[index].y - points[index - 1].y) * progress,
    };
  }
  return points.at(-1)!;
}

function getPolylineLength(points: Point[]): number {
  return getCumulativeLengths(points).at(-1) ?? 0;
}

function getCumulativeLengths(points: Point[]): number[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(
      lengths[index - 1] + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      ),
    );
  }
  return lengths;
}

function getFinalUnit(points: Point[], fallback: Point): Point {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const delta = {
      x: points[index].x - points[index - 1].x,
      y: points[index].y - points[index - 1].y,
    };
    const length = Math.hypot(delta.x, delta.y);
    if (length > 0) {
      return { x: delta.x / length, y: delta.y / length };
    }
  }
  return fallback;
}

function appendDistinctPoint(points: Point[], point: Point): void {
  const previous = points.at(-1);
  if (!previous || previous.x !== point.x || previous.y !== point.y) {
    points.push(point);
  }
}

function getPolylinePathData(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function serializePathPoints(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
