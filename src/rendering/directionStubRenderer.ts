import { LINE_BY_ID } from "../data/lines";
import type { LineId, Point } from "../data/types";
import { STUB_STROKE_WIDTH } from "./lineStyles";

const SVG_NS = "http://www.w3.org/2000/svg";
const STUB_LENGTH = 40;
const STUB_ARROW_LENGTH = 11;
const STUB_ARROW_HALF_WIDTH = STUB_STROKE_WIDTH / 2;
const STUB_ARROW_OVERLAP = 0.2;

export type DirectionStubRenderOptions = {
  lineId: LineId;
  start: Point;
  unit: Point;
  normal?: Point;
  offset?: number;
  showArrowHead: boolean;
};

export function renderDirectionStub(
  layer: SVGGElement,
  {
    lineId,
    start,
    unit,
    normal = { x: -unit.y, y: unit.x },
    offset = 0,
    showArrowHead,
  }: DirectionStubRenderOptions,
): void {
  const offsetStart = {
    x: start.x + normal.x * offset,
    y: start.y + normal.y * offset,
  };
  const arrowTip = {
    x: start.x + unit.x * STUB_LENGTH + normal.x * offset,
    y: start.y + unit.y * STUB_LENGTH + normal.y * offset,
  };
  const lineEnd = showArrowHead
    ? {
        x: arrowTip.x - unit.x * (STUB_ARROW_LENGTH - STUB_ARROW_OVERLAP),
        y: arrowTip.y - unit.y * (STUB_ARROW_LENGTH - STUB_ARROW_OVERLAP),
      }
    : arrowTip;
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(offsetStart.x));
  line.setAttribute("y1", String(offsetStart.y));
  line.setAttribute("x2", String(lineEnd.x));
  line.setAttribute("y2", String(lineEnd.y));
  line.setAttribute("stroke", LINE_BY_ID[lineId].color);
  line.setAttribute("stroke-width", String(STUB_STROKE_WIDTH));
  line.setAttribute("class", "direction-stub");
  if (lineId === "walk") {
    line.setAttribute("stroke-dasharray", "8 6");
  }
  layer.append(line);

  if (!showArrowHead) {
    return;
  }

  const arrow = document.createElementNS(SVG_NS, "polygon");
  arrow.setAttribute(
    "points",
    getStubArrowHeadPoints(arrowTip, unit, normal)
      .map((point) => `${point.x},${point.y}`)
      .join(" "),
  );
  arrow.setAttribute("fill", LINE_BY_ID[lineId].color);
  arrow.setAttribute("class", "direction-stub-arrow");
  layer.append(arrow);
}

export function getStubArrowHeadPoints(end: Point, unit: Point, normal: Point): Point[] {
  const base = {
    x: end.x - unit.x * STUB_ARROW_LENGTH,
    y: end.y - unit.y * STUB_ARROW_LENGTH,
  };
  return [
    end,
    {
      x: base.x + normal.x * STUB_ARROW_HALF_WIDTH,
      y: base.y + normal.y * STUB_ARROW_HALF_WIDTH,
    },
    {
      x: base.x - normal.x * STUB_ARROW_HALF_WIDTH,
      y: base.y - normal.y * STUB_ARROW_HALF_WIDTH,
    },
  ];
}
