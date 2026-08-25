export type TriangleIconDirection = "previous" | "next";

export function createTriangleIcon(direction: TriangleIconDirection): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = `line-cycle-icon line-cycle-icon-${direction}`;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
