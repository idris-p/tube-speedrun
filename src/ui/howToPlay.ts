import type { LineId, NetworkData, Point, Station } from "../data/types";
import { renderDirectionStub } from "../rendering/directionStubRenderer";
import { gridPointToSvgPoint } from "../rendering/grid";
import { createCursorArrow } from "../rendering/pointerRenderer";
import { renderStationMarker } from "../rendering/stationRenderer";
import { createHudMetric, renderTimeValue } from "./hudMetric";

const SVG_NS = "http://www.w3.org/2000/svg";
const DIAGONAL_COMPONENT = Math.SQRT1_2;

export function createHowToPlayContent(): HTMLElement {
  const carousel = document.createElement("section");
  carousel.className = "how-to-play-carousel";
  carousel.ariaLabel = "How to play instructions";
  carousel.setAttribute("aria-roledescription", "carousel");

  const list = document.createElement("div");
  list.className = "how-to-play-list";
  const cards = [
    instruction(
      "Station markers",
      createStationMarkerIllustration(),
      "Use the coloured direction hint stubs to see which directions you can travel before moving. Interchange stations let you switch between tube lines.",
    ),
    instruction(
      "Moving",
      createPointerIllustration(),
      "The arrow follows the direction of your mouse movement. Left-click to move in the direction it's pointing if the move is valid.",
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
  ];
  list.append(...cards);

  const viewport = document.createElement("div");
  viewport.className = "how-to-play-viewport";
  viewport.append(list);

  const previousButton = carouselButton("\u25c0", "Previous instruction");
  previousButton.classList.add("how-to-play-previous");
  const nextButton = carouselButton("\u25b6", "Next instruction");
  nextButton.classList.add("how-to-play-next");

  const dots = document.createElement("div");
  dots.className = "how-to-play-dots";
  dots.setAttribute("role", "group");
  dots.ariaLabel = "Choose an instruction";
  const dotButtons = cards.map((card, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "how-to-play-dot";
    dot.ariaLabel = `Show instruction ${index + 1}: ${card.querySelector("h2")?.textContent ?? ""}`;
    dots.append(dot);
    return dot;
  });

  let activeIndex = 0;
  const showCard = (index: number): void => {
    activeIndex = Math.max(0, Math.min(index, cards.length - 1));
    list.style.transform = `translateX(-${activeIndex * 100}%)`;
    cards.forEach((card, cardIndex) => {
      const active = cardIndex === activeIndex;
      card.setAttribute("aria-hidden", String(!active));
      card.toggleAttribute("inert", !active);
    });
    dotButtons.forEach((dot, dotIndex) => {
      const active = dotIndex === activeIndex;
      dot.classList.toggle("how-to-play-dot-active", active);
      if (active) {
        dot.setAttribute("aria-current", "step");
      } else {
        dot.removeAttribute("aria-current");
      }
    });
    previousButton.disabled = activeIndex === 0;
    nextButton.disabled = activeIndex === cards.length - 1;
  };

  previousButton.addEventListener("click", () => showCard(activeIndex - 1));
  nextButton.addEventListener("click", () => showCard(activeIndex + 1));
  dotButtons.forEach((dot, index) => dot.addEventListener("click", () => showCard(index)));
  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showCard(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showCard(activeIndex + 1);
    }
  });

  carousel.append(previousButton, viewport, nextButton, dots);
  showCard(0);
  return carousel;
}

function carouselButton(label: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "how-to-play-arrow";
  button.textContent = label;
  button.ariaLabel = ariaLabel;
  return button;
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
    -0.5,
    0,
    ["central"],
    -30,
  );
  const interchange = tutorialStation(
    "tutorial-interchange",
    "Interchange",
    5,
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
  const timeValue = document.createElement("span");
  const changeValue = document.createElement("span");
  const moveValue = document.createElement("span");
  changeValue.textContent = "1";
  moveValue.textContent = "12";
  timer.append(
    createHudMetric("Time", timeValue),
    createHudMetric("Changes", changeValue),
    createHudMetric("Moves", moveValue),
  );
  renderTimeValue(timeValue, { minutes: "00", seconds: "13", fraction: "94" });
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
