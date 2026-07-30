import type { LineId, NetworkData, Point, Station } from "../data/types";
import { renderDirectionStub } from "../rendering/directionStubRenderer";
import { gridPointToSvgPoint } from "../rendering/grid";
import { createCursorArrow } from "../rendering/pointerRenderer";
import { renderStationMarker } from "../rendering/stationRenderer";
import { createHudMetric, renderTimeValue } from "./hudMetric";

const SVG_NS = "http://www.w3.org/2000/svg";
const DIAGONAL_COMPONENT = Math.SQRT1_2;

export function createHowToPlayContent(): HTMLElement {
  const list = document.createElement("section");
  list.className = "how-to-play-list";
  list.ariaLabel = "How to play instructions";
  list.append(
    instruction(
      "Moving",
      createPointerIllustration(),
      "Point the arrow where you want to go using your mouse, then left-click to travel if the move is valid.",
    ),
    instruction(
      "Station markers",
      createStationMarkerIllustration(),
      "Interchange stations let you switch between tube lines. Use the coloured direction hint stubs to see which directions you can travel before moving.",
    ),
    instruction(
      "Changing lines",
      createLineSelectionIllustration(),
      "Press A and D to cycle between available tube lines at interchange stations.",
    ),
    instruction(
      "Objective",
      createTimerIllustration(),
      "Complete all 5 rounds as quickly as possible while minimising unnecessary moves and line changes.",
    ),
  );
  return list;
}

function instruction(title: string, illustration: Element, caption: string): HTMLElement {
  const item = document.createElement("article");
  item.className = "how-to-play-instruction";

  const visual = document.createElement("div");
  visual.className = "how-to-play-visual";
  visual.append(illustration);

  const copy = document.createElement("div");
  copy.className = "how-to-play-copy";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = caption;
  copy.append(heading, text);

  item.append(visual, copy);
  return item;
}

function createPointerIllustration(): SVGSVGElement {
  const svg = tutorialSvg("-40 -40 80 80", "tutorial-pointer");
  const arrow = createCursorArrow();
  arrow.classList.add("tutorial-pointer-arrow");
  svg.append(arrow);
  return svg;
}

function createStationMarkerIllustration(): SVGSVGElement {
  const svg = tutorialSvg("-52 -60 252 132", "tutorial-station-markers");
  const nonInterchange = tutorialStation(
    "tutorial-non-interchange",
    "Non-interchange",
    0,
    0,
    ["central"],
    -30,
  );
  const interchange = tutorialStation(
    "tutorial-interchange",
    "Interchange",
    4.5,
    0,
    ["central", "victoria"],
  );
  const network: NetworkData = {
    stations: [nonInterchange, interchange],
    connections: [
      {
        id: "central:tutorial-non-interchange:east",
        from: nonInterchange.id,
        to: "east",
        line: "central",
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      },
      {
        id: "central:tutorial-non-interchange:west",
        from: nonInterchange.id,
        to: "west",
        line: "central",
        path: [{ x: 0, y: 0 }, { x: -1, y: 0 }],
      },
    ],
    temporary: false,
    notes: [],
  };

  const stubLayer = svgLayer("direction-stubs");
  const nonInterchangePoint = gridPointToSvgPoint(nonInterchange);
  renderTutorialStubs(stubLayer, nonInterchangePoint, [
    { lineId: "central", unit: { x: -1, y: 0 } },
    { lineId: "central", unit: { x: 1, y: 0 } },
  ], true);
  const interchangePoint = gridPointToSvgPoint(interchange);
  renderTutorialStubs(stubLayer, interchangePoint, [
    { lineId: "central", unit: { x: -1, y: 0 } },
    { lineId: "central", unit: { x: 1, y: 0 } },
    { lineId: "victoria", unit: { x: 0, y: -1 } },
    { lineId: "victoria", unit: { x: 0, y: 1 } },
  ], false);
  svg.append(stubLayer);

  const stationLayer = svgLayer("stations");
  renderStationMarker(stationLayer, nonInterchange, network, "central", true);
  renderStationMarker(stationLayer, interchange, network, "central", true);
  svg.append(stationLayer);
  return svg;
}

function createLineSelectionIllustration(): SVGSVGElement {
  const svg = tutorialSvg("-48 -48 128 128", "tutorial-line-selection");
  const station = tutorialStation(
    "tutorial-line-selection",
    "",
    0,
    0,
    ["central", "victoria", "district"],
  );
  const point = gridPointToSvgPoint(station);
  const stubLayer = svgLayer("direction-stubs");
  renderTutorialStubs(stubLayer, point, [
    { lineId: "central", unit: { x: 0, y: -1 } },
    { lineId: "central", unit: { x: 0, y: 1 } },
    { lineId: "victoria", unit: { x: -1, y: 0 } },
    { lineId: "victoria", unit: { x: 1, y: 0 } },
    {
      lineId: "district",
      unit: { x: DIAGONAL_COMPONENT, y: -DIAGONAL_COMPONENT },
    },
    {
      lineId: "district",
      unit: { x: -DIAGONAL_COMPONENT, y: DIAGONAL_COMPONENT },
    },
  ], false);
  svg.append(stubLayer);

  const stationLayer = svgLayer("stations");
  renderStationMarker(
    stationLayer,
    station,
    { stations: [station], connections: [], temporary: false, notes: [] },
    "central",
    true,
  );
  svg.append(stationLayer);
  return svg;
}

function createTimerIllustration(): HTMLDivElement {
  const timer = document.createElement("div");
  timer.className = "hud-panel hud-timer tutorial-gameplay-timer";
  const value = document.createElement("span");
  timer.append(createHudMetric("Time", value));
  renderTimeValue(value, { minutes: "00", seconds: "13", fraction: "946" });
  return timer;
}

function tutorialStation(
  id: string,
  name: string,
  x: number,
  y: number,
  lines: LineId[],
  labelOffsetY = -54,
): Station {
  return {
    id,
    name,
    x,
    y,
    labelOffset: { x: 0, y: labelOffsetY },
    lines,
  };
}

function renderTutorialStubs(
  layer: SVGGElement,
  start: Point,
  stubs: { lineId: LineId; unit: Point }[],
  showArrowHead: boolean,
): void {
  for (const stub of stubs) {
    renderDirectionStub(layer, {
      lineId: stub.lineId,
      start,
      unit: stub.unit,
      showArrowHead,
    });
  }
}

function tutorialSvg(viewBox: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", `how-to-play-svg ${className}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return svg;
}

function svgLayer(className: string): SVGGElement {
  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("class", className);
  return layer;
}
