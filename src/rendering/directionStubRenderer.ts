import { LINE_BY_ID } from "../data/lines";
import type { LineId, Point } from "../data/types";
import type { MovementDirection } from "../game/movement";
import { STUB_STROKE_WIDTH } from "./lineStyles";

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

export type DirectionStubRenderOptions = {
  lineId: LineId;
  start: Point;
  unit: Point;
  normal?: Point;
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
    offset = 0,
    length = DEFAULT_DIRECTION_STUB_LENGTH,
    hitStartInset = 0,
    interaction,
  }: DirectionStubRenderOptions,
): SVGGElement {
  const offsetStart = {
    x: start.x + normal.x * offset,
    y: start.y + normal.y * offset,
  };
  const end = {
    x: start.x + unit.x * length + normal.x * offset,
    y: start.y + unit.y * length + normal.y * offset,
  };
  const hitStart = {
    x: offsetStart.x + unit.x * hitStartInset,
    y: offsetStart.y + unit.y * hitStartInset,
  };
  const shaftEnd = getStubShaftEnd(end, unit);

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

  const hitTarget = document.createElementNS(SVG_NS, "line");
  hitTarget.setAttribute("x1", String(hitStart.x));
  hitTarget.setAttribute("y1", String(hitStart.y));
  hitTarget.setAttribute("x2", String(end.x));
  hitTarget.setAttribute("y2", String(end.y));
  hitTarget.setAttribute("stroke", "transparent");
  hitTarget.setAttribute("stroke-width", String(STUB_HIT_WIDTH));
  hitTarget.setAttribute("stroke-linecap", "butt");
  hitTarget.setAttribute("class", "direction-stub-hit");
  control.append(hitTarget);

  const visual = document.createElementNS(SVG_NS, "g");
  visual.setAttribute("class", "direction-stub-visual");
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(offsetStart.x));
  line.setAttribute("y1", String(offsetStart.y));
  line.setAttribute("x2", String(shaftEnd.x));
  line.setAttribute("y2", String(shaftEnd.y));
  line.setAttribute("stroke", LINE_BY_ID[lineId].color);
  line.setAttribute("stroke-width", String(STUB_STROKE_WIDTH));
  line.setAttribute("class", "direction-stub");
  if (lineId === "walk") {
    line.setAttribute("stroke-dasharray", "8 6");
  }
  visual.append(line);

  const arrowHead = document.createElementNS(SVG_NS, "polygon");
  arrowHead.setAttribute(
    "points",
    getStubArrowHeadPoints(end, unit, normal)
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
