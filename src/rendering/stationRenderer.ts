import { LINE_BY_ID } from "../data/lines";
import type { LineId, NetworkData, Point, Station } from "../data/types";
import type { MovementDirection } from "../game/movement";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "./grid";
import type { StationMarkerGroup } from "./corridorLayout";

const SVG_NS = "http://www.w3.org/2000/svg";
export const INTERCHANGE_OUTLINE_WIDTH = 12;
const INTERCHANGE_OUTER_RADIUS = GRID_CELL_SIZE / 2;
const INTERCHANGE_RADIUS = INTERCHANGE_OUTER_RADIUS - INTERCHANGE_OUTLINE_WIDTH / 2;
export const STATION_BAR_MARKER_LENGTH = GRID_CELL_SIZE;
const BAR_HALF_LENGTH = STATION_BAR_MARKER_LENGTH / 2 - 3;
const BAR_WIDTH = 5;
const CURRENT_HIGHLIGHT_WIDTH = 4;
const CURRENT_HIGHLIGHT_RADIUS =
  INTERCHANGE_OUTER_RADIUS + CURRENT_HIGHLIGHT_WIDTH / 2;
const CONJOINED_NECK_WIDTH = INTERCHANGE_OUTLINE_WIDTH;
const CONJOINED_HIGHLIGHT_RADIUS = INTERCHANGE_OUTER_RADIUS + CURRENT_HIGHLIGHT_WIDTH;
export const STATION_WIPE_COMPONENT_RADIUS = CONJOINED_HIGHLIGHT_RADIUS;
const CONJOINED_HIGHLIGHT_NECK_WIDTH = CONJOINED_NECK_WIDTH + CURRENT_HIGHLIGHT_WIDTH * 2;
export const CONJOINED_CENTRE_LINE_WIDTH = 3.5;
const NORTHERN_BRANCH_INTERCHANGES = new Set(["Camden Town", "Kennington"]);
const MULTILINE_STATION_LABELS = new Map<string, string[]>([
  ["hammersmith-district-and-piccadilly", ["Hammersmith", "(District and Piccadilly)"]],
]);
const STATION_LABEL_LINE_HEIGHT_EM = 1.1;
const WIPE_BOUNDS = {
  x: -160,
  y: -140,
  width: 420,
  height: 280,
};

export type StationLabelPlacement = {
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
};

export type StationMarkerRenderOptions = {
  wipe?: {
    id: string;
    direction: MovementDirection;
    progress: number;
  };
  revealedLabel?: {
    placement: StationLabelPlacement;
  };
};

export function renderStationMarker(
  layer: SVGGElement,
  station: Station,
  network: NetworkData,
  selectedLineId: LineId,
  isCurrent: boolean,
  markerGroups: StationMarkerGroup[] = [{ point: gridPointToSvgPoint(station), lines: [...station.lines] }],
  currentLabelPlacement: StationLabelPlacement = getStationLabelPlacement(station),
  options: StationMarkerRenderOptions = {},
): SVGTextElement | null {
  const point = gridPointToSvgPoint(station);
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", isCurrent ? "station station-current" : "station station-revealed");
  group.setAttribute("transform", `translate(${point.x} ${point.y})`);
  const contentGroup = createWipeContentGroup(group, options.wipe);

  const isConjoined = markerGroups.length > 1;
  const isInterchange = isInterchangeStation(station);
  if (isConjoined) {
    if (isCurrent) {
      if (selectedLineId === "walk") {
        appendDashedConjoinedHighlight(contentGroup, point, markerGroups, LINE_BY_ID.walk.color);
      } else {
        appendConjoinedShape(
          contentGroup,
          point,
          markerGroups,
          LINE_BY_ID[selectedLineId].color,
          CONJOINED_HIGHLIGHT_RADIUS,
          CONJOINED_HIGHLIGHT_NECK_WIDTH,
          "current-station-highlight conjoined-station-highlight",
        );
      }
    }
    appendConjoinedShape(
      contentGroup,
      point,
      markerGroups,
      "#111111",
      INTERCHANGE_OUTER_RADIUS,
      CONJOINED_NECK_WIDTH,
      "interchange-marker conjoined-station-marker",
    );
    appendConjoinedCentreLines(contentGroup, point, markerGroups);
    for (const markerGroup of markerGroups) {
      const offset = subtract(markerGroup.point, point);
      contentGroup.append(createTranslatedMarker(createFilledCircle(INTERCHANGE_RADIUS, "#ffffff"), offset));
    }
  } else if (isInterchange) {
    const markerPoint = markerGroups[0]?.point ?? point;
    const markerOffset = subtract(markerPoint, point);
    if (isCurrent) {
      contentGroup.append(createTranslatedMarker(createCurrentHighlight(selectedLineId), markerOffset));
    }
    contentGroup.append(createTranslatedMarker(createInterchangeMarker(), markerOffset));
  } else {
    const markerLineId = station.lines.find((line) => line !== "walk") ?? selectedLineId;
    const markerPoint = markerGroups[0]?.point ?? point;
    contentGroup.append(createTranslatedMarker(
      createBarMarker(getStationLineDirection(network, station.id, markerLineId), LINE_BY_ID[markerLineId].color),
      subtract(markerPoint, point),
    ));
  }

  const labelPlacement = isCurrent ? currentLabelPlacement : options.revealedLabel?.placement;
  let renderedLabel: SVGTextElement | null = null;
  if (labelPlacement) {
    const labelClass = isCurrent ? "current-station-label" : "current-station-label revealed-station-label";
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(labelPlacement.x));
    label.setAttribute("y", String(labelPlacement.y));
    label.setAttribute("text-anchor", labelPlacement.textAnchor);
    label.setAttribute("class", labelClass);
    appendStationLabelText(label, station, labelPlacement);
    contentGroup.append(label);
    renderedLabel = label;
  }

  layer.append(group);
  return isCurrent ? renderedLabel : null;
}

export function getStationLabelPlacement(station: Station): StationLabelPlacement {
  return {
    x: station.labelOffset.x,
    y: station.labelOffset.y,
    textAnchor: getStationLabelLines(station).length > 1 ? "middle" : getStationLabelAnchor(station.labelOffset.x),
  };
}

export function appendStationLabelText(
  label: SVGTextElement,
  station: Station,
  placement: StationLabelPlacement = getStationLabelPlacement(station),
): void {
  const lines = getStationLabelLines(station);
  label.replaceChildren();
  if (lines.length === 1) {
    label.textContent = lines[0];
    return;
  }

  for (const [index, line] of lines.entries()) {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.textContent = line;
    tspan.setAttribute("x", String(placement.x));
    if (index === 0) {
      tspan.setAttribute("dy", "0");
    } else {
      tspan.setAttribute("dy", `${STATION_LABEL_LINE_HEIGHT_EM}em`);
    }
    label.append(tspan);
  }
}

export function getStationLabelLines(station: Station): string[] {
  return MULTILINE_STATION_LABELS.get(station.id) ?? [station.name];
}

function getStationLabelAnchor(offsetX: number): StationLabelPlacement["textAnchor"] {
  if (offsetX < -4) return "end";
  if (offsetX > 4) return "start";
  return "middle";
}

function createWipeContentGroup(
  group: SVGGElement,
  wipe: StationMarkerRenderOptions["wipe"],
): SVGGElement {
  if (!wipe) {
    return group;
  }

  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", wipe.id);
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
  const rect = document.createElementNS(SVG_NS, "rect");
  const wipeRect = getWipeRect(wipe.direction, wipe.progress);
  rect.setAttribute("x", String(wipeRect.x));
  rect.setAttribute("y", String(wipeRect.y));
  rect.setAttribute("width", String(wipeRect.width));
  rect.setAttribute("height", String(wipeRect.height));
  clipPath.append(rect);
  group.append(clipPath);

  const contentGroup = document.createElementNS(SVG_NS, "g");
  contentGroup.setAttribute("clip-path", `url(#${wipe.id})`);
  group.append(contentGroup);
  return contentGroup;
}

function getWipeRect(direction: MovementDirection, progress: number): typeof WIPE_BOUNDS {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const horizontalSign = direction.includes("east") ? 1 : direction.includes("west") ? -1 : 0;
  const verticalSign = direction.includes("south") ? 1 : direction.includes("north") ? -1 : 0;

  const width = horizontalSign === 0 ? WIPE_BOUNDS.width : WIPE_BOUNDS.width * clampedProgress;
  const height = verticalSign === 0 ? WIPE_BOUNDS.height : WIPE_BOUNDS.height * clampedProgress;

  return {
    x: horizontalSign < 0 ? WIPE_BOUNDS.x + WIPE_BOUNDS.width - width : WIPE_BOUNDS.x,
    y: verticalSign < 0 ? WIPE_BOUNDS.y + WIPE_BOUNDS.height - height : WIPE_BOUNDS.y,
    width,
    height,
  };
}

export function isInterchangeStation(station: Station): boolean {
  return new Set(station.lines).size > 1 || NORTHERN_BRANCH_INTERCHANGES.has(station.name);
}

function appendConjoinedCentreLines(
  group: SVGGElement,
  basePoint: Point,
  markerGroups: StationMarkerGroup[],
): void {
  for (let index = 1; index < markerGroups.length; index += 1) {
    const from = subtract(markerGroups[index - 1].point, basePoint);
    const to = subtract(markerGroups[index].point, basePoint);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", "#ffffff");
    line.setAttribute("stroke-width", String(CONJOINED_CENTRE_LINE_WIDTH));
    line.setAttribute("stroke-linecap", "butt");
    line.setAttribute("class", "conjoined-station-centre-line");
    group.append(line);
  }
}

export function getSelectedLineDashArray(lineId: LineId): string | null {
  return lineId === "walk" ? "8 6" : null;
}

export function getStationLineDirection(network: NetworkData, stationId: string, lineId: LineId): Point {
  const directions = network.connections
    .filter(
      (connection) =>
        connection.line === lineId && (connection.from === stationId || connection.to === stationId),
    )
    .map((connection) => {
      const path = connection.from === stationId ? connection.path : [...connection.path].reverse();
      return normalize({ x: path[1].x - path[0].x, y: path[1].y - path[0].y });
    })
    .filter((direction): direction is Point => direction !== null);

  if (directions.length === 0) return { x: 1, y: 0 };
  if (directions.length === 1) return canonicalizeAxis(directions[0]);

  let bestPair = [directions[0], directions[1]];
  let bestDotProduct = dot(bestPair[0], bestPair[1]);
  for (let first = 0; first < directions.length - 1; first += 1) {
    for (let second = first + 1; second < directions.length; second += 1) {
      const dotProduct = dot(directions[first], directions[second]);
      if (dotProduct < bestDotProduct) {
        bestPair = [directions[first], directions[second]];
        bestDotProduct = dotProduct;
      }
    }
  }

  return canonicalizeAxis(
    normalize({ x: bestPair[0].x - bestPair[1].x, y: bestPair[0].y - bestPair[1].y }) ?? bestPair[0],
  );
}

function createCurrentHighlight(lineId: LineId): SVGCircleElement {
  const highlight = document.createElementNS(SVG_NS, "circle");
  highlight.setAttribute("r", String(CURRENT_HIGHLIGHT_RADIUS));
  highlight.setAttribute("fill", "none");
  highlight.setAttribute("stroke", LINE_BY_ID[lineId].color);
  highlight.setAttribute("stroke-width", String(CURRENT_HIGHLIGHT_WIDTH));
  const dashArray = getSelectedLineDashArray(lineId);
  if (dashArray) {
    highlight.setAttribute("stroke-dasharray", dashArray);
    highlight.setAttribute("stroke-linecap", "butt");
  }
  highlight.setAttribute("class", "current-station-highlight");
  return highlight;
}

export function createInterchangeMarker(
  className = "interchange-marker",
  outlineWidth = INTERCHANGE_OUTLINE_WIDTH,
): SVGCircleElement {
  const marker = document.createElementNS(SVG_NS, "circle");
  marker.setAttribute("r", String(INTERCHANGE_OUTER_RADIUS - outlineWidth / 2));
  marker.setAttribute("fill", "#ffffff");
  marker.setAttribute("stroke", "#111111");
  marker.setAttribute("stroke-width", String(outlineWidth));
  marker.setAttribute("class", className);
  return marker;
}

function appendConjoinedShape(
  group: SVGGElement,
  basePoint: Point,
  markerGroups: StationMarkerGroup[],
  color: string,
  radius: number,
  neckWidth: number,
  className: string,
): void {
  for (let index = 1; index < markerGroups.length; index += 1) {
    const from = subtract(markerGroups[index - 1].point, basePoint);
    const to = subtract(markerGroups[index].point, basePoint);
    group.append(createConjoinedLink(from, to, color, neckWidth, className));
  }
  for (const markerGroup of markerGroups) {
    const offset = subtract(markerGroup.point, basePoint);
    group.append(createTranslatedMarker(createFilledCircle(radius, color, className), offset));
  }
}

function appendDashedConjoinedHighlight(
  group: SVGGElement,
  basePoint: Point,
  markerGroups: StationMarkerGroup[],
  color: string,
): void {
  for (let index = 1; index < markerGroups.length; index += 1) {
    const from = subtract(markerGroups[index - 1].point, basePoint);
    const to = subtract(markerGroups[index].point, basePoint);
    const link = createConjoinedLink(
      from,
      to,
      color,
      CONJOINED_HIGHLIGHT_NECK_WIDTH,
      "current-station-highlight conjoined-station-highlight",
    );
    applyWalkDash(link);
    group.append(link);
  }
  for (const markerGroup of markerGroups) {
    const offset = subtract(markerGroup.point, basePoint);
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(INTERCHANGE_OUTER_RADIUS + CURRENT_HIGHLIGHT_WIDTH / 2));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width", String(CURRENT_HIGHLIGHT_WIDTH));
    circle.setAttribute("class", "current-station-highlight conjoined-station-highlight");
    applyWalkDash(circle);
    group.append(createTranslatedMarker(circle, offset));
  }
}

function applyWalkDash(element: SVGElement): void {
  element.setAttribute("stroke-dasharray", getSelectedLineDashArray("walk")!);
  element.setAttribute("stroke-linecap", "butt");
}

function createConjoinedLink(
  from: Point,
  to: Point,
  stroke: string,
  width: number,
  className: string,
): SVGLineElement {
  const link = document.createElementNS(SVG_NS, "line");
  link.setAttribute("x1", String(from.x));
  link.setAttribute("y1", String(from.y));
  link.setAttribute("x2", String(to.x));
  link.setAttribute("y2", String(to.y));
  link.setAttribute("stroke", stroke);
  link.setAttribute("stroke-width", String(width));
  link.setAttribute("stroke-linecap", "round");
  link.setAttribute("class", `conjoined-station-link ${className}`);
  return link;
}

function createFilledCircle(radius: number, fill: string, className?: string): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", fill);
  if (className) circle.setAttribute("class", className);
  return circle;
}

function createTranslatedMarker<T extends SVGElement>(marker: T, offset: Point): T {
  if (Math.hypot(offset.x, offset.y) > 0.01) {
    marker.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
  }
  return marker;
}

function subtract(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

export function createBarMarker(lineDirection: Point, color: string): SVGLineElement {
  const perpendicular = { x: -lineDirection.y, y: lineDirection.x };
  const marker = document.createElementNS(SVG_NS, "line");
  marker.setAttribute("x1", String(-perpendicular.x * BAR_HALF_LENGTH));
  marker.setAttribute("y1", String(-perpendicular.y * BAR_HALF_LENGTH));
  marker.setAttribute("x2", String(perpendicular.x * BAR_HALF_LENGTH));
  marker.setAttribute("y2", String(perpendicular.y * BAR_HALF_LENGTH));
  marker.setAttribute("stroke", color);
  marker.setAttribute("stroke-width", String(BAR_WIDTH));
  marker.setAttribute("stroke-linecap", "butt");
  marker.setAttribute("class", "station-bar-marker");
  return marker;
}

function normalize(point: Point): Point | null {
  const length = Math.hypot(point.x, point.y);
  return length === 0 ? null : { x: point.x / length, y: point.y / length };
}

function canonicalizeAxis(direction: Point): Point {
  const canonical = direction.x < 0 || (direction.x === 0 && direction.y < 0)
    ? { x: -direction.x, y: -direction.y }
    : direction;
  return {
    x: Object.is(canonical.x, -0) ? 0 : canonical.x,
    y: Object.is(canonical.y, -0) ? 0 : canonical.y,
  };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}
