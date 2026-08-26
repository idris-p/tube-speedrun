import { describe, expect, it } from "vitest";
import type { GridPoint, NetworkData, Point } from "../data/types";
import { networkData } from "../data/network";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "./grid";
import { CorridorLayout, type SharedCorridor } from "./corridorLayout";
import { LINE_STROKE_WIDTH } from "./lineStyles";
import { offsetPolylinePoints } from "./pathOffset";

const testLabelOffset = { x: 28, y: -24 };

const corridorNetwork: NetworkData = {
  temporary: true,
  notes: [],
  stations: [
    { id: "a", name: "A", x: 0, y: 0, labelOffset: testLabelOffset, lines: ["district", "piccadilly"] },
    { id: "b", name: "B", x: 3, y: 0, labelOffset: testLabelOffset, lines: ["district"] },
    { id: "c", name: "C", x: 6, y: 0, labelOffset: testLabelOffset, lines: ["district", "piccadilly"] },
  ],
  connections: [
    {
      id: "district:a:b",
      from: "a",
      to: "b",
      line: "district",
      path: horizontalPath(0, 3),
    },
    {
      id: "district:b:c",
      from: "b",
      to: "c",
      line: "district",
      path: horizontalPath(3, 6),
    },
    {
      id: "piccadilly:a:c",
      from: "a",
      to: "c",
      line: "piccadilly",
      path: horizontalPath(0, 6),
    },
  ],
};

const syntheticCorridor: SharedCorridor = {
  lanes: [["piccadilly"], ["district"]],
  from: "a",
  to: "c",
};

describe("shared corridor layout", () => {
  it("places shared lines one full grid cell apart", () => {
    const layout = new CorridorLayout(corridorNetwork, [syntheticCorridor]);
    const district = corridorNetwork.connections[0];
    const piccadilly = corridorNetwork.connections[2];

    expect(new Set(layout.getConnectionSegmentOffsets(district))).toEqual(new Set([GRID_CELL_SIZE]));
    expect(new Set(layout.getConnectionSegmentOffsets(piccadilly))).toEqual(new Set([0]));
  });

  it("creates conjoined marker positions only where both lines stop", () => {
    const layout = new CorridorLayout(corridorNetwork, [syntheticCorridor]);
    const sharedGroups = layout.getStationMarkerGroups("a");
    const skippedGroups = layout.getStationMarkerGroups("b");

    expect(sharedGroups).toHaveLength(2);
    expect(Math.hypot(
      sharedGroups[0].point.x - sharedGroups[1].point.x,
      sharedGroups[0].point.y - sharedGroups[1].point.y,
    )).toBe(GRID_CELL_SIZE);
    expect(sharedGroups.every((group) => isCellCentre(group.point))).toBe(true);
    expect(skippedGroups).toHaveLength(1);
    expect(skippedGroups[0].lines).toEqual(["district"]);
    expect(skippedGroups[0].point).not.toEqual(gridPointToSvgPoint(corridorNetwork.stations[1]));
  });

  it("does not split lines that only cross briefly", () => {
    const network: NetworkData = {
      temporary: true,
      notes: [],
      stations: [
        { id: "a", name: "A", x: 0, y: 0, labelOffset: testLabelOffset, lines: ["district"] },
        { id: "b", name: "B", x: 2, y: 0, labelOffset: testLabelOffset, lines: ["district"] },
        { id: "c", name: "C", x: 1, y: 0, labelOffset: testLabelOffset, lines: ["piccadilly"] },
        { id: "d", name: "D", x: 3, y: 0, labelOffset: testLabelOffset, lines: ["piccadilly"] },
      ],
      connections: [
        { id: "district:a:b", from: "a", to: "b", line: "district", path: horizontalPath(0, 2) },
        { id: "piccadilly:c:d", from: "c", to: "d", line: "piccadilly", path: horizontalPath(1, 3) },
      ],
    };
    const layout = new CorridorLayout(network, [{
      lanes: [["district"], ["piccadilly"]],
      from: "a",
      to: "d",
    }]);

    expect(network.connections.map((connection) => layout.getConnectionSegmentOffsets(connection))).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("conjoins the District and Piccadilly markers at Barons Court", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("barons-court");
    const district = groups.find((group) => group.lines.includes("district"));
    const piccadilly = groups.find((group) => group.lines.includes("piccadilly"));

    expect(district).toBeDefined();
    expect(piccadilly).toBeDefined();
    expect(Math.hypot(
      district!.point.x - piccadilly!.point.x,
      district!.point.y - piccadilly!.point.y,
    )).toBeCloseTo(GRID_CELL_SIZE);
    expect(district!.point.y).toBe(piccadilly!.point.y + GRID_CELL_SIZE);
    expect(district!.point.x).toBe(piccadilly!.point.x);
    expect(groups.every((group) => isCellCentre(group.point))).toBe(true);
  });

  it("conjoins the Jubilee and Metropolitan markers at Wembley Park", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("wembley-park");
    const jubilee = groups.find((group) => group.lines.includes("jubilee"));
    const metropolitan = groups.find((group) => group.lines.includes("metropolitan"));

    expect(jubilee).toBeDefined();
    expect(metropolitan).toBeDefined();
    expect(Math.hypot(
      jubilee!.point.x - metropolitan!.point.x,
      jubilee!.point.y - metropolitan!.point.y,
    )).toBeCloseTo(GRID_CELL_SIZE * Math.SQRT2);
    expect(groups.every((group) => isCellCentre(group.point))).toBe(true);
    expect(gridPointFromSvgPoint(metropolitan!.point)).toEqual({ x: 14, y: -52 });
    expect(gridPointFromSvgPoint(jubilee!.point)).toEqual({ x: 15, y: -53 });
  });

  it("renders Metropolitan above Piccadilly from Rayners Lane to Uxbridge without moving paths or markers", () => {
    const layout = new CorridorLayout(networkData);
    const stationPairs = [
      ["rayners-lane", "eastcote"],
      ["eastcote", "ruislip-manor"],
      ["ruislip-manor", "ruislip"],
      ["ruislip", "ickenham"],
      ["ickenham", "hillingdon"],
      ["hillingdon", "uxbridge"],
    ] as const;

    for (const [from, to] of stationPairs) {
      const metropolitan = findConnection("metropolitan", from, to);
      const piccadilly = findConnection("piccadilly", from, to);
      const visibleConnectionIds = new Set([metropolitan.id, piccadilly.id]);

      expect(layout.getConnectionRenderPoints(metropolitan, new Set([metropolitan.id])))
        .toEqual(layout.getConnectionCameraPoints(metropolitan));
      expect(layout.getConnectionRenderPoints(piccadilly, new Set([piccadilly.id])))
        .toEqual(layout.getConnectionCameraPoints(piccadilly));
      expect(layout.getConnectionPoints(metropolitan)).toEqual(layout.getConnectionCameraPoints(metropolitan));
      expect(layout.getConnectionPoints(piccadilly)).toEqual(layout.getConnectionCameraPoints(piccadilly));

      const metropolitanPoints = layout.getConnectionRenderPoints(metropolitan, visibleConnectionIds);
      const piccadillyPoints = layout.getConnectionRenderPoints(piccadilly, visibleConnectionIds);
      const metropolitanCameraPoints = layout.getConnectionCameraPoints(metropolitan);
      const piccadillyCameraPoints = layout.getConnectionCameraPoints(piccadilly);
      const expectedMetropolitanPoints = offsetPolylinePoints(metropolitanCameraPoints, LINE_STROKE_WIDTH / 2);
      const expectedPiccadillyPoints = offsetPolylinePoints(piccadillyCameraPoints, -LINE_STROKE_WIDTH / 2);

      expect(metropolitanPoints, `${from} -> ${to}`).toEqual(expectedMetropolitanPoints);
      expect(piccadillyPoints, `${from} -> ${to}`).toEqual(expectedPiccadillyPoints);
      expect(midpoint(metropolitanPoints[0], metropolitanPoints.at(-1)!).y, `${from} -> ${to}`)
        .toBeLessThan(midpoint(piccadillyPoints[0], piccadillyPoints.at(-1)!).y);
    }

    for (const stationId of ["rayners-lane", "eastcote", "ruislip-manor", "ruislip", "ickenham", "hillingdon", "uxbridge"]) {
      const station = networkData.stations.find((candidate) => candidate.id === stationId);
      if (!station) throw new Error(`Missing station ${stationId}`);
      const basePoint = gridPointToSvgPoint(station);
      expect(layout.getStationLinePoint(stationId, "metropolitan")).toEqual(basePoint);
      expect(layout.getStationLinePoint(stationId, "piccadilly")).toEqual(basePoint);
    }
  });

  it("keeps Jubilee mirrored from Metropolitan at Finchley Road", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("finchley-road");
    const jubilee = groups.find((group) => group.lines.includes("jubilee"));
    const metropolitan = groups.find((group) => group.lines.includes("metropolitan"));

    expect(jubilee).toBeDefined();
    expect(metropolitan).toBeDefined();
    expect(gridPointFromSvgPoint(metropolitan!.point)).toEqual({ x: 32, y: -34 });
    expect(gridPointFromSvgPoint(jubilee!.point)).toEqual({ x: 33, y: -35 });
  });

  it("does not add a Piccadilly marker at skipped District stations", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("west-kensington");

    expect(groups.flatMap((group) => group.lines)).toEqual(["district"]);
  });

  it("keeps each line on the same side through successive corridor connections", () => {
    const layout = new CorridorLayout(networkData);
    const districtStations = [
      "barons-court",
      "hammersmith-district-and-piccadilly",
      "ravenscourt-park",
      "stamford-brook",
      "turnham-green",
      "chiswick-park",
      "acton-town",
    ];
    const piccadillyStations = [
      "barons-court",
      "hammersmith-district-and-piccadilly",
      "turnham-green",
      "acton-town",
    ];

    expect(new Set(districtStations.map((stationId) => layout.getStationLinePoint(stationId, "district").y)).size)
      .toBe(1);
    expect(new Set(piccadillyStations.map((stationId) => layout.getStationLinePoint(stationId, "piccadilly").y)).size)
      .toBe(1);
  });

  it("aligns the Richmond branch with the lower Turnham Green marker", () => {
    const layout = new CorridorLayout(networkData);
    const turnhamGreen = layout.getStationLinePoint("turnham-green", "district");
    const gunnersbury = layout.getStationLinePoint("gunnersbury", "district");
    const kewGardens = layout.getStationLinePoint("kew-gardens", "district");
    const richmond = layout.getStationLinePoint("richmond", "district");
    const gridPoints = [turnhamGreen, gunnersbury, kewGardens, richmond].map((point) => ({
      x: (point.x - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
      y: (point.y - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
    }));

    expect(gridPoints.every(({ x, y }) => x + y === -5)).toBe(true);
    expect(renderedDirectionRuns(layout, "district", "turnham-green", "gunnersbury"))
      .toEqual(["-1,1"]);
  });

  it("puts Jubilee and Bakerloo on the lower Baker Street marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("baker-street");
    const lower = groups.find((group) => group.lines.includes("bakerloo"));
    const upper = groups.find((group) => group.lines.includes("metropolitan"));

    expect(groups).toHaveLength(2);
    expect(lower?.lines).toEqual(["bakerloo", "jubilee"]);
    expect(upper?.lines).toEqual(["circle", "hammersmith-city", "metropolitan"]);
    expect(gridPointFromSvgPoint(lower!.point)).toEqual({ x: 42, y: -20 });
    expect(gridPointFromSvgPoint(upper!.point)).toEqual({ x: 44, y: -22 });
  });

  it("uses the requested line groupings at the additional conjoined stations", () => {
    const layout = new CorridorLayout(networkData);

    expect(markerLines(layout, "south-kensington")).toEqual([
      ["piccadilly"],
      ["circle", "district"],
    ]);
    expect(markerLines(layout, "gloucester-road")).toEqual([
      ["piccadilly"],
      ["circle", "district"],
    ]);
    expect(markerLines(layout, "earl-s-court")).toEqual([
      ["piccadilly"],
      ["district"],
    ]);
    expect(markerLines(layout, "ealing-common")).toEqual([
      ["district"],
      ["piccadilly"],
    ]);
  });

  it("moves both Euston markers down-left one cell", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("euston");
    const northern = groups.find((group) => group.lines.includes("northern"));
    const victoria = groups.find((group) => group.lines.includes("victoria"));

    expect(groups).toHaveLength(2);
    expect(northern?.lines).toEqual(["northern"]);
    expect(victoria?.lines).toEqual(["victoria"]);
    expect(gridPointFromSvgPoint(northern!.point)).toEqual({ x: 64, y: -26 });
    expect(gridPointFromSvgPoint(layout.getStationLinePoint("euston", "walk"))).toEqual({ x: 64, y: -26 });
    expect(gridPointFromSvgPoint(victoria!.point)).toEqual({ x: 66, y: -24 });
    expect(victoria!.point.x - northern!.point.x).toBe(GRID_CELL_SIZE * 2);
    expect(victoria!.point.y - northern!.point.y).toBe(GRID_CELL_SIZE * 2);
  });

  it("shortens Victoria from Warren Street to Euston by one cell", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "victoria", "warren-street", "euston"))
      .toEqual([{ x: 62, y: -20 }, { x: 66, y: -24 }]);
    expect(renderedDirectionRuns(layout, "victoria", "warren-street", "euston"))
      .toEqual(["1,-1"]);
  });

  it("routes Northern up two, up-right two, then up two from Warren Street to Euston", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "northern", "warren-street", "euston"))
      .toEqual([{ x: 62, y: -20 }, { x: 62, y: -22 }, { x: 64, y: -24 }, { x: 64, y: -26 }]);
    expect(renderedDirectionRuns(layout, "northern", "warren-street", "euston"))
      .toEqual(["0,-1", "1,-1", "0,-1"]);
  });

  it("joins Victoria to the Northern marker at King's Cross St Pancras", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("king-s-cross-st-pancras");
    const existing = groups.find((group) => !group.lines.includes("northern"));
    const northernAndVictoria = groups.find((group) => group.lines.includes("northern"));

    expect(groups).toHaveLength(2);
    expect(existing?.lines).toEqual(["circle", "hammersmith-city", "metropolitan", "piccadilly"]);
    expect(northernAndVictoria?.lines).toEqual(["northern", "victoria"]);
    expect(gridPointFromSvgPoint(existing!.point)).toEqual({ x: 74, y: -22 });
    expect(gridPointFromSvgPoint(northernAndVictoria!.point)).toEqual({ x: 76, y: -24 });
    expect(northernAndVictoria!.point.x - existing!.point.x).toBe(GRID_CELL_SIZE * 2);
    expect(northernAndVictoria!.point.y - existing!.point.y).toBe(-GRID_CELL_SIZE * 2);
  });

  it("renders Victoria straight horizontally from Euston to King's Cross", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "victoria", "euston", "king-s-cross-st-pancras"))
      .toEqual([{ x: 66, y: -24 }, { x: 76, y: -24 }]);
    expect(renderedDirectionRuns(layout, "victoria", "euston", "king-s-cross-st-pancras"))
      .toEqual(["1,0"]);
  });

  it("renders Northern from Angel to Euston through the King's Cross middle marker", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "northern", "angel", "king-s-cross-st-pancras"))
      .toEqual([{ x: 82, y: -22 }, { x: 78, y: -22 }, { x: 76, y: -24 }]);
    expect(renderedDirectionRuns(layout, "northern", "angel", "king-s-cross-st-pancras"))
      .toEqual(["-1,0", "-1,-1"]);
    expect(renderedGridPoints(layout, "northern", "king-s-cross-st-pancras", "euston"))
      .toEqual([{ x: 76, y: -24 }, { x: 74, y: -26 }, { x: 64, y: -26 }]);
    expect(renderedDirectionRuns(layout, "northern", "king-s-cross-st-pancras", "euston"))
      .toEqual(["-1,-1", "-1,0"]);
  });

  it("makes Finsbury Park a northwest-to-southeast Piccadilly and Victoria marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("finsbury-park");
    const piccadilly = groups.find((group) => group.lines.includes("piccadilly"));
    const victoria = groups.find((group) => group.lines.includes("victoria"));

    expect(groups).toHaveLength(2);
    expect(piccadilly?.lines).toEqual(["piccadilly"]);
    expect(victoria?.lines).toEqual(["victoria"]);
    expect(gridPointFromSvgPoint(piccadilly!.point)).toEqual({ x: 94, y: -46 });
    expect(gridPointFromSvgPoint(victoria!.point)).toEqual({ x: 95, y: -45 });
    expect(victoria!.point.x - piccadilly!.point.x).toBe(GRID_CELL_SIZE);
    expect(victoria!.point.y - piccadilly!.point.y).toBe(GRID_CELL_SIZE);
  });

  it("renders the Piccadilly corridor diagonally from Caledonian Road to Finsbury Park", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "piccadilly", "king-s-cross-st-pancras", "caledonian-road"))
      .toEqual([{ x: 74, y: -22 }, { x: 74, y: -26 }, { x: 79, y: -31 }]);
    expect(renderedDirectionRuns(layout, "piccadilly", "caledonian-road", "holloway-road"))
      .toEqual(["1,-1"]);
    expect(renderedDirectionRuns(layout, "piccadilly", "holloway-road", "arsenal"))
      .toEqual(["1,-1"]);
    expect(renderedDirectionRuns(layout, "piccadilly", "arsenal", "finsbury-park"))
      .toEqual(["1,-1"]);
  });

  it("renders Piccadilly and Victoria outward from the Finsbury Park split marker", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "victoria", "king-s-cross-st-pancras", "highbury-and-islington"))
      .toEqual([{ x: 76, y: -24 }, { x: 86, y: -24 }, { x: 92, y: -30 }, { x: 92, y: -36 }]);
    expect(renderedDirectionRuns(layout, "victoria", "king-s-cross-st-pancras", "highbury-and-islington"))
      .toEqual(["1,0", "1,-1", "0,-1"]);
    expect(renderedGridPoints(layout, "victoria", "highbury-and-islington", "finsbury-park"))
      .toEqual([{ x: 92, y: -36 }, { x: 92, y: -42 }, { x: 95, y: -45 }]);
    expect(renderedDirectionRuns(layout, "victoria", "highbury-and-islington", "finsbury-park"))
      .toEqual(["0,-1", "1,-1"]);
    expect(renderedGridPoints(layout, "piccadilly", "finsbury-park", "manor-house"))
      .toEqual([{ x: 94, y: -46 }, { x: 100, y: -52 }, { x: 100, y: -56 }]);
    expect(renderedDirectionRuns(layout, "piccadilly", "finsbury-park", "manor-house"))
      .toEqual(["1,-1", "0,-1"]);
    expect(renderedGridPoints(layout, "victoria", "finsbury-park", "seven-sisters"))
      .toEqual([{ x: 95, y: -45 }, { x: 101, y: -51 }, { x: 117, y: -51 }]);
    expect(renderedDirectionRuns(layout, "victoria", "finsbury-park", "seven-sisters"))
      .toEqual(["1,-1", "1,0"]);
    expect(renderedGridPoints(layout, "victoria", "seven-sisters", "tottenham-hale"))
      .toEqual([{ x: 117, y: -51 }, { x: 123, y: -51 }]);
    expect(renderedGridPoints(layout, "victoria", "tottenham-hale", "blackhorse-road"))
      .toEqual([{ x: 123, y: -51 }, { x: 129, y: -51 }]);
    expect(renderedGridPoints(layout, "victoria", "blackhorse-road", "walthamstow-central"))
      .toEqual([{ x: 129, y: -51 }, { x: 139, y: -51 }]);
  });

  it("places Elizabeth above the other lines at Liverpool Street and Whitechapel", () => {
    const layout = new CorridorLayout(networkData);

    for (const stationId of ["liverpool-street", "whitechapel"]) {
      const groups = layout.getStationMarkerGroups(stationId);
      const elizabeth = groups.find((group) => group.lines.includes("elizabeth"));
      const other = groups.find((group) => !group.lines.includes("elizabeth"));

      expect(groups).toHaveLength(2);
      expect(elizabeth?.lines).toEqual(["elizabeth"]);
      expect(other?.lines.length).toBeGreaterThan(0);
      expect(elizabeth?.point.x).toBe(other?.point.x);
      expect(elizabeth?.point.y).toBe(other!.point.y - GRID_CELL_SIZE);
    }
  });

  it("renders Elizabeth one cell above the subsurface lines east of Liverpool Street", () => {
    const layout = new CorridorLayout(networkData);
    const elizabeth = renderedGridPoints(layout, "elizabeth", "liverpool-street", "whitechapel");
    const hammersmithCity = renderedGridPoints(
      layout,
      "hammersmith-city",
      "liverpool-street",
      "aldgate-east",
    );

    expect(elizabeth).toEqual([{ x: 92, y: -13 }, { x: 119, y: -13 }]);
    expect(hammersmithCity.every((point) => point.y === -12)).toBe(true);
  });

  it("matches the Aldgate reference lane offsets from Liverpool Street", () => {
    const layout = new CorridorLayout(networkData);
    const hammersmithCity = findConnection("hammersmith-city", "liverpool-street", "aldgate-east");
    const circle = findConnection("circle", "liverpool-street", "aldgate");
    const metropolitan = findConnection("metropolitan", "liverpool-street", "aldgate");
    const centreY = gridPointToSvgPoint({ x: 92, y: -12 }).y;
    const aldgateX = gridPointToSvgPoint({ x: 108, y: -8 }).x;

    for (const connection of [hammersmithCity, circle, metropolitan]) {
      expect(layout.getConnectionRenderPoints(connection, new Set([connection.id])))
        .toEqual(layout.getConnectionCameraPoints(connection));
    }

    const referenceCases = [
      {
        visible: [hammersmithCity, circle],
        horizontalOffsets: new Map([
          [hammersmithCity.id, -LINE_STROKE_WIDTH / 2],
          [circle.id, LINE_STROKE_WIDTH / 2],
        ]),
        aldgateOffsets: new Map([
          [circle.id, 0],
        ]),
      },
      {
        visible: [hammersmithCity, metropolitan],
        horizontalOffsets: new Map([
          [hammersmithCity.id, -LINE_STROKE_WIDTH / 2],
          [metropolitan.id, LINE_STROKE_WIDTH / 2],
        ]),
        aldgateOffsets: new Map([
          [metropolitan.id, 0],
        ]),
      },
      {
        visible: [circle, metropolitan],
        horizontalOffsets: new Map([
          [circle.id, -LINE_STROKE_WIDTH / 2],
          [metropolitan.id, LINE_STROKE_WIDTH / 2],
        ]),
        aldgateOffsets: new Map([
          [circle.id, -LINE_STROKE_WIDTH / 2],
          [metropolitan.id, LINE_STROKE_WIDTH / 2],
        ]),
      },
      {
        visible: [hammersmithCity, circle, metropolitan],
        horizontalOffsets: new Map([
          [hammersmithCity.id, -LINE_STROKE_WIDTH],
          [circle.id, 0],
          [metropolitan.id, LINE_STROKE_WIDTH],
        ]),
        aldgateOffsets: new Map([
          [circle.id, -LINE_STROKE_WIDTH / 2],
          [metropolitan.id, LINE_STROKE_WIDTH / 2],
        ]),
      },
    ];

    for (const referenceCase of referenceCases) {
      const visibleIds = new Set(referenceCase.visible.map((connection) => connection.id));
      for (const connection of referenceCase.visible) {
        const horizontalOffset = referenceCase.horizontalOffsets.get(connection.id);
        if (horizontalOffset === undefined) throw new Error(`Missing horizontal offset for ${connection.id}`);

        const points = layout.getConnectionRenderPoints(connection, visibleIds);
        expect(leftmostPointY(points))
          .toBeCloseTo(centreY + horizontalOffset);

        if (connection.line === "circle" || connection.line === "metropolitan") {
          const aldgateOffset = referenceCase.aldgateOffsets.get(connection.id);
          if (aldgateOffset === undefined) throw new Error(`Missing Aldgate offset for ${connection.id}`);
          expect(points[0].x).toBeCloseTo(aldgateX - aldgateOffset);
        }
      }
    }
  });

  it("renders Elizabeth diagonally from Canary Wharf to Whitechapel", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedDirectionRuns(
      layout,
      "elizabeth",
      "canary-wharf-elizabeth-line",
      "whitechapel",
    )).toEqual(["-1,-1"]);
  });

  it("makes Mile End a three-cell northwest-to-southeast conjoined marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("mile-end");
    const central = groups.find((group) => group.lines.includes("central"));
    const subsurface = groups.find((group) => group.lines.includes("district"));

    expect(groups).toHaveLength(2);
    expect(central?.lines).toEqual(["central"]);
    expect(subsurface?.lines).toEqual(["district", "hammersmith-city"]);
    expect(gridPointFromSvgPoint(central!.point)).toEqual({ x: 130, y: -14 });
    expect(gridPointFromSvgPoint(subsurface!.point)).toEqual({ x: 132, y: -12 });
    expect(Math.hypot(
      central!.point.x - subsurface!.point.x,
      central!.point.y - subsurface!.point.y,
    )).toBeCloseTo(GRID_CELL_SIZE * Math.SQRT2 * 2);
  });

  it("renders Elizabeth northeast from Whitechapel and above Mile End", () => {
    const layout = new CorridorLayout(networkData);
    const points = renderedGridPoints(layout, "elizabeth", "whitechapel", "stratford");

    expect(renderedDirectionRuns(layout, "elizabeth", "whitechapel", "stratford"))
      .toEqual(["1,-1", "1,0", "1,-1"]);
    expect(points).toEqual([
      { x: 119, y: -13 },
      { x: 128, y: -22 },
      { x: 142, y: -22 },
      { x: 150, y: -30 },
    ]);
    expect(points.slice(1).some((point, index) => {
      const previous = points[index];
      return previous.y === -22 && point.y === -22 && previous.x <= 130 && point.x >= 130;
    })).toBe(true);
  });

  it("makes Stratford a horizontal Central and Elizabeth/Jubilee conjoined marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("stratford");
    const central = groups.find((group) => group.lines.includes("central"));
    const elizabethJubilee = groups.find((group) => group.lines.includes("elizabeth"));

    expect(groups).toHaveLength(2);
    expect(central?.lines).toEqual(["central"]);
    expect([...(elizabethJubilee?.lines ?? [])].sort()).toEqual(["elizabeth", "jubilee"]);
    expect(gridPointFromSvgPoint(central!.point)).toEqual({ x: 148, y: -30 });
    expect(gridPointFromSvgPoint(elizabethJubilee!.point)).toEqual({ x: 150, y: -30 });
  });

  it("renders Central collinear through the left Stratford marker into Leyton", () => {
    const layout = new CorridorLayout(networkData);
    const leyton = layout.getStationLinePoint("leyton", "central");

    expect(renderedGridPoints(layout, "central", "mile-end", "stratford")).toEqual([
      { x: 130, y: -14 },
      { x: 132, y: -14 },
      { x: 148, y: -30 },
    ]);
    expect(gridPointFromSvgPoint(leyton)).toEqual({ x: 153, y: -35 });
    expect(renderedDirectionRuns(layout, "central", "mile-end", "stratford"))
      .toEqual(["1,0", "1,-1"]);
    expect(renderedDirectionRuns(layout, "central", "stratford", "leyton"))
      .toEqual(["1,-1"]);
  });

  it("renders District and Hammersmith & City straight east from Stepney Green to Mile End", () => {
    const layout = new CorridorLayout(networkData);

    for (const line of ["district", "hammersmith-city"] as const) {
      expect(renderedGridPoints(layout, line, "stepney-green", "mile-end")).toEqual([
        { x: 128, y: -12 },
        { x: 132, y: -12 },
      ]);
      expect(renderedDirectionRuns(layout, line, "stepney-green", "mile-end"))
        .toEqual(["1,0"]);
    }
  });

  it("renders District and Hammersmith & City straight west from Bow Road to Mile End", () => {
    const layout = new CorridorLayout(networkData);

    for (const line of ["district", "hammersmith-city"] as const) {
      expect(renderedGridPoints(layout, line, "bow-road", "mile-end")).toEqual([
        { x: 136, y: -12 },
        { x: 132, y: -12 },
      ]);
      expect(renderedDirectionRuns(layout, line, "bow-road", "mile-end"))
        .toEqual(["-1,0"]);
    }
  });

  it("places Elizabeth northeast of the other lines at Bond Street and Tottenham Court Road", () => {
    const layout = new CorridorLayout(networkData);

    for (const stationId of ["bond-street", "tottenham-court-road"]) {
      const groups = layout.getStationMarkerGroups(stationId);
      const elizabeth = groups.find((group) => group.lines.includes("elizabeth"));
      const other = groups.find((group) => !group.lines.includes("elizabeth"));

      expect(groups).toHaveLength(2);
      expect(elizabeth?.lines).toEqual(["elizabeth"]);
      expect(elizabeth?.point.x).toBe(other!.point.x + GRID_CELL_SIZE);
      expect(elizabeth?.point.y).toBe(other!.point.y - GRID_CELL_SIZE);
    }
  });

  it("uses one shared lower marker at Waterloo", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("waterloo");

    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual(["bakerloo", "jubilee", "northern", "waterloo-city"]);
    expect(renderedDirectionRuns(layout, "jubilee", "westminster", "waterloo"))
      .toEqual(["1,1"]);
    expect(renderedDirectionRuns(layout, "northern", "embankment", "waterloo"))
      .toEqual(["0,1"]);
    expect(renderedDirectionRuns(layout, "waterloo-city", "bank", "waterloo"))
      .toEqual(["0,1", "-1,1", "-1,0"]);
  });

  it("makes Bank a northwest-to-southeast conjoined marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("bank");
    const northwest = groups.find((group) => group.lines.includes("central"));
    const southeast = groups.find((group) => group.lines.includes("northern"));

    expect(groups).toHaveLength(2);
    expect(northwest?.lines).toEqual(["central", "waterloo-city"]);
    expect(southeast?.lines).toEqual(["northern", "walk"]);
    expect(gridPointFromSvgPoint(northwest!.point)).toEqual({ x: 88, y: -8 });
    expect(gridPointFromSvgPoint(southeast!.point)).toEqual({ x: 90, y: -6 });

    expect(renderedGridPoints(layout, "northern", "bank", "moorgate"))
      .toEqual([{ x: 90, y: -6 }, { x: 90, y: -8 }, { x: 88, y: -10 }, { x: 88, y: -12 }]);
    expect(renderedDirectionRuns(layout, "northern", "bank", "moorgate"))
      .toEqual(["0,-1", "-1,-1", "0,-1"]);
    expect(renderedGridPoints(layout, "northern", "bank", "london-bridge"))
      .toEqual([{ x: 90, y: -6 }, { x: 90, y: 10 }]);
    expect(renderedDirectionRuns(layout, "northern", "bank", "london-bridge"))
      .toEqual(["0,1"]);
    expect(renderedGridPoints(layout, "walk", "bank", "monument")[0])
      .toEqual({ x: 90, y: -6 });
  });

  it("renders Elizabeth one cell above between Bond Street and Tottenham Court Road", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(
      layout,
      "elizabeth",
      "bond-street",
      "tottenham-court-road",
    )).toEqual([
      { x: 43, y: -9 },
      { x: 63, y: -9 },
    ]);
    expect(renderedDirectionRuns(
      layout,
      "elizabeth",
      "bond-street",
      "tottenham-court-road",
    )).toEqual(["1,0"]);
  });

  it("renders Elizabeth west then northwest then west from Bond Street to Paddington", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(
      layout,
      "elizabeth",
      "bond-street",
      "paddington",
    )).toEqual([
      { x: 43, y: -9 },
      { x: 36, y: -9 },
      { x: 27, y: -18 },
      { x: 18, y: -18 },
    ]);
    expect(renderedDirectionRuns(
      layout,
      "elizabeth",
      "bond-street",
      "paddington",
    )).toEqual(["-1,0", "-1,-1", "-1,0"]);
  });

  it("makes Paddington a northwest-to-southeast Bakerloo and subsurface marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("paddington");
    const bakerloo = groups.find((group) => group.lines.includes("bakerloo"));
    const other = groups.find((group) => !group.lines.includes("bakerloo"));

    expect(groups).toHaveLength(2);
    expect(bakerloo?.lines).toEqual(["bakerloo"]);
    expect(other?.lines).toEqual(["circle", "district", "hammersmith-city", "elizabeth"]);
    expect(gridPointFromSvgPoint(bakerloo!.point)).toEqual({ x: 16, y: -20 });
    expect(gridPointFromSvgPoint(other!.point)).toEqual({ x: 18, y: -18 });
    expect(other!.point.x - bakerloo!.point.x).toBe(GRID_CELL_SIZE * 2);
    expect(other!.point.y - bakerloo!.point.y).toBe(GRID_CELL_SIZE * 2);
  });

  it("renders Bakerloo into the upper Paddington marker and onward to Warwick Avenue", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "bakerloo", "baker-street", "regent-s-park"))
      .toEqual([{ x: 42, y: -20 }, { x: 46, y: -16 }]);
    expect(renderedGridPoints(layout, "bakerloo", "baker-street", "marylebone"))
      .toEqual([{ x: 42, y: -20 }, { x: 38, y: -24 }, { x: 32, y: -24 }]);
    expect(renderedGridPoints(layout, "bakerloo", "regent-s-park", "oxford-circus"))
      .toEqual([{ x: 46, y: -16 }, { x: 50, y: -12 }, { x: 50, y: -8 }]);
    expect(renderedGridPoints(layout, "bakerloo", "marylebone", "edgware-road-bakerloo"))
      .toEqual([{ x: 32, y: -24 }, { x: 24, y: -24 }]);
    expect(renderedGridPoints(layout, "bakerloo", "edgware-road-bakerloo", "paddington"))
      .toEqual([{ x: 24, y: -24 }, { x: 22, y: -24 }, { x: 18, y: -20 }, { x: 16, y: -20 }]);
    expect(renderedDirectionRuns(layout, "bakerloo", "edgware-road-bakerloo", "paddington"))
      .toEqual(["-1,0", "-1,1", "-1,0"]);
    expect(renderedGridPoints(layout, "bakerloo", "paddington", "warwick-avenue"))
      .toEqual([{ x: 16, y: -20 }, { x: 10, y: -20 }]);
    expect(renderedDirectionRuns(layout, "bakerloo", "paddington", "warwick-avenue"))
      .toEqual(["-1,0"]);
    expect(renderedGridPoints(layout, "bakerloo", "warwick-avenue", "maida-vale"))
      .toEqual([{ x: 10, y: -20 }, { x: 6, y: -20 }, { x: 4, y: -22 }]);
    expect(renderedGridPoints(layout, "bakerloo", "maida-vale", "kilburn-park"))
      .toEqual([{ x: 4, y: -22 }, { x: 0, y: -26 }]);
    expect(renderedGridPoints(layout, "bakerloo", "kilburn-park", "queen-s-park"))
      .toEqual([{ x: 0, y: -26 }, { x: -2, y: -28 }, { x: -2, y: -30 }]);
    expect(renderedGridPoints(layout, "bakerloo", "queen-s-park", "kensal-green"))
      .toEqual([{ x: -2, y: -30 }, { x: -2, y: -34 }]);
  });

  it("renders Metropolitan through the upper Baker Street marker", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "metropolitan", "great-portland-street", "baker-street"))
      .toEqual([{ x: 50, y: -22 }, { x: 44, y: -22 }]);
    expect(renderedGridPoints(layout, "metropolitan", "baker-street", "finchley-road"))
      .toEqual([{ x: 44, y: -22 }, { x: 32, y: -34 }]);
    expect(renderedDirectionRuns(layout, "metropolitan", "baker-street", "finchley-road"))
      .toEqual(["-1,-1"]);
  });

  it("renders Baker Street to Great Portland Street with ordered subsurface offsets", () => {
    const layout = new CorridorLayout(networkData);
    const circle = findConnection("circle", "great-portland-street", "baker-street");
    const hammersmithCity = findConnection("hammersmith-city", "great-portland-street", "baker-street");
    const metropolitan = findConnection("metropolitan", "great-portland-street", "baker-street");
    const visibleConnectionIds = new Set([circle.id, hammersmithCity.id, metropolitan.id]);
    const centreY = gridPointToSvgPoint({ x: 50, y: -22 }).y;

    const circlePoints = layout.getConnectionRenderPoints(circle, visibleConnectionIds);
    const hammersmithCityPoints = layout.getConnectionRenderPoints(hammersmithCity, visibleConnectionIds);
    const metropolitanPoints = layout.getConnectionRenderPoints(metropolitan, visibleConnectionIds);

    expect(hammersmithCityPoints.every((point) => point.y === centreY - LINE_STROKE_WIDTH)).toBe(true);
    expect(circlePoints.every((point) => point.y === centreY)).toBe(true);
    expect(metropolitanPoints.every((point) => point.y === centreY + LINE_STROKE_WIDTH)).toBe(true);
    for (const points of [circlePoints, hammersmithCityPoints, metropolitanPoints]) {
      expect(points).toHaveLength(2);
      expect(points[0].x).toBe(gridPointToSvgPoint({ x: 50, y: -22 }).x);
      expect(points[1].x).toBe(gridPointToSvgPoint({ x: 44, y: -22 }).x);
    }
  });

  it("keeps the reveal camera moving directly between Great Portland Street and Baker Street", () => {
    const layout = new CorridorLayout(networkData);
    const expectedCameraPoints = [
      gridPointToSvgPoint({ x: 50, y: -22 }),
      gridPointToSvgPoint({ x: 44, y: -22 }),
    ];

    for (const line of ["circle", "hammersmith-city"] as const) {
      const connection = findConnection(line, "great-portland-street", "baker-street");
      expect(layout.getConnectionCameraPoints(connection)).toEqual(expectedCameraPoints);
    }
  });

  it("removes immediate reversals from every reveal camera path", () => {
    const layout = new CorridorLayout(networkData);

    for (const connection of networkData.connections) {
      const points = layout.getConnectionCameraPoints(connection);
      for (let index = 1; index < points.length - 1; index += 1) {
        const incoming = {
          x: points[index].x - points[index - 1].x,
          y: points[index].y - points[index - 1].y,
        };
        const outgoing = {
          x: points[index + 1].x - points[index].x,
          y: points[index + 1].y - points[index].y,
        };
        expect(
          incoming.x * outgoing.x + incoming.y * outgoing.y,
          connection.id,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("uses H&C Circle Metropolitan order when two Baker Street subsurface lines are explored", () => {
    const layout = new CorridorLayout(networkData);
    const orderedPairs = [
      ["hammersmith-city", "circle"],
      ["hammersmith-city", "metropolitan"],
      ["circle", "metropolitan"],
    ] as const;
    const centreY = gridPointToSvgPoint({ x: 50, y: -22 }).y;

    for (const [upperLine, lowerLine] of orderedPairs) {
      const upper = findConnection(upperLine, "great-portland-street", "baker-street");
      const lower = findConnection(lowerLine, "great-portland-street", "baker-street");
      const visibleConnectionIds = new Set([upper.id, lower.id]);

      expect(layout.getConnectionRenderPoints(upper, visibleConnectionIds)
        .every((point) => point.y === centreY - LINE_STROKE_WIDTH / 2)).toBe(true);
      expect(layout.getConnectionRenderPoints(lower, visibleConnectionIds)
        .every((point) => point.y === centreY + LINE_STROKE_WIDTH / 2)).toBe(true);
    }
  });

  it("keeps every Tottenham Court Road exit visually clean after moving it east", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedDirectionRuns(layout, "central", "oxford-circus", "tottenham-court-road"))
      .toEqual(["1,0"]);
    expect(renderedDirectionRuns(layout, "central", "tottenham-court-road", "holborn"))
      .toEqual(["1,0"]);
    expect(renderedGridPoints(layout, "central", "holborn", "chancery-lane"))
      .toEqual([{ x: 72, y: -8 }, { x: 77, y: -8 }]);
    expect(renderedGridPoints(layout, "central", "chancery-lane", "st-paul-s"))
      .toEqual([{ x: 77, y: -8 }, { x: 83, y: -8 }]);
    expect(renderedGridPoints(layout, "central", "st-paul-s", "bank"))
      .toEqual([{ x: 83, y: -8 }, { x: 88, y: -8 }]);
    expect(renderedDirectionRuns(layout, "northern", "leicester-square", "tottenham-court-road"))
      .toEqual(["0,-1"]);
    expect(renderedDirectionRuns(layout, "northern", "tottenham-court-road", "goodge-street"))
      .toEqual(["0,-1"]);
    expect(renderedDirectionRuns(layout, "elizabeth", "bond-street", "tottenham-court-road"))
      .toEqual(["1,0"]);
    expect(renderedDirectionRuns(layout, "elizabeth", "farringdon", "tottenham-court-road"))
      .toEqual(["-1,0", "-1,1", "-1,0"]);
    expect(renderedGridPoints(layout, "elizabeth", "farringdon", "liverpool-street"))
      .toEqual([{ x: 80, y: -18 }, { x: 85, y: -18 }, { x: 90, y: -13 }, { x: 92, y: -13 }]);
    expect(renderedDirectionRuns(layout, "elizabeth", "farringdon", "liverpool-street"))
      .toEqual(["1,0", "1,1", "1,0"]);
  });

  it("places the Ealing Common markers left and right", () => {
    const layout = new CorridorLayout(networkData);
    const district = layout.getStationLinePoint("ealing-common", "district");
    const piccadilly = layout.getStationLinePoint("ealing-common", "piccadilly");

    expect(district.x).toBe(piccadilly.x - GRID_CELL_SIZE);
    expect(district.y).toBe(piccadilly.y);
  });

  it("preserves requested branch directions from displaced conjoined markers", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedGridPoints(layout, "jubilee", "wembley-park", "kingsbury"))
      .toEqual([{ x: 15, y: -53 }, { x: 13, y: -55 }, { x: 13, y: -59 }]);
    expect(renderedDirectionRuns(layout, "jubilee", "wembley-park", "kingsbury"))
      .toEqual(["-1,-1", "0,-1"]);
    expect(renderedGridPoints(layout, "jubilee", "kingsbury", "queensbury"))
      .toEqual([{ x: 13, y: -59 }, { x: 13, y: -63 }]);
    expect(renderedGridPoints(layout, "jubilee", "queensbury", "canons-park"))
      .toEqual([{ x: 13, y: -63 }, { x: 13, y: -67 }]);
    expect(renderedGridPoints(layout, "jubilee", "canons-park", "stanmore"))
      .toEqual([{ x: 13, y: -67 }, { x: 13, y: -71 }]);
    expect(renderedDirectionRuns(layout, "district", "ealing-common", "ealing-broadway"))
      .toEqual(["0,-1", "-1,-1"]);
    expect(renderedDirectionRuns(layout, "district", "earl-s-court", "west-brompton"))
      .toEqual(["-1,1", "0,1"]);
    expect(renderedDirectionRuns(layout, "district", "earl-s-court", "kensington-olympia"))
      .toEqual(["-1,-1", "0,-1"]);
    expect(renderedDirectionRuns(layout, "district", "earl-s-court", "high-street-kensington"))
      .toEqual(["1,-1", "0,-1"]);
  });

  it("keeps a single explored High Street Kensington branch centred", () => {
    const layout = new CorridorLayout(networkData);
    const circle = findConnection("circle", "high-street-kensington", "gloucester-road");
    const district = findConnection("district", "high-street-kensington", "earl-s-court");
    const highStreetKensington = gridPointToSvgPoint({ x: 18, y: 4 });
    const verticalEndY = gridPointToSvgPoint({ x: 18, y: 11 }).y;

    for (const connection of [circle, district]) {
      const points = layout.getConnectionRenderPoints(connection, new Set([connection.id]));
      expect(points[0]).toEqual(highStreetKensington);
      expect(points[1]).toEqual({ x: highStreetKensington.x, y: verticalEndY });
    }
  });

  it("separates the District and Circle vertical approaches once both are explored", () => {
    const layout = new CorridorLayout(networkData);
    const circleConnection = findConnection("circle", "high-street-kensington", "gloucester-road");
    const districtConnection = findConnection("district", "high-street-kensington", "earl-s-court");
    const visibleConnectionIds = new Set([circleConnection.id, districtConnection.id]);
    const circle = layout.getConnectionRenderPoints(circleConnection, visibleConnectionIds);
    const district = layout.getConnectionRenderPoints(districtConnection, visibleConnectionIds);
    const highStreetKensington = gridPointToSvgPoint({ x: 18, y: 4 });
    const verticalEndY = gridPointToSvgPoint({ x: 18, y: 11 }).y;

    expect(circle[0].x).toBeCloseTo(highStreetKensington.x + LINE_STROKE_WIDTH / 2);
    expect(circle[0].y).toBe(highStreetKensington.y);
    expect(circle[1].x).toBeCloseTo(circle[0].x);
    expect(circle[1].y).toBe(verticalEndY);

    expect(district[0].x).toBeCloseTo(highStreetKensington.x - LINE_STROKE_WIDTH / 2);
    expect(district[0].y).toBe(highStreetKensington.y);
    expect(district[1].x).toBeCloseTo(district[0].x);
    expect(district[1].y).toBe(verticalEndY);

    expect(circle[0].x - district[0].x).toBeCloseTo(LINE_STROKE_WIDTH);
  });

  it("keeps the High Street Kensington reveal camera on the centreline", () => {
    const layout = new CorridorLayout(networkData);
    const circle = findConnection("circle", "high-street-kensington", "gloucester-road");
    const district = findConnection("district", "high-street-kensington", "earl-s-court");
    const highStreetKensington = gridPointToSvgPoint({ x: 18, y: 4 });
    const verticalEndY = gridPointToSvgPoint({ x: 18, y: 11 }).y;

    for (const connection of [circle, district]) {
      const points = layout.getConnectionCameraPoints(connection);
      expect(points[0]).toEqual(highStreetKensington);
      expect(points[1]).toEqual({ x: highStreetKensington.x, y: verticalEndY });
    }
  });

  it("keeps a single explored Green Park branch centred", () => {
    const layout = new CorridorLayout(networkData);
    const greenPark = gridPointToSvgPoint({ x: 44, y: 0 });
    const connectionIds = [
      "jubilee:bond-street:green-park",
      "jubilee:green-park:westminster",
      "victoria:green-park:oxford-circus",
      "victoria:green-park:victoria",
    ];

    for (const connectionId of connectionIds) {
      const connection = findConnectionById(connectionId);
      const points = layout.getConnectionRenderPoints(connection, new Set([connection.id]));
      expect(points.some((point) => point.x === greenPark.x && point.y === greenPark.y), connectionId)
        .toBe(true);
    }
  });

  it("keeps Victoria and Jubilee on their fixed paths below Green Park once both are explored", () => {
    const layout = new CorridorLayout(networkData);
    const jubilee = findConnection("jubilee", "green-park", "westminster");
    const victoria = findConnection("victoria", "green-park", "victoria");
    const visibleConnectionIds = new Set([jubilee.id, victoria.id]);
    const jubileePoints = layout.getConnectionRenderPoints(jubilee, visibleConnectionIds);
    const victoriaPoints = layout.getConnectionRenderPoints(victoria, visibleConnectionIds);

    expect(jubileePoints).toEqual(layout.getConnectionCameraPoints(jubilee));
    expect(victoriaPoints).toEqual(layout.getConnectionCameraPoints(victoria));
    expect(renderedGridPoints(layout, "jubilee", "westminster", "green-park"))
      .toEqual([{ x: 56, y: 15 }, { x: 56, y: 12 }, { x: 44, y: 0 }]);
  });

  it("keeps Jubilee and Victoria on their fixed paths above Green Park once both are explored", () => {
    const layout = new CorridorLayout(networkData);
    const jubilee = findConnection("jubilee", "green-park", "bond-street");
    const victoria = findConnection("victoria", "green-park", "oxford-circus");
    const visibleConnectionIds = new Set([jubilee.id, victoria.id]);
    const jubileePoints = layout.getConnectionRenderPoints(jubilee, visibleConnectionIds);
    const victoriaPoints = layout.getConnectionRenderPoints(victoria, visibleConnectionIds);

    expect(jubileePoints).toEqual(layout.getConnectionCameraPoints(jubilee));
    expect(victoriaPoints).toEqual(layout.getConnectionCameraPoints(victoria));
    expect(renderedGridPoints(layout, "jubilee", "green-park", "bond-street"))
      .toEqual([{ x: 44, y: 0 }, { x: 42, y: -2 }, { x: 42, y: -8 }]);
  });

  it("makes Ealing Broadway a vertical Central/District and Elizabeth marker", () => {
    const layout = new CorridorLayout(networkData);
    const groups = layout.getStationMarkerGroups("ealing-broadway");
    const elizabeth = groups.find((group) => group.lines.includes("elizabeth"));
    const other = groups.find((group) => group.lines.includes("central"));

    expect(groups).toHaveLength(2);
    expect(elizabeth?.lines).toEqual(["elizabeth"]);
    expect(other?.lines).toEqual(["central", "district"]);
    expect(gridPointFromSvgPoint(elizabeth!.point)).toEqual({ x: -42, y: -1 });
    expect(gridPointFromSvgPoint(other!.point)).toEqual({ x: -42, y: 0 });
  });

  it("keeps Elizabeth and Central on their fixed paths east of Ealing Broadway once both are explored", () => {
    const layout = new CorridorLayout(networkData);
    const central = findConnection("central", "ealing-broadway", "west-acton");
    const elizabeth = findConnection("elizabeth", "ealing-broadway", "acton-main-line");
    const visibleConnectionIds = new Set([central.id, elizabeth.id]);
    const centralPoints = layout.getConnectionRenderPoints(central, visibleConnectionIds);
    const elizabethPoints = layout.getConnectionRenderPoints(elizabeth, visibleConnectionIds);

    expect(elizabethPoints).toEqual(layout.getConnectionCameraPoints(elizabeth));
    expect(centralPoints).toEqual(layout.getConnectionCameraPoints(central));
    expect(renderedGridPoints(layout, "elizabeth", "ealing-broadway", "acton-main-line"))
      .toEqual([{ x: -42, y: -1 }, { x: -33, y: -1 }, { x: -20, y: -14 }]);
    expect(renderedDirectionRuns(layout, "elizabeth", "ealing-broadway", "acton-main-line"))
      .toEqual(["1,0", "1,-1"]);
    expect(renderedGridPoints(layout, "elizabeth", "ealing-broadway", "west-ealing"))
      .toEqual([{ x: -42, y: -1 }, { x: -46, y: -1 }]);
  });

  it("keeps the Acton branches on the requested geometry", () => {
    const layout = new CorridorLayout(networkData);

    expect(renderedDirectionRuns(layout, "piccadilly", "acton-town", "ealing-common"))
      .toEqual(["-1,-1", "0,-1"]);
    expect(renderedDirectionRuns(layout, "district", "acton-town", "ealing-common"))
      .toEqual(["-1,-1", "0,-1"]);
    expect(renderedDirectionRuns(layout, "piccadilly", "acton-town", "south-ealing"))
      .toEqual(["-1,0", "-1,1"]);
  });

  it("renders the moved Sloane Square corridor straight from South Kensington", () => {
    const layout = new CorridorLayout(networkData);
    for (const line of ["circle", "district"] as const) {
      const connection = networkData.connections.find(
        (candidate) =>
          candidate.line === line &&
          candidate.from === "south-kensington" &&
          candidate.to === "sloane-square",
      );
      if (!connection) throw new Error(`Missing ${line} South Kensington connection`);
      const points = layout.getConnectionPoints(connection);
      const gridPoints = points.map((point) => ({
        x: (point.x - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
        y: (point.y - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
      }));

      expect(gridPoints).toEqual([
        { x: 28, y: 15 },
        { x: 38, y: 15 },
      ]);
    }
  });

  it("places every station marker on a grid-cell centre", () => {
    const layout = new CorridorLayout(networkData);

    for (const station of networkData.stations) {
      expect(
        layout.getStationMarkerGroups(station.id).every((group) => isCellCentre(group.point)),
        station.name,
      ).toBe(true);
    }
  });

  it("moves Temple one cell left while keeping the Circle and District route shape aligned", () => {
    const layout = new CorridorLayout(networkData);

    expect(layout.getStationMarkerGroups("temple").map((group) => gridPointFromSvgPoint(group.point)))
      .toEqual([{ x: 71, y: 15 }]);
    expect(gridPointFromSvgPoint(layout.getStationLinePoint("temple", "circle")))
      .toEqual({ x: 71, y: 15 });
    expect(gridPointFromSvgPoint(layout.getStationLinePoint("temple", "district")))
      .toEqual({ x: 71, y: 15 });

    for (const line of ["circle", "district"] as const) {
      expect(renderedGridPoints(layout, line, "embankment", "temple"))
        .toEqual([{ x: 62, y: 15 }, { x: 71, y: 15 }]);
      expect(renderedGridPoints(layout, line, "temple", "blackfriars"))
        .toEqual([{ x: 71, y: 15 }, { x: 73, y: 15 }, { x: 78, y: 10 }]);
    }
  });

  it("identifies both the anchored and displaced lines as corridor connections", () => {
    const layout = new CorridorLayout(networkData);
    const connections = networkData.connections.filter((connection) =>
      ["district", "piccadilly"].includes(connection.line) &&
      [connection.from, connection.to].includes("barons-court") &&
      [connection.from, connection.to].includes("hammersmith-district-and-piccadilly"),
    );

    expect(connections).toHaveLength(2);
    expect(connections.every((connection) => layout.isCorridorConnection(connection))).toBe(true);
  });

  it("keeps every separated shared track one cell from its neighbours", () => {
    const layout = new CorridorLayout(networkData);
    const offsetsByEdge = new Map<string, Map<string, number>>();
    for (const connection of networkData.connections.filter((candidate) => candidate.line !== "walk")) {
      const offsets = layout.getConnectionSegmentOffsets(connection);
      for (let index = 0; index < connection.path.length - 1; index += 1) {
        const from = connection.path[index];
        const to = connection.path[index + 1];
        if (!layout.getCorridorLines(from, to).includes(connection.line)) {
          continue;
        }
        const points = [from, to]
          .map((point) => `${point.x},${point.y}`)
          .sort();
        const key = points.join(";");
        const lineOffsets = offsetsByEdge.get(key) ?? new Map<string, number>();
        const canonicalOffset = from.x < to.x || (from.x === to.x && from.y <= to.y)
          ? offsets[index]
          : -offsets[index];
        lineOffsets.set(connection.line, canonicalOffset);
        offsetsByEdge.set(key, lineOffsets);
      }
    }

    for (const [edge, offsetsByLine] of offsetsByEdge) {
      const offsets = [...new Set(offsetsByLine.values())].sort((a, b) => a - b);
      if (offsets.length < 2 || offsets.every((offset) => offset === 0)) continue;
      for (let index = 1; index < offsets.length; index += 1) {
        const [firstPoint, secondPoint] = edge.split(";").map((point) => point.split(",").map(Number));
        const isDiagonal = firstPoint[0] !== secondPoint[0] && firstPoint[1] !== secondPoint[1];
        expect(
          offsets[index] - offsets[index - 1],
          `${edge}: ${JSON.stringify(Object.fromEntries(offsetsByLine))}`,
        ).toBe(isDiagonal ? GRID_CELL_SIZE * Math.SQRT2 : GRID_CELL_SIZE);
      }
    }
  });

  it("renders Circle inside and District outside from Tower Hill toward Aldgate", () => {
    const layout = new CorridorLayout(networkData);
    const circle = findConnection("circle", "tower-hill", "aldgate");
    const district = findConnection("district", "tower-hill", "aldgate-east");

    expect(layout.getConnectionRenderPoints(circle, new Set([circle.id])))
      .toEqual(layout.getConnectionCameraPoints(circle));
    expect(layout.getConnectionRenderPoints(district, new Set([district.id])))
      .toEqual(layout.getConnectionCameraPoints(district));

    const visibleConnectionIds = new Set([circle.id, district.id]);
    const circlePoints = layout.getConnectionRenderPoints(circle, visibleConnectionIds);
    const districtPoints = layout.getConnectionRenderPoints(district, visibleConnectionIds);
    const circleCameraPoints = layout.getConnectionCameraPoints(circle);
    const districtCameraPoints = layout.getConnectionCameraPoints(district);

    expect(midpoint(circlePoints[0], circlePoints[1]).y)
      .toBeLessThan(midpoint(circleCameraPoints[0], circleCameraPoints[1]).y);
    expect(midpoint(districtPoints[0], districtPoints[1]).y)
      .toBeGreaterThan(midpoint(districtCameraPoints[0], districtCameraPoints[1]).y);
    expect(midpoint(circlePoints[2], circlePoints[3]).x)
      .toBeLessThan(midpoint(circleCameraPoints[2], circleCameraPoints[3]).x);
    expect(midpoint(districtPoints[2], districtPoints[3]).x)
      .toBeGreaterThan(midpoint(districtCameraPoints[2], districtCameraPoints[3]).x);
    expect(Math.sign(districtPoints.at(-1)!.x - districtPoints.at(-2)!.x)).toBe(1);
    expect(Math.sign(districtPoints.at(-1)!.y - districtPoints.at(-2)!.y)).toBe(-1);
  });

  it("applies Heathrow loop overlap rules based on visible services", () => {
    const layout = new CorridorLayout(networkData);
    const elizabethT5 = findConnection("elizabeth", "heathrow-terminal-2-and-3", "heathrow-terminal-5");
    const piccadillyT5 = findConnection("piccadilly", "heathrow-terminal-2-and-3", "heathrow-terminal-5");
    const piccadillyT4 = findConnection("piccadilly", "heathrow-terminal-4", "heathrow-terminal-2-and-3");

    expect(layout.getConnectionRenderPoints(elizabethT5, new Set([elizabethT5.id])))
      .toEqual(layout.getConnectionCameraPoints(elizabethT5));
    expect(layout.getConnectionRenderPoints(piccadillyT5, new Set([piccadillyT5.id])))
      .toEqual(layout.getConnectionCameraPoints(piccadillyT5));
    expect(layout.getConnectionRenderPoints(piccadillyT4, new Set([piccadillyT4.id])))
      .toEqual(layout.getConnectionCameraPoints(piccadillyT4));

    const t5Pair = new Set([elizabethT5.id, piccadillyT5.id]);
    expect(segmentDelta(layout, elizabethT5, t5Pair, 0)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(segmentDelta(layout, elizabethT5, t5Pair, 0).x).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, t5Pair, 0).y).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, t5Pair, 1).x).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, t5Pair, 1).y).toBeLessThan(0);
    expect(segmentDelta(layout, piccadillyT5, t5Pair, 0).x).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT5, t5Pair, 0).y).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT5, t5Pair, 1).x).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT5, t5Pair, 1).y).toBeGreaterThan(0);
    expect(segmentMidpointDistance(layout, elizabethT5, piccadillyT5, t5Pair, 0))
      .toBeLessThan(LINE_STROKE_WIDTH);
    expect(segmentMidpointDistance(layout, elizabethT5, piccadillyT5, t5Pair, 0))
      .toBeGreaterThan(LINE_STROKE_WIDTH - 2.5);

    const elizabethAndT4 = new Set([elizabethT5.id, piccadillyT4.id]);
    expect(segmentDelta(layout, elizabethT5, elizabethAndT4, 0).x).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, elizabethAndT4, 0).y).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, elizabethAndT4, 1).x).toBeCloseTo(0);
    expectSegmentIsVertical(layout.getConnectionRenderPoints(elizabethT5, elizabethAndT4), 1);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 0).x).toBeCloseTo(0);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 0).y).toBeCloseTo(0);
    expect(layout.getConnectionRenderPoints(piccadillyT4, elizabethAndT4))
      .not.toContainEqual(layout.getConnectionCameraPoints(piccadillyT4)[2]);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 1).x).toBeCloseTo(0);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 1).y).toBeGreaterThan(0);
    expectSegmentIsVertical(layout.getConnectionRenderPoints(piccadillyT4, elizabethAndT4), 1);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 2, 2).x).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT4, elizabethAndT4, 2, 2).y).toBeGreaterThan(0);

    const piccadillyLoop = new Set([piccadillyT5.id, piccadillyT4.id]);
    expect(layout.getConnectionRenderPoints(piccadillyT5, piccadillyLoop))
      .toEqual(layout.getConnectionCameraPoints(piccadillyT5));
    expect(layout.getConnectionRenderPoints(piccadillyT4, piccadillyLoop))
      .toEqual(layout.getConnectionCameraPoints(piccadillyT4));

    const allLoop = new Set([elizabethT5.id, piccadillyT5.id, piccadillyT4.id]);
    expect(segmentDelta(layout, elizabethT5, allLoop, 0).x).toBeLessThan(0);
    expect(segmentDelta(layout, elizabethT5, allLoop, 0).y).toBeLessThan(0);
    expect(segmentDelta(layout, piccadillyT5, allLoop, 0).x).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT5, allLoop, 0).y).toBeGreaterThan(0);
    expect(segmentMidpointDistance(layout, elizabethT5, piccadillyT5, allLoop, 0))
      .toBeLessThan(LINE_STROKE_WIDTH);
    expect(segmentDelta(layout, piccadillyT4, allLoop, 0).x).toBeCloseTo(0);
    expect(segmentDelta(layout, piccadillyT4, allLoop, 0).y).toBeCloseTo(0);
    expect(layout.getConnectionRenderPoints(piccadillyT4, allLoop))
      .not.toContainEqual(layout.getConnectionCameraPoints(piccadillyT4)[2]);
    expectSegmentIsVertical(layout.getConnectionRenderPoints(piccadillyT4, allLoop), 1);
    expect(segmentDelta(layout, piccadillyT4, allLoop, 2, 2).x).toBeGreaterThan(0);
    expect(segmentDelta(layout, piccadillyT4, allLoop, 2, 2).y).toBeGreaterThan(0);
  });
});

function horizontalPath(fromX: number, toX: number): GridPoint[] {
  return Array.from({ length: toX - fromX + 1 }, (_, index) => ({ x: fromX + index, y: 0 }));
}

function isCellCentre(point: { x: number; y: number }): boolean {
  return (
    (point.x - GRID_CELL_SIZE / 2) % GRID_CELL_SIZE === 0 &&
    (point.y - GRID_CELL_SIZE / 2) % GRID_CELL_SIZE === 0
  );
}

function markerLines(layout: CorridorLayout, stationId: string): string[][] {
  return layout.getStationMarkerGroups(stationId)
    .sort((first, second) => first.point.y - second.point.y || first.point.x - second.point.x)
    .map((group) => [...group.lines].sort());
}

function renderedDirectionRuns(
  layout: CorridorLayout,
  line: string,
  from: string,
  to: string,
): string[] {
  const connection = networkData.connections.find(
    (candidate) =>
      candidate.line === line &&
      ((candidate.from === from && candidate.to === to) ||
        (candidate.from === to && candidate.to === from)),
  );
  if (!connection) throw new Error(`Missing ${line} connection ${from} -> ${to}`);
  const points = connection.from === from
    ? layout.getConnectionPoints(connection)
    : [...layout.getConnectionPoints(connection)].reverse();
  return points.slice(1)
    .map((point, index) => `${Math.sign(point.x - points[index].x)},${Math.sign(point.y - points[index].y)}`)
    .filter((direction, index, all) => index === 0 || direction !== all[index - 1]);
}

function renderedGridPoints(
  layout: CorridorLayout,
  line: string,
  from: string,
  to: string,
): GridPoint[] {
  const connection = networkData.connections.find(
    (candidate) =>
      candidate.line === line &&
      ((candidate.from === from && candidate.to === to) ||
        (candidate.from === to && candidate.to === from)),
  );
  if (!connection) throw new Error(`Missing ${line} connection ${from} -> ${to}`);
  const points = connection.from === from
    ? layout.getConnectionPoints(connection)
    : [...layout.getConnectionPoints(connection)].reverse();
  return points.map((point) => ({
    x: (point.x - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
    y: (point.y - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
  }));
}

function findConnection(
  line: string,
  from: string,
  to: string,
) {
  const connection = networkData.connections.find(
    (candidate) =>
      candidate.line === line &&
      ((candidate.from === from && candidate.to === to) ||
        (candidate.from === to && candidate.to === from)),
  );
  if (!connection) throw new Error(`Missing ${line} connection ${from} -> ${to}`);
  return connection;
}

function findConnectionById(connectionId: string) {
  const connection = networkData.connections.find((candidate) => candidate.id === connectionId);
  if (!connection) throw new Error(`Missing connection ${connectionId}`);
  return connection;
}

function segmentDelta(
  layout: CorridorLayout,
  connection: ReturnType<typeof findConnection>,
  visibleConnectionIds: ReadonlySet<string>,
  segmentIndex: number,
  centredSegmentIndex = segmentIndex,
) {
  const rendered = layout.getConnectionRenderPoints(connection, visibleConnectionIds);
  const centred = layout.getConnectionCameraPoints(connection);
  const renderedMidpoint = midpoint(rendered[segmentIndex], rendered[segmentIndex + 1]);
  const centredMidpoint = midpoint(centred[centredSegmentIndex], centred[centredSegmentIndex + 1]);
  return {
    x: renderedMidpoint.x - centredMidpoint.x,
    y: renderedMidpoint.y - centredMidpoint.y,
  };
}

function segmentMidpointDistance(
  layout: CorridorLayout,
  firstConnection: ReturnType<typeof findConnection>,
  secondConnection: ReturnType<typeof findConnection>,
  visibleConnectionIds: ReadonlySet<string>,
  segmentIndex: number,
) {
  const first = layout.getConnectionRenderPoints(firstConnection, visibleConnectionIds);
  const second = layout.getConnectionRenderPoints(secondConnection, visibleConnectionIds);
  const firstMidpoint = midpoint(first[segmentIndex], first[segmentIndex + 1]);
  const secondMidpoint = midpoint(second[segmentIndex], second[segmentIndex + 1]);
  return Math.hypot(firstMidpoint.x - secondMidpoint.x, firstMidpoint.y - secondMidpoint.y);
}

function midpoint(first: { x: number; y: number }, second: { x: number; y: number }) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function leftmostPointY(points: Point[]): number {
  return points.reduce((leftmost, point) => point.x < leftmost.x ? point : leftmost).y;
}

function expectSegmentIsVertical(points: { x: number; y: number }[], segmentIndex: number) {
  expect(points[segmentIndex].x).toBeCloseTo(points[segmentIndex + 1].x);
  expect(points[segmentIndex].y).not.toBeCloseTo(points[segmentIndex + 1].y);
}

function gridPointFromSvgPoint(point: { x: number; y: number }): GridPoint {
  return {
    x: (point.x - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
    y: (point.y - GRID_CELL_SIZE / 2) / GRID_CELL_SIZE,
  };
}
