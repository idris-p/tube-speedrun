import { LINE_BY_ID } from "../data/lines";
import { getNetworkIndex } from "../data/networkIndex";
import type { Connection, NetworkData, Point } from "../data/types";
import { gridPointToSvgPoint } from "./grid";
import { LINE_STROKE_WIDTH } from "./lineStyles";
import { getCanonicalPath, offsetPolylinePoints } from "./pathOffset";
import { createRoundedPathData, simplifyPolylinePoints } from "./roundedPath";

const SVG_NS = "http://www.w3.org/2000/svg";
const LINE_CORNER_RADIUS = 20;
const LOOP_ARROW_ARM_LENGTH = 10;
const WALK_LINE_DASH_PATTERN = [12, 10] as const;
const pathLengthByData = new Map<string, number>();

export type LineRevealRenderOptions = {
  fromStationId: string;
  progress: number;
};

export function renderRevealedLine(
  layer: SVGGElement,
  connection: Connection,
  network: NetworkData,
  offset = 0,
  connectionPoints?: Point[],
  reveal?: LineRevealRenderOptions | null,
): void {
  const stations = getNetworkIndex(network).stationById;
  const hasFromStation = stations.has(connection.from);
  const hasToStation = stations.has(connection.to);

  if (!hasFromStation || !hasToStation) {
    return;
  }

  const path = document.createElementNS(SVG_NS, "path");
  const basePoints = connectionPoints
    ? getCanonicalPath(connectionPoints)
    : simplifyPolylinePoints(getCanonicalPath(connection.path).map(gridPointToSvgPoint));
  const points = offsetPolylinePoints(
    basePoints,
    offset,
  );
  const orientedPoints = reveal ? orientPointsFromStation(points, connection, connectionPoints, network, reveal.fromStationId) : points;
  path.setAttribute("d", createRoundedPathData(orientedPoints, LINE_CORNER_RADIUS));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", LINE_BY_ID[connection.line].color);
  path.setAttribute("stroke-width", String(LINE_STROKE_WIDTH));
  path.setAttribute("stroke-linecap", "butt");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("class", reveal ? "map-line map-line-growing" : "map-line");
  if (connection.line === "walk") {
    path.setAttribute("stroke-dasharray", WALK_LINE_DASH_PATTERN.join(" "));
  }
  layer.append(path);
  if (reveal) {
    applyLineRevealProgress(path, reveal.progress, connection.line === "walk");
  }

  if (connection.oneWay && connection.line !== "walk") {
    for (const arrow of getOneWayArrowLineSegments(connection)) {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "one-way-line-arrow");
      for (const segment of arrow) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(segment.from.x));
        line.setAttribute("y1", String(segment.from.y));
        line.setAttribute("x2", String(segment.to.x));
        line.setAttribute("y2", String(segment.to.y));
        group.append(line);
      }
      layer.append(group);
    }
  }
}

function applyLineRevealProgress(path: SVGPathElement, progress: number, preserveWalkDashes: boolean): void {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const pathData = path.getAttribute("d") ?? "";
  let length = pathLengthByData.get(pathData);
  if (length === undefined) {
    length = path.getTotalLength();
    pathLengthByData.set(pathData, length);
  }
  if (preserveWalkDashes) {
    path.style.strokeDasharray = getWalkRevealDashArray(length, clampedProgress);
    path.style.strokeDashoffset = "0";
    return;
  }

  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length * (1 - clampedProgress));
}

export function getWalkRevealDashArray(totalLength: number, progress: number): string {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const revealLength = totalLength * clampedProgress;
  if (revealLength <= 0) {
    return `0 ${Math.max(0, totalLength)}`;
  }
  if (revealLength >= totalLength) {
    return WALK_LINE_DASH_PATTERN.join(" ");
  }

  const dashArray: number[] = [];
  let remainingRevealLength = revealLength;
  let patternIndex = 0;
  while (remainingRevealLength > 0) {
    const segmentLength = Math.min(WALK_LINE_DASH_PATTERN[patternIndex], remainingRevealLength);
    dashArray.push(segmentLength);
    remainingRevealLength -= segmentLength;
    patternIndex = patternIndex === 0 ? 1 : 0;
  }

  if (dashArray.length % 2 === 0) {
    dashArray.push(0);
  }
  dashArray.push(Math.max(0, totalLength - revealLength));
  return dashArray.join(" ");
}

function orientPointsFromStation(
  points: Point[],
  connection: Connection,
  connectionPoints: Point[] | undefined,
  network: NetworkData,
  stationId: string,
): Point[] {
  const [canonicalStartStationId] = getCanonicalEndpointStationIds(connection, connectionPoints, network);
  return canonicalStartStationId === stationId ? points : [...points].reverse();
}

function getCanonicalEndpointStationIds(
  connection: Connection,
  connectionPoints: Point[] | undefined,
  network: NetworkData,
): [string, string] {
  const rawPoints = connectionPoints ?? simplifyPolylinePoints(connection.path.map(gridPointToSvgPoint));
  const rawEndpointStationIds = getRawEndpointStationIds(connection, network);
  const canonicalPoints = getCanonicalPath(rawPoints);
  return pointsMatch(canonicalPoints[0], rawPoints[0])
    ? rawEndpointStationIds
    : [rawEndpointStationIds[1], rawEndpointStationIds[0]];
}

function getRawEndpointStationIds(connection: Connection, network: NetworkData): [string, string] {
  const fromStation = getNetworkIndex(network).stationById.get(connection.from);
  if (!fromStation) return [connection.from, connection.to];
  return pointsMatch(gridPointToSvgPoint(connection.path[0]), gridPointToSvgPoint(fromStation))
    ? [connection.from, connection.to]
    : [connection.to, connection.from];
}

function pointsMatch(first: Point, second: Point): boolean {
  return Math.abs(first.x - second.x) < 0.01 && Math.abs(first.y - second.y) < 0.01;
}

export type OneWayArrowLineSegment = {
  from: Point;
  to: Point;
};

export function getOneWayArrowLineSegments(connection: Connection): OneWayArrowLineSegment[][] {
  if (connection.line !== "piccadilly") return [];
  if (connection.from === "hatton-cross" && connection.to === "heathrow-terminal-4") {
    return [createLoopChevron(gridPointToSvgPoint({ x: -62, y: 38 }), "down")];
  }
  if (connection.from === "heathrow-terminal-4" && connection.to === "heathrow-terminal-2-and-3") {
    return [createLoopChevron(gridPointToSvgPoint({ x: -70, y: 41 }), "up")];
  }
  return [];
}

function createLoopChevron(point: Point, direction: "down" | "up"): OneWayArrowLineSegment[] {
  const tip = point;
  const verticalSign = direction === "down" ? -1 : 1;
  return [
    {
      from: {
        x: tip.x - LOOP_ARROW_ARM_LENGTH,
        y: tip.y + LOOP_ARROW_ARM_LENGTH * verticalSign,
      },
      to: tip,
    },
    {
      from: {
        x: tip.x + LOOP_ARROW_ARM_LENGTH,
        y: tip.y + LOOP_ARROW_ARM_LENGTH * verticalSign,
      },
      to: tip,
    },
  ];
}
