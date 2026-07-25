import { describe, expect, it } from "vitest";
import { networkData } from "../data/network";
import type { Connection, LineId, Point } from "../data/types";
import {
  clampViewCenter,
  compareDirectionStubsBySelectedLine,
  compareDirectionStubsByRenderedOffset,
  type DirectionStubLike,
  getDirectionStubStart,
  getDirectionStubUnit,
  getMapPanPadding,
  getPointAlongPolyline,
  getSelectedStationMarkerPoint,
  getStationSpecificDirectionStubStart,
  getStubArrowHeadPoints,
  groupConnectionsByRenderedPath,
} from "./mapRenderer";
import { CorridorLayout } from "./corridorLayout";
import { getOneWayArrowLineSegments } from "./lineRenderer";
import { STUB_STROKE_WIDTH } from "./lineStyles";
import {
  getCanonicalPath,
  getCenteredOffset,
  offsetPolylinePoints,
  PARALLEL_LINE_SPACING,
  PARALLEL_STUB_SPACING,
} from "./pathOffset";

describe("direction stub arrows", () => {
  it("aligns an arrow head with the outgoing route direction", () => {
    expect(
      getStubArrowHeadPoints(
        { x: 40, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ),
    ).toEqual([
      { x: 40, y: 0 },
      { x: 29, y: STUB_STROKE_WIDTH / 2 },
      { x: 29, y: -STUB_STROKE_WIDTH / 2 },
    ]);
  });

  it("uses the same first grid step direction as movement validation", () => {
    const connection: Connection = {
      id: "central:a:b",
      from: "a",
      to: "b",
      line: "central",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: -1 }],
    };

    expect(getDirectionStubUnit(connection, "a")).toEqual({ x: 1, y: 0 });
    expect(getDirectionStubUnit(connection, "b")).toEqual({
      x: -Math.SQRT1_2,
      y: Math.SQRT1_2,
    });
  });

  it("anchors north-facing stubs to the top marker and south-facing stubs to the bottom marker", () => {
    const top = { x: 100, y: 100 };
    const bottom = { x: 100, y: 132 };

    for (const unit of [{ x: 0, y: -1 }, { x: -1, y: -1 }, { x: 1, y: -1 }]) {
      expect(getDirectionStubStart([bottom, top], bottom, unit)).toEqual(top);
    }
    for (const unit of [{ x: 0, y: 1 }, { x: -1, y: 1 }, { x: 1, y: 1 }]) {
      expect(getDirectionStubStart([top, bottom], top, unit)).toEqual(bottom);
    }
  });

  it("anchors east-facing stubs to the right marker and west-facing stubs to the left marker", () => {
    const left = { x: 100, y: 100 };
    const right = { x: 132, y: 100 };

    for (const unit of [{ x: 1, y: 0 }, { x: 1, y: -1 }, { x: 1, y: 1 }]) {
      expect(getDirectionStubStart([left, right], left, unit)).toEqual(right);
    }
    for (const unit of [{ x: -1, y: 0 }, { x: -1, y: -1 }, { x: -1, y: 1 }]) {
      expect(getDirectionStubStart([right, left], right, unit)).toEqual(left);
    }
  });

  it("keeps line-specific anchors for perpendicular and diagonal marker arrangements", () => {
    const linePoint = { x: 132, y: 132 };

    expect(getDirectionStubStart([{ x: 100, y: 100 }, { x: 100, y: 132 }], linePoint, { x: 1, y: 0 }))
      .toEqual(linePoint);
    expect(getDirectionStubStart([{ x: 100, y: 100 }, { x: 132, y: 132 }], linePoint, { x: 0, y: -1 }))
      .toEqual(linePoint);
  });

  it("anchors single-marker stubs to a displaced marker instead of the path point", () => {
    expect(getDirectionStubStart([{ x: 100, y: 100 }], { x: 132, y: 100 }, { x: 1, y: 0 }))
      .toEqual({ x: 100, y: 100 });
  });

  it("orders stubs to match render-only line offsets", () => {
    const positions = getSortedDirectionStubPositions(
      "rayners-lane",
      ["metropolitan", "piccadilly"],
      "eastcote",
    );
    const metropolitan = positions.find((position) => position.line === "metropolitan");
    const piccadilly = positions.find((position) => position.line === "piccadilly");

    expect(metropolitan?.point.y).toBeLessThan(piccadilly!.point.y);
  });

  it("orders stubs to match shared-path line offsets", () => {
    const positions = getSortedDirectionStubPositions(
      "baker-street",
      ["hammersmith-city", "circle", "metropolitan"],
      "great-portland-street",
    );
    const hammersmithCity = positions.find((position) => position.line === "hammersmith-city");
    const circle = positions.find((position) => position.line === "circle");
    const metropolitan = positions.find((position) => position.line === "metropolitan");

    expect(hammersmithCity?.point.y).toBeLessThan(circle!.point.y);
    expect(circle?.point.y).toBeLessThan(metropolitan!.point.y);
  });

  it("anchors Stratford Central stubs left and Elizabeth stubs right", () => {
    const layout = new CorridorLayout(networkData);
    const centralMarker = layout.getStationLinePoint("stratford", "central");
    const elizabethMarker = layout.getStationLinePoint("stratford", "elizabeth");

    expect(centralMarker.x).toBeLessThan(elizabethMarker.x);

    for (const line of ["central", "elizabeth"] as const) {
      const marker = layout.getStationLinePoint("stratford", line);
      expect(getStationSpecificDirectionStubStart("stratford", line, marker)).toEqual(marker);
    }
  });

  it("renders the selected line's stub after overlapping alternatives", () => {
    const stubs = (["central", "district", "piccadilly"] as const).map((line) => ({
      connection: {
        id: `${line}:a:b`,
        from: "a",
        to: "b",
        line,
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      },
      linePoint: { x: 16, y: 16 },
      normal: { x: 0, y: 1 },
    })) satisfies DirectionStubLike[];

    const ordered = [...stubs].sort((first, second) =>
      compareDirectionStubsBySelectedLine(first, second, "district")
    );

    expect(ordered.at(-1)?.connection.line).toBe("district");
  });
});

describe("one-way line arrows", () => {
  it("uses two line chevrons for the Piccadilly Heathrow loop", () => {
    expect(getOneWayArrowLineSegments({
      id: "piccadilly:hatton-cross:heathrow-terminal-4",
      from: "hatton-cross",
      to: "heathrow-terminal-4",
      line: "piccadilly",
      path: [],
      oneWay: true,
    })).toEqual([
      [
        { from: { x: -1978, y: 1222 }, to: { x: -1968, y: 1232 } },
        { from: { x: -1958, y: 1222 }, to: { x: -1968, y: 1232 } },
      ],
    ]);

    expect(getOneWayArrowLineSegments({
      id: "piccadilly:heathrow-terminal-2-and-3:heathrow-terminal-4",
      from: "heathrow-terminal-4",
      to: "heathrow-terminal-2-and-3",
      line: "piccadilly",
      path: [],
      oneWay: true,
    })).toEqual([
      [
        { from: { x: -2234, y: 1338 }, to: { x: -2224, y: 1328 } },
        { from: { x: -2214, y: 1338 }, to: { x: -2224, y: 1328 } },
      ],
    ]);
  });

  it("does not draw generic arrows on other one-way connections", () => {
    expect(getOneWayArrowLineSegments({
      id: "central:a:b",
      from: "a",
      to: "b",
      line: "central",
      path: [],
      oneWay: true,
    })).toEqual([]);
  });
});

describe("current station camera anchor", () => {
  it("uses the conjoined marker that contains the selected line", () => {
    const fallback = { x: 100, y: 100 };
    const centralPoint = { x: 80, y: 100 };
    const elizabethPoint = { x: 120, y: 100 };

    expect(getSelectedStationMarkerPoint(
      [
        { point: centralPoint, lines: ["central"] },
        { point: elizabethPoint, lines: ["elizabeth", "jubilee"] },
      ],
      "jubilee",
      fallback,
    )).toBe(elizabethPoint);
  });

  it("falls back to the base station point when the selected line has no marker group", () => {
    const fallback = { x: 100, y: 100 };

    expect(getSelectedStationMarkerPoint(
      [{ point: { x: 80, y: 100 }, lines: ["central"] }],
      "walk",
      fallback,
    )).toBe(fallback);
  });
});

describe("revealed line grouping", () => {
  it("groups duplicate rendered paths even when the source directions are reversed", () => {
    const bakerloo: Connection = {
      id: "bakerloo:charing-cross:embankment",
      from: "charing-cross",
      to: "embankment",
      line: "bakerloo",
      path: [],
    };
    const northern: Connection = {
      id: "northern:charing-cross:embankment",
      from: "embankment",
      to: "charing-cross",
      line: "northern",
      path: [],
    };

    const groups = groupConnectionsByRenderedPath([
      { connection: northern, points: [{ x: 62, y: 15 }, { x: 62, y: 8 }] },
      { connection: bakerloo, points: [{ x: 62, y: 8 }, { x: 62, y: 15 }] },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].map((item) => item.connection.line)).toEqual(["bakerloo", "northern"]);
  });

  it("places Hammersmith & City above Circle between Edgware Road and Baker Street", () => {
    const group = getSharedLineGroup(["circle", "hammersmith-city"], "edgware-road", "baker-street");
    const circle = getOffsetMidpoint(group, "circle");
    const hammersmithCity = getOffsetMidpoint(group, "hammersmith-city");

    expect(hammersmithCity.y).toBeLessThan(circle.y);
  });

  it("places Circle above District between South Kensington and Sloane Square", () => {
    const group = getSharedLineGroup(["circle", "district"], "south-kensington", "sloane-square");
    const circle = getOffsetMidpoint(group, "circle");
    const district = getOffsetMidpoint(group, "district");

    expect(circle.y).toBeLessThan(district.y);
  });

  it("keeps Hammersmith & City left/up between Hammersmith and Paddington", () => {
    const stationPairs = [
      ["hammersmith-circle-and-hammersmith-and-city", "goldhawk-road"],
      ["goldhawk-road", "shepherd-s-bush-market"],
      ["shepherd-s-bush-market", "wood-lane"],
      ["wood-lane", "latimer-road"],
      ["latimer-road", "ladbroke-grove"],
      ["ladbroke-grove", "westbourne-park"],
      ["westbourne-park", "royal-oak"],
      ["royal-oak", "paddington"],
    ] as const;

    for (const [from, to] of stationPairs) {
      const group = getSharedLineGroup(["circle", "hammersmith-city"], from, to);
      const circle = getOffsetMidpoint(group, "circle");
      const hammersmithCity = getOffsetMidpoint(group, "hammersmith-city");

      expectPointOnRouteSide(hammersmithCity, circle, group, "circle", from, "left", `${from} -> ${to}`);
    }
  });

  it("keeps District left and Circle right between High Street Kensington and Paddington", () => {
    const stationPairs = [
      ["high-street-kensington", "notting-hill-gate"],
      ["notting-hill-gate", "bayswater"],
      ["bayswater", "paddington"],
    ] as const;

    for (const [from, to] of stationPairs) {
      const group = getSharedLineGroup(["circle", "district"], from, to);
      const circle = getOffsetMidpoint(group, "circle");
      const district = getOffsetMidpoint(group, "district");

      expectPointOnRouteSide(district, circle, group, "circle", from, "left", `${from} -> ${to}`);
    }
  });

  it("orders Paddington to Edgware Road as H&C, Circle, District from top to bottom", () => {
    const group = getSharedLineGroup(["hammersmith-city", "circle", "district"], "paddington", "edgware-road");
    const hammersmithCity = getOffsetMidpoint(group, "hammersmith-city");
    const circle = getOffsetMidpoint(group, "circle");
    const district = getOffsetMidpoint(group, "district");

    expect(hammersmithCity.y).toBeLessThan(circle.y);
    expect(circle.y).toBeLessThan(district.y);
  });

  it("orders the Baker Street east trunk as H&C, Circle, Metropolitan from top to bottom", () => {
    const stationPairs = [
      ["great-portland-street", "euston-square"],
      ["euston-square", "king-s-cross-st-pancras"],
      ["king-s-cross-st-pancras", "farringdon"],
      ["farringdon", "barbican"],
      ["barbican", "moorgate"],
      ["moorgate", "liverpool-street"],
    ] as const;

    for (const [from, to] of stationPairs) {
      const group = getSharedLineGroup(["hammersmith-city", "circle", "metropolitan"], from, to);
      const hammersmithCity = getOffsetMidpoint(group, "hammersmith-city");
      const circle = getOffsetMidpoint(group, "circle");
      const metropolitan = getOffsetMidpoint(group, "metropolitan");

      expect(hammersmithCity.y, `${from} -> ${to}`).toBeLessThan(circle.y);
      expect(circle.y, `${from} -> ${to}`).toBeLessThan(metropolitan.y);
    }

    const aldgateGroup = getSharedLineGroup(["circle", "metropolitan"], "liverpool-street", "aldgate");
    expect(getOffsetMidpoint(aldgateGroup, "circle").y).toBeLessThan(getOffsetMidpoint(aldgateGroup, "metropolitan").y);
  });

  it("orders Aldgate East to Barking with H&C above District", () => {
    const stationPairs = [
      ["aldgate-east", "whitechapel"],
      ["whitechapel", "stepney-green"],
      ["stepney-green", "mile-end"],
      ["mile-end", "bow-road"],
      ["bow-road", "bromley-by-bow"],
      ["bromley-by-bow", "west-ham"],
      ["west-ham", "plaistow"],
      ["plaistow", "upton-park"],
      ["upton-park", "east-ham"],
      ["east-ham", "barking"],
    ] as const;

    for (const [from, to] of stationPairs) {
      const group = getSharedLineGroup(["hammersmith-city", "district"], from, to);
      const hammersmithCity = getOffsetMidpoint(group, "hammersmith-city");
      const district = getOffsetMidpoint(group, "district");

      expect(hammersmithCity.y, `${from} -> ${to}`).toBeLessThan(district.y);
    }
  });
});

type RenderedConnectionPathGroup = ReturnType<typeof groupConnectionsByRenderedPath>[number];

function getSharedLineGroup(
  lineIds: readonly LineId[],
  firstStationId: string,
  secondStationId: string,
): RenderedConnectionPathGroup {
  const layout = new CorridorLayout(networkData);
  const items = lineIds.map((line) => {
    const connection = networkData.connections.find(
      (candidate) =>
        candidate.line === line &&
        ((candidate.from === firstStationId && candidate.to === secondStationId) ||
          (candidate.from === secondStationId && candidate.to === firstStationId)),
    );
    if (!connection) throw new Error(`Missing ${line} connection ${firstStationId} -> ${secondStationId}`);
    return { connection, points: layout.getConnectionPoints(connection) };
  });
  const groups = groupConnectionsByRenderedPath(items);
  expect(groups).toHaveLength(1);
  return groups[0];
}

function getSortedDirectionStubPositions(
  stationId: string,
  lineIds: readonly LineId[],
  neighbourStationId: string,
): { line: LineId; point: Point }[] {
  const layout = new CorridorLayout(networkData);
  const stubs = lineIds.map((line) => {
    const connection = networkData.connections.find(
      (candidate) =>
        candidate.line === line &&
        ((candidate.from === stationId && candidate.to === neighbourStationId) ||
          (candidate.from === neighbourStationId && candidate.to === stationId)),
    );
    if (!connection) throw new Error(`Missing ${line} connection ${stationId} -> ${neighbourStationId}`);

    const unit = getDirectionStubUnit(connection, stationId);
    if (!unit) throw new Error(`Missing stub unit for ${line} ${stationId} -> ${neighbourStationId}`);
    return {
      connection,
      linePoint: layout.getStationLinePoint(stationId, line),
      normal: { x: -unit.y, y: unit.x },
    } satisfies DirectionStubLike;
  });

  return [...stubs]
    .sort((first, second) =>
      compareDirectionStubsByRenderedOffset(first, second, stubs, layout) ||
      first.connection.line.localeCompare(second.connection.line)
    )
    .map((stub, index, group) => {
      const offset = getCenteredOffset(index, group.length, PARALLEL_STUB_SPACING);
      return {
        line: stub.connection.line,
        point: {
          x: stub.linePoint.x + stub.normal.x * offset,
          y: stub.linePoint.y + stub.normal.y * offset,
        },
      };
    });
}

function getOffsetMidpoint(group: RenderedConnectionPathGroup, line: LineId): Point {
  const index = group.findIndex((item) => item.connection.line === line);
  if (index < 0) throw new Error(`Missing rendered ${line} line`);
  const offsetPoints = offsetPolylinePoints(
    getCanonicalPath(group[index].points),
    getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
  );
  return getPolylineMidpoint(offsetPoints);
}

function getPolylineMidpoint(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function getRouteDirection(
  group: RenderedConnectionPathGroup,
  line: LineId,
  routeFromStationId: string,
): Point {
  const item = group.find((candidate) => candidate.connection.line === line);
  if (!item) throw new Error(`Missing rendered ${line} line`);
  const points = item.connection.from === routeFromStationId ? item.points : [...item.points].reverse();
  for (let index = 0; index < points.length - 1; index += 1) {
    const direction = {
      x: points[index + 1].x - points[index].x,
      y: points[index + 1].y - points[index].y,
    };
    const length = Math.hypot(direction.x, direction.y);
    if (length > 0) {
      return { x: direction.x / length, y: direction.y / length };
    }
  }
  throw new Error(`Missing route direction for ${line}`);
}

function expectPointOnRouteSide(
  point: Point,
  reference: Point,
  group: RenderedConnectionPathGroup,
  line: LineId,
  routeFromStationId: string,
  side: "left" | "right",
  message: string,
) {
  const routeDirection = getRouteDirection(group, line, routeFromStationId);
  const sideNormal = side === "left"
    ? { x: routeDirection.y, y: -routeDirection.x }
    : { x: -routeDirection.y, y: routeDirection.x };
  const relativeToReference = {
    x: point.x - reference.x,
    y: point.y - reference.y,
  };

  expect(
    relativeToReference.x * sideNormal.x + relativeToReference.y * sideNormal.y,
    message,
  ).toBeGreaterThan(0);
}

describe("line reveal camera", () => {
  it("samples camera positions by distance along the revealed polyline", () => {
    expect(getPointAlongPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ], 0.75)).toEqual({ x: 10, y: 5 });
  });
});

describe("completed map panning", () => {
  it("clamps the camera so it cannot leave the padded map bounds", () => {
    const bounds = { minX: 0, maxX: 1_000, minY: 0, maxY: 800 };
    expect(clampViewCenter({ x: -500, y: 2_000 }, { width: 400, height: 300 }, bounds, 50))
      .toEqual({ x: 150, y: 700 });
  });

  it("centres a viewport that is larger than the map", () => {
    const bounds = { minX: 0, maxX: 100, minY: 20, maxY: 80 };
    expect(clampViewCenter({ x: 0, y: 0 }, { width: 500, height: 400 }, bounds, 20))
      .toEqual({ x: 50, y: 50 });
  });

  it("allows an edge station to be centred at the current viewport size", () => {
    const bounds = { minX: 0, maxX: 1_000, minY: 0, maxY: 800 };
    const viewBoxSize = { width: 400, height: 300 };
    const padding = getMapPanPadding(viewBoxSize);

    expect(padding).toEqual({ x: 200, y: 150 });
    expect(clampViewCenter({ x: 1_000, y: 400 }, viewBoxSize, bounds, padding))
      .toEqual({ x: 1_000, y: 400 });
    expect(clampViewCenter({ x: 500, y: 0 }, viewBoxSize, bounds, padding))
      .toEqual({ x: 500, y: 0 });
  });
});
