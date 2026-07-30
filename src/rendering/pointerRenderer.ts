const SVG_NS = "http://www.w3.org/2000/svg";

export function createCursorArrow(rejected = false): SVGGElement {
  const arrow = document.createElementNS(SVG_NS, "g");
  arrow.setAttribute("class", rejected ? "cursor-arrow cursor-arrow-rejected" : "cursor-arrow");

  const shape = document.createElementNS(SVG_NS, "path");
  shape.setAttribute(
    "d",
    "M -15 -3 L 4 -3 L 4 -9 L 17 0 L 4 9 L 4 3 L -15 3 Z",
  );
  shape.setAttribute("class", "cursor-arrow-shape");
  arrow.append(shape);
  return arrow;
}
