import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { networkData } from "../src/data/network.ts";
import { LINE_BY_ID } from "../src/data/lines.ts";
import { riverThamesPath } from "../src/data/mapDecorations.generated.ts";
import { CorridorLayout } from "../src/rendering/corridorLayout.ts";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "../src/rendering/grid.ts";
import { groupConnectionsByRenderedPath } from "../src/rendering/mapRenderer.ts";
import {
  getCanonicalPath,
  getCenteredOffset,
  offsetPolylinePoints,
  PARALLEL_LINE_SPACING,
} from "../src/rendering/pathOffset.ts";
import { createRoundedPathData } from "../src/rendering/roundedPath.ts";

const layout = new CorridorLayout(networkData);
const visibleConnectionPaths = networkData.connections.map((connection) => ({
  connection,
  points: layout.getConnectionPoints(connection),
}));
const renderedConnections = groupConnectionsByRenderedPath(visibleConnectionPaths).flatMap((group) =>
  group.map(({ connection, points }, index) => ({
    connection,
    points: offsetPolylinePoints(
      getCanonicalPath(points),
      getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
    ),
  })),
);
const stationMarkers = networkData.stations.flatMap((station) =>
  layout.getStationMarkerGroups(station.id).map((markerGroup) => ({ station, markerGroup })),
);
const riverPoints = riverThamesPath.map(gridPointToSvgPoint);

const SCALE = 5 / GRID_CELL_SIZE;
const LINE_CORNER_RADIUS = (20 / 32) * SCALE;
const PADDING = 30;
const points = [
  ...riverPoints,
  ...renderedConnections.flatMap(({ points }) => points),
  ...stationMarkers.map(({ markerGroup }) => markerGroup.point),
];
const minX = Math.min(...points.map((point) => point.x));
const maxX = Math.max(...points.map((point) => point.x));
const minY = Math.min(...points.map((point) => point.y));
const maxY = Math.max(...points.map((point) => point.y));
const width = (maxX - minX) * SCALE + PADDING * 2;
const height = (maxY - minY) * SCALE + PADDING * 2;
const project = (point) => `${(point.x - minX) * SCALE + PADDING},${(point.y - minY) * SCALE + PADDING}`;

const lines = renderedConnections.map(({ connection, points }) => {
  const dash = connection.line === "walk" ? ' stroke-dasharray="7 6"' : "";
  const path = points.map((point) => {
    const [x, y] = project(point).split(",").map(Number);
    return { x, y };
  });
  return `<path d="${createRoundedPathData(path, LINE_CORNER_RADIUS)}" fill="none" stroke="${LINE_BY_ID[connection.line].color}" stroke-width="4" stroke-linecap="butt" stroke-linejoin="round"${dash}/>`;
});
const riverProjectedPoints = riverPoints.map(project).join(" ");
const river = [
  `<polyline points="${riverProjectedPoints}" fill="none" stroke="hsl(195,44%,71%)" stroke-width="12" stroke-linecap="square" stroke-linejoin="round"/>`,
  `<polyline points="${riverProjectedPoints}" fill="none" stroke="hsl(195,44%,86%)" stroke-width="9" stroke-linecap="square" stroke-linejoin="round"/>`,
];
const stationLinks = networkData.stations.flatMap((station) => {
  const groups = layout.getStationMarkerGroups(station.id);
  if (groups.length < 2) return [];
  return groups.slice(1).map((group, index) => {
    const [x1, y1] = project(groups[index].point).split(",");
    const [x2, y2] = project(group.point).split(",");
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="5" stroke-linecap="round"/>`;
  });
});
const stations = stationMarkers.map(({ station, markerGroup }) => {
  const [cx, cy] = project(markerGroup.point).split(",");
  const title = `${station.name} (${markerGroup.lines.join(", ")})`;
  return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="white" stroke="#111" stroke-width="1.5"><title>${escapeXml(title)}</title></circle>`;
});
const labels = networkData.stations.map((station) => {
  const point = gridPointToSvgPoint(station);
  const x = (point.x - minX) * SCALE + PADDING + station.labelOffset.x * SCALE;
  const y = (point.y - minY) * SCALE + PADDING + station.labelOffset.y * SCALE;
  const anchor = station.labelOffset.x < -4 ? "end" : station.labelOffset.x > 4 ? "start" : "middle";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${18 * SCALE}" font-weight="700" fill="#111" stroke="#fff" stroke-width="${4 * SCALE}" paint-order="stroke">${escapeXml(station.name)}</text>`;
});

const output = join(tmpdir(), "tube-speedrun-network-preview.svg");
await writeFile(
  output,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#f7f5ef">${river.join("")}${lines.join("")}${stationLinks.join("")}${stations.join("")}${labels.join("")}</svg>`,
  "utf8",
);
console.log(output);

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
