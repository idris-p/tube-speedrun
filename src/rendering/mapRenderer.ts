import { LINE_BY_ID, compareLineIds } from "../data/lines";
import type { GameState } from "../game/GameState";
import {
  getConnectionFirstStepDirection,
  getDirectionAngle,
  getStation,
  type MovementDirection,
} from "../game/movement";
import type { Connection, LineId, NetworkData, Point } from "../data/types";
import { getSvgPoint } from "../input/mouse";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "./grid";
import { CorridorLayout, type StationMarkerGroup } from "./corridorLayout";
import { STUB_STROKE_WIDTH } from "./lineStyles";
import { renderRevealedLine } from "./lineRenderer";
import {
  getCanonicalPath,
  getCanonicalPathKey,
  getCenteredOffset,
  PARALLEL_LINE_SPACING,
  PARALLEL_STUB_SPACING,
} from "./pathOffset";
import { renderRiverThames } from "./riverRenderer";
import {
  getStationLabelPlacement,
  isInterchangeStation,
  renderStationMarker,
  type StationMarkerRenderOptions,
} from "./stationRenderer";

const SVG_NS = "http://www.w3.org/2000/svg";
const BASE_VIEWBOX_WIDTH = 760;
const BASE_VIEWBOX_HEIGHT = 560;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 1.25;
const STUB_LENGTH = 40;
const STUB_ARROW_LENGTH = 11;
const STUB_ARROW_HALF_WIDTH = STUB_STROKE_WIDTH / 2;
const STUB_ARROW_OVERLAP = 0.2;
const MAP_PAN_PADDING = GRID_CELL_SIZE * 3;
const MENU_PREVIEW_SECONDS_PER_ORBIT = 360;
const MENU_PREVIEW_ORBIT_RADIUS_X = 360;
const MENU_PREVIEW_ORBIT_RADIUS_Y = 250;
const MENU_PREVIEW_FOCUS_STATIONS = [
  "hammersmith-circle-and-hammersmith-and-city",
  "baker-street",
  "camden-town",
  "king-s-cross-st-pancras",
  "liverpool-street",
  "bank",
  "waterloo",
  "westminster",
  "oxford-circus",
] as const;
const CIRCLE_HAMMERSMITH_CITY_WEST_BRANCH = [
  "hammersmith-circle-and-hammersmith-and-city",
  "goldhawk-road",
  "shepherd-s-bush-market",
  "wood-lane",
  "latimer-road",
  "ladbroke-grove",
  "westbourne-park",
  "royal-oak",
  "paddington",
] as const;
const CIRCLE_DISTRICT_HIGH_STREET_KENSINGTON_BRANCH = [
  "high-street-kensington",
  "notting-hill-gate",
  "bayswater",
  "paddington",
] as const;
const PADDINGTON_EDGWARE_ROAD_BRANCH = ["paddington", "edgware-road"] as const;
const SUBSURFACE_EAST_TRUNK = [
  "baker-street",
  "great-portland-street",
  "euston-square",
  "king-s-cross-st-pancras",
  "farringdon",
  "barbican",
  "moorgate",
  "liverpool-street",
  "aldgate",
] as const;
const DISTRICT_HAMMERSMITH_CITY_EAST_BRANCH = [
  "aldgate-east",
  "whitechapel",
  "stepney-green",
  "mile-end",
  "bow-road",
  "bromley-by-bow",
  "west-ham",
  "plaistow",
  "upton-park",
  "east-ham",
  "barking",
] as const;

export class MapRenderer {
  readonly svg: SVGSVGElement;

  private readonly network: NetworkData;

  private readonly mapBounds: MapBounds;

  private readonly corridorLayout: CorridorLayout;

  private zoom = 1;

  private completedCameraCenter: Point | null = null;

  private renderedSeed: string | null = null;

  private menuPreviewOrbitOffsetMs = 0;

  constructor(container: HTMLElement, network: NetworkData) {
    this.network = network;
    this.corridorLayout = new CorridorLayout(network);
    this.mapBounds = getNetworkBounds(network);
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "tube-map");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "London transport speedrun map");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    container.append(this.svg);
  }

  render(
    state: GameState,
    pointerPoint: Point | null,
    pointerDirection: MovementDirection,
    lineReveal: LineRevealAnimation | null = null,
    stationWipe: StationWipeAnimation | null = null,
    cameraPan: CameraPanAnimation | null = null,
  ): void {
    const wasMenuPreview = this.svg.classList.contains("tube-map-menu-preview");
    if (this.renderedSeed !== state.seed) {
      this.renderedSeed = state.seed;
      this.completedCameraCenter = null;
    }
    this.svg.classList.remove("tube-map-menu-preview", "tube-map-explorer");
    if (wasMenuPreview) {
      this.menuPreviewOrbitOffsetMs = 0;
    }
    this.svg.classList.toggle("tube-map-running", !state.completed);
    this.svg.classList.toggle("tube-map-completed", state.completed);
    const hiddenCurrentStationId = lineReveal?.hiddenCurrentStationId ?? null;
    const isCurrentStationWiping = stationWipe?.stationId === hiddenCurrentStationId;
    const hideCurrentStation = hiddenCurrentStationId === state.currentStationId && !isCurrentStationWiping;
    const suppressCurrentStationStubs = hiddenCurrentStationId === state.currentStationId;
    const visibleConnections = this.getVisibleConnections(state);
    const visibleConnectionPaths = visibleConnections.map((connection) => ({
      connection,
      points: this.corridorLayout.getConnectionRenderPoints(connection, state.revealedConnections),
      cameraPoints: this.corridorLayout.getConnectionCameraPoints(connection),
    }));
    const currentStation = getStation(this.network, state.currentStationId);
    const currentPoint = getSelectedStationMarkerPoint(
      this.corridorLayout.getStationMarkerGroups(state.currentStationId),
      state.selectedLineId,
      gridPointToSvgPoint(currentStation),
    );
    const revealCameraPoint = lineReveal
      ? this.getLineRevealCameraPoint(visibleConnectionPaths, lineReveal)
      : null;
    const cameraPanPoint = cameraPan ? interpolatePoint(cameraPan.from, cameraPan.to, cameraPan.progress) : null;
    const cameraAnchor = revealCameraPoint ?? cameraPanPoint ?? currentPoint;
    const viewBoxSize = this.getViewBoxSize();
    if (!state.completed) {
      this.completedCameraCenter = null;
    }
    const cameraCenter = state.completed
      ? clampViewCenter(
          revealCameraPoint ?? this.completedCameraCenter ?? cameraAnchor,
          viewBoxSize,
          this.mapBounds,
          getMapPanPadding(viewBoxSize),
        )
      : cameraAnchor;
    if (state.completed) {
      this.completedCameraCenter = cameraCenter;
    }
    const viewBox = {
      x: cameraCenter.x - viewBoxSize.width / 2,
      y: cameraCenter.y - viewBoxSize.height / 2,
      width: viewBoxSize.width,
      height: viewBoxSize.height,
    };
    this.svg.setAttribute(
      "viewBox",
      `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
    );
    this.svg.replaceChildren();

    this.renderGrid(viewBox);
    renderRiverThames(this.svg, viewBox);

    const revealedLayer = document.createElementNS(SVG_NS, "g");
    revealedLayer.setAttribute("class", "revealed-lines");
    this.svg.append(revealedLayer);

    const visibleStationIds = new Set<string>(hideCurrentStation ? [] : [state.currentStationId]);
    for (const group of groupConnectionsByRenderedPath(visibleConnectionPaths)) {
      group.forEach(({ connection, points }, index) => {
        const reveal = lineReveal?.revealLine && lineReveal.connectionId === connection.id
          ? { fromStationId: lineReveal.fromStationId, progress: lineReveal.progress }
          : null;
        renderRevealedLine(
          revealedLayer,
          connection,
          this.network,
          getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
          points,
          reveal,
        );
      });
    }

    for (const connection of visibleConnections) {
      if (connection.from !== hiddenCurrentStationId || isCurrentStationWiping) {
        visibleStationIds.add(connection.from);
      }
      if (connection.to !== hiddenCurrentStationId || isCurrentStationWiping) {
        visibleStationIds.add(connection.to);
      }
    }

    if (!state.completed && !suppressCurrentStationStubs) {
      const stubLayer = document.createElementNS(SVG_NS, "g");
      stubLayer.setAttribute("class", "direction-stubs");
      this.svg.append(stubLayer);
      const directionStubs = this.getDirectionStubs(state.currentStationId, state.revealedConnections);
      this.renderDirectionStubs(
        stubLayer,
        directionStubs,
        !isInterchangeStation(currentStation),
        state.selectedLineId,
      );
    }

    const stationLayer = document.createElementNS(SVG_NS, "g");
    stationLayer.setAttribute("class", "stations");
    this.svg.append(stationLayer);

    for (const stationId of visibleStationIds) {
      const station = getStation(this.network, stationId);
      const markerOptions: StationMarkerRenderOptions = {};
      if (stationWipe?.stationId === station.id) {
        markerOptions.wipe = {
          id: `station-wipe-${station.id}`,
          direction: stationWipe.direction,
          progress: stationWipe.progress,
        };
      }
      if (station.id !== state.currentStationId) {
        markerOptions.revealedLabel = {
          placement: getStationLabelPlacement(station),
        };
      }
      renderStationMarker(
        stationLayer,
        station,
        this.network,
        state.selectedLineId,
        station.id === state.currentStationId,
        this.corridorLayout.getStationMarkerGroups(station.id),
        undefined,
        markerOptions,
      );
    }

    if (!state.completed) {
      const pointerLayer = document.createElementNS(SVG_NS, "g");
      pointerLayer.setAttribute("class", "pointer-layer");
      this.svg.append(pointerLayer);
      this.renderPointer(pointerLayer, pointerPoint, pointerDirection, state.rejectedMoveAt !== null);
    }
  }

  renderIdle(): void {
    const wasMenuPreview = this.svg.classList.contains("tube-map-menu-preview");
    this.svg.classList.remove("tube-map-running");
    this.svg.classList.remove("tube-map-completed", "tube-map-panning", "tube-map-menu-preview", "tube-map-explorer");
    if (wasMenuPreview) {
      this.menuPreviewOrbitOffsetMs = 0;
    }
    this.completedCameraCenter = null;
    this.renderedSeed = null;
    const viewBoxSize = this.getViewBoxSize();
    const baseViewBoxSize = this.getBaseViewBoxSize();
    const viewBox = {
      x: (baseViewBoxSize.width - viewBoxSize.width) / 2,
      y: (baseViewBoxSize.height - viewBoxSize.height) / 2,
      width: viewBoxSize.width,
      height: viewBoxSize.height,
    };
    this.svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    this.svg.replaceChildren();
    this.renderGrid(viewBox);
    renderRiverThames(this.svg, viewBox);
  }

  renderMenuPreview(now = performance.now()): void {
    const wasMenuPreview = this.svg.classList.contains("tube-map-menu-preview");
    const orbitDurationMs = MENU_PREVIEW_SECONDS_PER_ORBIT * 1_000;
    if (!wasMenuPreview) {
      this.menuPreviewOrbitOffsetMs = Math.random() * orbitDurationMs;
    }
    this.svg.classList.remove("tube-map-running", "tube-map-completed", "tube-map-panning", "tube-map-explorer");
    this.svg.classList.add("tube-map-menu-preview");
    this.completedCameraCenter = null;
    this.renderedSeed = null;

    const viewBoxSize = this.getMenuPreviewViewBoxSize();
    const cameraCenter = clampViewCenter(
      this.getMenuPreviewCameraCenter(now + this.menuPreviewOrbitOffsetMs),
      viewBoxSize,
      this.mapBounds,
      MAP_PAN_PADDING,
    );
    const viewBox = {
      x: cameraCenter.x - viewBoxSize.width / 2,
      y: cameraCenter.y - viewBoxSize.height / 2,
      width: viewBoxSize.width,
      height: viewBoxSize.height,
    };
    this.svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    this.svg.replaceChildren();

    this.renderGrid(viewBox);
    renderRiverThames(this.svg, viewBox);

    const allConnectionIds = new Set(this.network.connections.map((connection) => connection.id));
    const visibleConnectionPaths = this.network.connections.map((connection) => ({
      connection,
      points: this.corridorLayout.getConnectionRenderPoints(connection, allConnectionIds),
      cameraPoints: this.corridorLayout.getConnectionCameraPoints(connection),
    }));
    const revealedLayer = document.createElementNS(SVG_NS, "g");
    revealedLayer.setAttribute("class", "revealed-lines");
    this.svg.append(revealedLayer);
    for (const group of groupConnectionsByRenderedPath(visibleConnectionPaths)) {
      group.forEach(({ connection, points }, index) => {
        renderRevealedLine(
          revealedLayer,
          connection,
          this.network,
          getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
          points,
        );
      });
    }

    const stationLayer = document.createElementNS(SVG_NS, "g");
    stationLayer.setAttribute("class", "stations");
    this.svg.append(stationLayer);
    for (const station of this.network.stations) {
      if (station.lines.length === 0) {
        continue;
      }
      renderStationMarker(
        stationLayer,
        station,
        this.network,
        station.lines[0],
        false,
        this.corridorLayout.getStationMarkerGroups(station.id),
      );
    }

    this.svg.classList.remove("tube-map-running", "tube-map-completed", "tube-map-panning");
    this.svg.classList.add("tube-map-menu-preview");
  }

  resetExplorerView(): void {
    this.zoom = MIN_ZOOM;
    this.completedCameraCenter = this.getMenuPreviewBaseCenter();
  }

  focusExplorerStation(stationId: string): void {
    const station = getStation(this.network, stationId);
    const markerGroups = this.corridorLayout.getStationMarkerGroups(stationId);
    this.zoom = 1;
    this.completedCameraCenter = markerGroups.length === 0
      ? gridPointToSvgPoint(station)
      : {
          x: markerGroups.reduce((sum, group) => sum + group.point.x, 0) / markerGroups.length,
          y: markerGroups.reduce((sum, group) => sum + group.point.y, 0) / markerGroups.length,
        };
  }

  renderExplorer(): void {
    const viewBoxSize = this.getViewBoxSize();
    const cameraCenter = clampViewCenter(
      this.completedCameraCenter ?? this.getMenuPreviewBaseCenter(),
      viewBoxSize,
      this.mapBounds,
      getMapPanPadding(viewBoxSize),
    );
    this.completedCameraCenter = cameraCenter;
    const viewBox = {
      x: cameraCenter.x - viewBoxSize.width / 2,
      y: cameraCenter.y - viewBoxSize.height / 2,
      width: viewBoxSize.width,
      height: viewBoxSize.height,
    };
    this.svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    this.svg.classList.remove("tube-map-running", "tube-map-menu-preview");
    this.svg.classList.add("tube-map-completed", "tube-map-explorer");
    this.svg.replaceChildren();

    this.renderGrid(viewBox);
    renderRiverThames(this.svg, viewBox);

    const allConnectionIds = new Set(this.network.connections.map((connection) => connection.id));
    const visibleConnectionPaths = this.network.connections.map((connection) => ({
      connection,
      points: this.corridorLayout.getConnectionRenderPoints(connection, allConnectionIds),
    }));
    const revealedLayer = document.createElementNS(SVG_NS, "g");
    revealedLayer.setAttribute("class", "revealed-lines");
    this.svg.append(revealedLayer);
    for (const group of groupConnectionsByRenderedPath(visibleConnectionPaths)) {
      group.forEach(({ connection, points }, index) => {
        renderRevealedLine(
          revealedLayer,
          connection,
          this.network,
          getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
          points,
        );
      });
    }

    const stationLayer = document.createElementNS(SVG_NS, "g");
    stationLayer.setAttribute("class", "stations");
    this.svg.append(stationLayer);
    for (const station of this.network.stations) {
      if (station.lines.length === 0) {
        continue;
      }
      renderStationMarker(
        stationLayer,
        station,
        this.network,
        station.lines[0],
        false,
        this.corridorLayout.getStationMarkerGroups(station.id),
        undefined,
        {
          revealedLabel: {
            placement: getStationLabelPlacement(station),
          },
        },
      );
    }
  }

  zoomIn(): void {
    this.zoom = Math.min(MAX_ZOOM, this.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoom = Math.max(MIN_ZOOM, this.zoom / ZOOM_STEP);
  }

  zoomByWheel(deltaY: number): void {
    const factor = Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0018);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  resetZoom(): void {
    this.zoom = 1;
  }

  panByClientDelta(deltaX: number, deltaY: number): void {
    if (!this.completedCameraCenter || this.svg.clientWidth <= 0 || this.svg.clientHeight <= 0) {
      return;
    }

    const viewBoxSize = this.getViewBoxSize();
    this.completedCameraCenter = clampViewCenter(
      {
        x: this.completedCameraCenter.x - deltaX * (viewBoxSize.width / this.svg.clientWidth),
        y: this.completedCameraCenter.y - deltaY * (viewBoxSize.height / this.svg.clientHeight),
      },
      viewBoxSize,
      this.mapBounds,
      getMapPanPadding(viewBoxSize),
    );
  }

  getLineSwitchCameraPan(fromState: GameState, toState: GameState): { from: Point; to: Point } | null {
    if (fromState.currentStationId !== toState.currentStationId || fromState.selectedLineId === toState.selectedLineId) {
      return null;
    }

    const from = this.getCurrentStationCameraPoint(fromState);
    const to = this.getCurrentStationCameraPoint(toState);
    if (distance(from, to) < 0.01) {
      return null;
    }
    return { from, to };
  }

  private renderGrid(viewBox: { x: number; y: number; width: number; height: number }): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "grid-layer");

    const minX = Math.floor(viewBox.x / GRID_CELL_SIZE) * GRID_CELL_SIZE - GRID_CELL_SIZE;
    const maxX = viewBox.x + viewBox.width + GRID_CELL_SIZE;
    const minY = Math.floor(viewBox.y / GRID_CELL_SIZE) * GRID_CELL_SIZE - GRID_CELL_SIZE;
    const maxY = viewBox.y + viewBox.height + GRID_CELL_SIZE;

    for (let x = minX; x <= maxX; x += GRID_CELL_SIZE) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(minY));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(maxY));
      line.setAttribute("class", isMajorGridLine(x) ? "grid-line grid-line-major" : "grid-line");
      layer.append(line);
    }

    for (let y = minY; y <= maxY; y += GRID_CELL_SIZE) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(minX));
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(maxX));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", isMajorGridLine(y) ? "grid-line grid-line-major" : "grid-line");
      layer.append(line);
    }

    this.svg.append(layer);
  }

  private renderPointer(layer: SVGGElement, pointerPoint: Point | null, pointerDirection: MovementDirection, rejected: boolean): void {
    if (!pointerPoint) {
      return;
    }

    const svgPoint = getSvgPoint(this.svg, pointerPoint.x, pointerPoint.y);
    const arrow = document.createElementNS(SVG_NS, "g");
    arrow.setAttribute(
      "transform",
      `translate(${svgPoint.x} ${svgPoint.y}) scale(${1 / this.zoom}) rotate(${getDirectionAngle(pointerDirection)})`,
    );
    arrow.setAttribute("class", rejected ? "cursor-arrow cursor-arrow-rejected" : "cursor-arrow");

    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute(
      "d",
      "M -15 -3 L 4 -3 L 4 -9 L 17 0 L 4 9 L 4 3 L -15 3 Z",
    );
    shape.setAttribute("class", "cursor-arrow-shape");
    arrow.append(shape);
    layer.append(arrow);
  }

  private getLineRevealCameraPoint(
    visibleConnectionPaths: RenderedConnectionPath[],
    lineReveal: LineRevealAnimation,
  ): Point | null {
    for (const group of groupConnectionsByRenderedPath(visibleConnectionPaths)) {
      const revealIndex = group.findIndex(({ connection }) => connection.id === lineReveal.connectionId);
      if (revealIndex < 0) continue;

      const { connection, points, cameraPoints } = group[revealIndex];
      const path = getCanonicalPath(cameraPoints ?? points);
      const fromPoint = this.corridorLayout.getStationLinePoint(lineReveal.fromStationId, connection.line);
      const orientedPath = isCloserToPoint(path.at(-1)!, fromPoint, path[0])
        ? [...path].reverse()
        : path;
      return getPointAlongPolyline(orientedPath, lineReveal.progress);
    }

    return null;
  }

  private getVisibleConnections(state: GameState): Connection[] {
    return this.network.connections.filter((connection) => state.revealedConnections.has(connection.id));
  }

  private getCurrentStationCameraPoint(state: GameState): Point {
    const station = getStation(this.network, state.currentStationId);
    return getSelectedStationMarkerPoint(
      this.corridorLayout.getStationMarkerGroups(state.currentStationId),
      state.selectedLineId,
      gridPointToSvgPoint(station),
    );
  }

  private getViewBoxSize(): { width: number; height: number } {
    const baseSize = this.getBaseViewBoxSize();
    return {
      width: baseSize.width / this.zoom,
      height: baseSize.height / this.zoom,
    };
  }

  private getMenuPreviewViewBoxSize(): { width: number; height: number } {
    return this.getBaseViewBoxSize();
  }

  private getMenuPreviewCameraCenter(now: number): Point {
    const baseCenter = this.getMenuPreviewBaseCenter();
    const orbitDurationMs = MENU_PREVIEW_SECONDS_PER_ORBIT * 1_000;
    const radians = ((now % orbitDurationMs) / orbitDurationMs) * Math.PI * 2;
    return {
      x: baseCenter.x + Math.cos(radians) * MENU_PREVIEW_ORBIT_RADIUS_X,
      y: baseCenter.y + Math.sin(radians) * MENU_PREVIEW_ORBIT_RADIUS_Y,
    };
  }

  private getMenuPreviewBaseCenter(): Point {
    const centralPoints = MENU_PREVIEW_FOCUS_STATIONS.flatMap((stationId) => {
      const station = this.network.stations.find((candidate) => candidate.id === stationId);
      return station ? [gridPointToSvgPoint(station)] : [];
    });
    const baseCenter = centralPoints.length === 0
      ? { x: (this.mapBounds.minX + this.mapBounds.maxX) / 2, y: (this.mapBounds.minY + this.mapBounds.maxY) / 2 }
      : {
          x: centralPoints.reduce((sum, point) => sum + point.x, 0) / centralPoints.length,
          y: centralPoints.reduce((sum, point) => sum + point.y, 0) / centralPoints.length,
        };
    return baseCenter;
  }

  private getBaseViewBoxSize(): { width: number; height: number } {
    const width = this.svg.clientWidth;
    const height = this.svg.clientHeight;
    if (width <= 0 || height <= 0) {
      return { width: BASE_VIEWBOX_WIDTH, height: BASE_VIEWBOX_HEIGHT };
    }

    const targetAspect = width / height;
    const baseAspect = BASE_VIEWBOX_WIDTH / BASE_VIEWBOX_HEIGHT;
    if (targetAspect >= baseAspect) {
      return {
        width: BASE_VIEWBOX_HEIGHT * targetAspect,
        height: BASE_VIEWBOX_HEIGHT,
      };
    }

    return {
      width: BASE_VIEWBOX_WIDTH,
      height: BASE_VIEWBOX_WIDTH / targetAspect,
    };
  }

  private getDirectionStubs(stationId: string, revealedConnectionIds: Set<string>) {
    return this.network.connections.flatMap((connection) => {
      if (revealedConnectionIds.has(connection.id)) {
        return [];
      }
      if (connection.from !== stationId && connection.to !== stationId) {
        return [];
      }

      const unit = getDirectionStubUnit(connection, stationId);
      if (!unit) {
        return [];
      }

      const linePoint = this.corridorLayout.getStationLinePoint(stationId, connection.line);
      const start = getStationSpecificDirectionStubStart(stationId, connection.line, linePoint) ??
        getDirectionStubStart(
          this.corridorLayout.getStationMarkerGroups(stationId).map((group) => group.point),
          linePoint,
          unit,
        );

      return [
        {
          connection,
          key: `${unit.x},${unit.y}|${start.x},${start.y}`,
          start,
          linePoint,
          unit,
          normal: { x: -unit.y, y: unit.x },
        },
      ];
    });
  }

  private renderDirectionStubs(
    layer: SVGGElement,
    stubs: ReturnType<MapRenderer["getDirectionStubs"]>,
    showArrowHeads: boolean,
    selectedLineId: LineId,
  ): void {

    const groups = new Map<string, typeof stubs>();
    for (const stub of stubs) {
      const group = groups.get(stub.key) ?? [];
      group.push(stub);
      groups.set(stub.key, group);
    }

    for (const group of groups.values()) {
      group.sort((a, b) =>
        compareDirectionStubsByRenderedOffset(a, b, group, this.corridorLayout) ||
        compareLineIds(a.connection.line, b.connection.line) ||
        a.connection.id.localeCompare(b.connection.id)
      );
    }

    const renderItems = [...groups.values()].flatMap((group) =>
      group.map((stub, index) => ({
        stub,
        offset: getCenteredOffset(index, group.length, PARALLEL_STUB_SPACING),
      }))
    );
    renderItems.sort((a, b) =>
      compareDirectionStubsBySelectedLine(a.stub, b.stub, selectedLineId)
    );

    for (const { stub, offset } of renderItems) {
      const start = {
        x: stub.start.x + stub.normal.x * offset,
        y: stub.start.y + stub.normal.y * offset,
      };
      const arrowTip = {
        x: stub.start.x + stub.unit.x * STUB_LENGTH + stub.normal.x * offset,
        y: stub.start.y + stub.unit.y * STUB_LENGTH + stub.normal.y * offset,
      };
      const lineEnd = showArrowHeads
        ? {
            x: arrowTip.x - stub.unit.x * (STUB_ARROW_LENGTH - STUB_ARROW_OVERLAP),
            y: arrowTip.y - stub.unit.y * (STUB_ARROW_LENGTH - STUB_ARROW_OVERLAP),
          }
        : arrowTip;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(lineEnd.x));
      line.setAttribute("y2", String(lineEnd.y));
      line.setAttribute("stroke", LINE_BY_ID[stub.connection.line].color);
      line.setAttribute("stroke-width", String(STUB_STROKE_WIDTH));
      line.setAttribute("class", "direction-stub");
      if (stub.connection.line === "walk") {
        line.setAttribute("stroke-dasharray", "8 6");
      }
      layer.append(line);

      if (showArrowHeads) {
        const arrow = document.createElementNS(SVG_NS, "polygon");
        arrow.setAttribute(
          "points",
          getStubArrowHeadPoints(arrowTip, stub.unit, stub.normal)
            .map((point) => `${point.x},${point.y}`)
            .join(" "),
        );
        arrow.setAttribute("fill", LINE_BY_ID[stub.connection.line].color);
        arrow.setAttribute("class", "direction-stub-arrow");
        layer.append(arrow);
      }
    }
  }

}

export type MapBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type MapPadding = number | { x: number; y: number };

export function getMapPanPadding(viewBoxSize: { width: number; height: number }): Point {
  return {
    x: Math.max(MAP_PAN_PADDING, viewBoxSize.width / 2),
    y: Math.max(MAP_PAN_PADDING, viewBoxSize.height / 2),
  };
}

export function clampViewCenter(
  center: Point,
  viewBoxSize: { width: number; height: number },
  bounds: MapBounds,
  padding: MapPadding = 0,
): Point {
  const horizontalPadding = typeof padding === "number" ? padding : padding.x;
  const verticalPadding = typeof padding === "number" ? padding : padding.y;
  return {
    x: clampAxis(center.x, viewBoxSize.width, bounds.minX - horizontalPadding, bounds.maxX + horizontalPadding),
    y: clampAxis(center.y, viewBoxSize.height, bounds.minY - verticalPadding, bounds.maxY + verticalPadding),
  };
}

export function getSelectedStationMarkerPoint(
  markerGroups: StationMarkerGroup[],
  selectedLineId: LineId,
  fallback: Point,
): Point {
  return markerGroups.find((group) => group.lines.includes(selectedLineId))?.point ?? fallback;
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

function subtractPoints(first: Point, second: Point): Point {
  return { x: first.x - second.x, y: first.y - second.y };
}

function getNetworkBounds(network: NetworkData): MapBounds {
  const points = [
    ...network.stations.map(gridPointToSvgPoint),
    ...network.connections.flatMap((connection) => connection.path.map(gridPointToSvgPoint)),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function clampAxis(value: number, viewportLength: number, minimum: number, maximum: number): number {
  if (viewportLength >= maximum - minimum) {
    return (minimum + maximum) / 2;
  }
  return Math.max(minimum + viewportLength / 2, Math.min(maximum - viewportLength / 2, value));
}

function isMajorGridLine(value: number): boolean {
  return Math.round(value / GRID_CELL_SIZE) % 5 === 0;
}

type RenderedConnectionPath = {
  connection: Connection;
  points: Point[];
  cameraPoints?: Point[];
};

export type DirectionStubLike = {
  connection: Connection;
  linePoint: Point;
  normal: Point;
};

export function compareDirectionStubsByRenderedOffset(
  first: DirectionStubLike,
  second: DirectionStubLike,
  group: readonly DirectionStubLike[],
  corridorLayout: CorridorLayout,
): number {
  return getDirectionStubRenderedOffsetProjection(first, group, corridorLayout) -
    getDirectionStubRenderedOffsetProjection(second, group, corridorLayout);
}

export function compareDirectionStubsBySelectedLine(
  first: DirectionStubLike,
  second: DirectionStubLike,
  selectedLineId: LineId,
): number {
  return Number(first.connection.line === selectedLineId) - Number(second.connection.line === selectedLineId);
}

function getDirectionStubRenderedOffsetProjection(
  stub: DirectionStubLike,
  group: readonly DirectionStubLike[],
  corridorLayout: CorridorLayout,
): number {
  const visibleConnectionIds = new Set(group.map((candidate) => candidate.connection.id));
  const cameraPoints = corridorLayout.getConnectionCameraPoints(stub.connection);
  const renderedPoints = corridorLayout.getConnectionRenderPoints(stub.connection, visibleConnectionIds);
  const directRenderDelta = getEndpointDelta(cameraPoints, renderedPoints, stub.linePoint);
  const directProjection = dotPoints(directRenderDelta, stub.normal);
  if (Math.abs(directProjection) > 0.01) {
    return directProjection;
  }

  const renderedPathGroups = groupConnectionsByRenderedPath(
    group.map((candidate) => ({
      connection: candidate.connection,
      points: corridorLayout.getConnectionCameraPoints(candidate.connection),
    })),
  );
  const sharedPathGroup = renderedPathGroups.find((candidate) =>
    candidate.some((item) => item.connection.id === stub.connection.id)
  );
  if (!sharedPathGroup || sharedPathGroup.length < 2) {
    return 0;
  }

  const itemIndex = sharedPathGroup.findIndex((item) => item.connection.id === stub.connection.id);
  const item = sharedPathGroup[itemIndex];
  if (!item) return 0;

  const endpointNormal = getCanonicalEndpointNormal(item.points, stub.linePoint);
  if (!endpointNormal) return 0;

  return getCenteredOffset(itemIndex, sharedPathGroup.length, PARALLEL_LINE_SPACING) *
    dotPoints(endpointNormal, stub.normal);
}

function getEndpointDelta(cameraPoints: Point[], renderedPoints: Point[], linePoint: Point): Point {
  const cameraEndpointIndex = isCloserToPoint(cameraPoints[0], linePoint, cameraPoints.at(-1)!)
    ? 0
    : cameraPoints.length - 1;
  const renderedPoint = cameraEndpointIndex === 0 ? renderedPoints[0] : renderedPoints.at(-1)!;
  const cameraPoint = cameraPoints[cameraEndpointIndex];
  return subtractPoints(renderedPoint, cameraPoint);
}

function getCanonicalEndpointNormal(points: Point[], linePoint: Point): Point | null {
  const canonicalPoints = getCanonicalPath(points);
  if (canonicalPoints.length < 2) return null;

  const start = canonicalPoints[0];
  const end = canonicalPoints.at(-1)!;
  const direction = isCloserToPoint(start, linePoint, end)
    ? {
        x: canonicalPoints[1].x - start.x,
        y: canonicalPoints[1].y - start.y,
      }
    : {
        x: end.x - canonicalPoints.at(-2)!.x,
        y: end.y - canonicalPoints.at(-2)!.y,
      };
  const length = Math.hypot(direction.x, direction.y);
  return length > 0
    ? getSegmentNormal({ x: direction.x / length, y: direction.y / length })
    : null;
}

export function groupConnectionsByRenderedPath(items: RenderedConnectionPath[]): RenderedConnectionPath[][] {
  const groups = new Map<string, RenderedConnectionPath[]>();

  for (const item of items) {
    const key = getCanonicalPathKey(item.points);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return [...groups.values()].map(sortRenderedConnectionPathGroup);
}

function sortRenderedConnectionPathGroup(group: RenderedConnectionPath[]): RenderedConnectionPath[] {
  const sharedPathLineOrder = getExplicitSharedPathLineOrder(group);
  return [...group].sort((a, b) =>
    getSharedPathLineRank(a, sharedPathLineOrder) -
      getSharedPathLineRank(b, sharedPathLineOrder) ||
    compareRenderedConnectionPaths(a, b),
  );
}

function getExplicitSharedPathLineOrder(group: RenderedConnectionPath[]): readonly LineId[] | null {
  return getSubsurfaceEastTrunkSharedPathOrder(group) ??
    getPaddingtonEdgwareRoadSharedPathOrder(group) ??
    getDistrictHammersmithCitySharedPathOrder(group) ??
    getCircleDistrictSharedPathOrder(group) ??
    getCircleHammersmithCitySharedPathOrder(group);
}

function getSharedPathLineRank(
  item: RenderedConnectionPath,
  orderedLines: readonly LineId[] | null,
): number {
  const orderedIndex = orderedLines?.indexOf(item.connection.line) ?? -1;
  return orderedIndex >= 0 ? orderedIndex : Number.MAX_SAFE_INTEGER;
}

function getCircleHammersmithCitySharedPathOrder(
  group: RenderedConnectionPath[],
): readonly LineId[] | null {
  if (!group.some((item) => item.connection.line === "circle") ||
      !group.some((item) => item.connection.line === "hammersmith-city")) {
    return null;
  }

  const circle = group.find((item) => item.connection.line === "circle");
  if (!circle) return null;
  const canonicalDirection = getFirstSegmentDirection(getCanonicalPath(circle.points));
  if (!canonicalDirection) return null;

  if (hasConnectionBetween(circle.connection, "baker-street", "edgware-road")) {
    return getSharedPathOrderWithLineAbove(canonicalDirection, "hammersmith-city", "circle");
  }

  const branchIndexes = getConnectionBranchIndexes(circle.connection, CIRCLE_HAMMERSMITH_CITY_WEST_BRANCH);
  if (!branchIndexes) return null;

  const routePoints = branchIndexes[0] < branchIndexes[1] ? circle.points : [...circle.points].reverse();
  const routeDirection = getFirstSegmentDirection(routePoints);
  if (!routeDirection) return null;

  const positiveOffsetIsLeft = dotPoints(
    getSegmentNormal(canonicalDirection),
    getScreenLeftNormal(routeDirection),
  ) > 0;
  return positiveOffsetIsLeft
    ? ["circle", "hammersmith-city"]
    : ["hammersmith-city", "circle"];
}

function getCircleDistrictSharedPathOrder(
  group: RenderedConnectionPath[],
): readonly LineId[] | null {
  if (!group.some((item) => item.connection.line === "circle") ||
      !group.some((item) => item.connection.line === "district")) {
    return null;
  }

  const circle = group.find((item) => item.connection.line === "circle");
  if (!circle) return null;

  const canonicalDirection = getFirstSegmentDirection(getCanonicalPath(circle.points));
  if (!canonicalDirection) return null;

  const highStreetKensingtonBranchIndexes = getConnectionBranchIndexes(
    circle.connection,
    CIRCLE_DISTRICT_HIGH_STREET_KENSINGTON_BRANCH,
  );
  if (highStreetKensingtonBranchIndexes) {
    const routePoints = highStreetKensingtonBranchIndexes[0] < highStreetKensingtonBranchIndexes[1]
      ? circle.points
      : [...circle.points].reverse();
    const routeDirection = getFirstSegmentDirection(routePoints);
    if (!routeDirection) return null;

    const positiveOffsetIsLeft = dotPoints(
      getSegmentNormal(canonicalDirection),
      getScreenLeftNormal(routeDirection),
    ) > 0;
    return positiveOffsetIsLeft
      ? ["circle", "district"]
      : ["district", "circle"];
  }

  if (!hasConnectionBetween(circle.connection, "south-kensington", "sloane-square")) {
    return null;
  }

  return getSharedPathOrderWithLineAbove(canonicalDirection, "circle", "district");
}

function getSubsurfaceEastTrunkSharedPathOrder(
  group: RenderedConnectionPath[],
): readonly LineId[] | null {
  const lineStack = ["hammersmith-city", "circle", "metropolitan"] as const;
  const matchingLines = lineStack.filter((line) => group.some((item) => item.connection.line === line));
  if (matchingLines.length < 2) return null;

  const reference = group.find((item) =>
    lineStack.some((line) => line === item.connection.line) &&
    getConnectionBranchIndexes(item.connection, SUBSURFACE_EAST_TRUNK),
  );
  if (!reference) return null;

  const canonicalDirection = getFirstSegmentDirection(getCanonicalPath(reference.points));
  return canonicalDirection ? getSharedPathVerticalStackOrder(canonicalDirection, matchingLines) : null;
}

function getPaddingtonEdgwareRoadSharedPathOrder(
  group: RenderedConnectionPath[],
): readonly LineId[] | null {
  const lineStack = ["hammersmith-city", "circle", "district"] as const;
  const matchingLines = lineStack.filter((line) => group.some((item) => item.connection.line === line));
  if (matchingLines.length < 2) return null;

  const reference = group.find((item) =>
    lineStack.some((line) => line === item.connection.line) &&
    getConnectionBranchIndexes(item.connection, PADDINGTON_EDGWARE_ROAD_BRANCH),
  );
  if (!reference) return null;

  const canonicalDirection = getFirstSegmentDirection(getCanonicalPath(reference.points));
  return canonicalDirection ? getSharedPathVerticalStackOrder(canonicalDirection, matchingLines) : null;
}

function getDistrictHammersmithCitySharedPathOrder(
  group: RenderedConnectionPath[],
): readonly LineId[] | null {
  if (!group.some((item) => item.connection.line === "district") ||
      !group.some((item) => item.connection.line === "hammersmith-city")) {
    return null;
  }

  const reference = group.find((item) =>
    (item.connection.line === "district" || item.connection.line === "hammersmith-city") &&
    getConnectionBranchIndexes(item.connection, DISTRICT_HAMMERSMITH_CITY_EAST_BRANCH),
  );
  if (!reference) return null;

  const canonicalDirection = getFirstSegmentDirection(getCanonicalPath(reference.points));
  return canonicalDirection
    ? getSharedPathVerticalStackOrder(canonicalDirection, ["hammersmith-city", "district"])
    : null;
}

function getSharedPathOrderWithLineAbove(
  canonicalDirection: Point,
  upperLine: LineId,
  lowerLine: LineId,
): readonly LineId[] {
  const positiveOffsetIsAbove = getSegmentNormal(canonicalDirection).y < 0;
  return positiveOffsetIsAbove
    ? [lowerLine, upperLine]
    : [upperLine, lowerLine];
}

function getSharedPathVerticalStackOrder(
  canonicalDirection: Point,
  linesFromTopToBottom: readonly LineId[],
): readonly LineId[] {
  const positiveOffsetIsAbove = getSegmentNormal(canonicalDirection).y < 0;
  return positiveOffsetIsAbove ? [...linesFromTopToBottom].reverse() : linesFromTopToBottom;
}

function compareRenderedConnectionPaths(a: RenderedConnectionPath, b: RenderedConnectionPath): number {
  return compareLineIds(a.connection.line, b.connection.line) ||
    a.connection.id.localeCompare(b.connection.id);
}

function hasConnectionBetween(connection: Connection, firstStationId: string, secondStationId: string): boolean {
  return (
    (connection.from === firstStationId && connection.to === secondStationId) ||
    (connection.from === secondStationId && connection.to === firstStationId)
  );
}

function getConnectionBranchIndexes(
  connection: Connection,
  branch: readonly string[],
): [number, number] | null {
  const fromIndex = branch.indexOf(connection.from);
  const toIndex = branch.indexOf(connection.to);
  if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) return null;
  return [fromIndex, toIndex];
}

function getFirstSegmentDirection(points: readonly Point[]): Point | null {
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
  return null;
}

function getSegmentNormal(direction: Point): Point {
  return { x: -direction.y, y: direction.x };
}

function getScreenLeftNormal(direction: Point): Point {
  return { x: direction.y, y: -direction.x };
}

function dotPoints(first: Point, second: Point): number {
  return first.x * second.x + first.y * second.y;
}

export function getPointAlongPolyline(points: Point[], progress: number): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const segmentLengths = points.slice(0, -1).map((point, index) =>
    Math.hypot(points[index + 1].x - point.x, points[index + 1].y - point.y),
  );
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength === 0) {
    return points[0];
  }

  let remainingLength = totalLength * clampedProgress;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (remainingLength > segmentLength) {
      remainingLength -= segmentLength;
      continue;
    }

    const from = points[index];
    const to = points[index + 1];
    const segmentProgress = segmentLength === 0 ? 0 : remainingLength / segmentLength;
    return {
      x: from.x + (to.x - from.x) * segmentProgress,
      y: from.y + (to.y - from.y) * segmentProgress,
    };
  }

  return points.at(-1)!;
}

export type LineRevealAnimation = {
  connectionId: string;
  fromStationId: string;
  hiddenCurrentStationId: string | null;
  revealLine: boolean;
  progress: number;
};

export type StationWipeAnimation = {
  stationId: string;
  direction: MovementDirection;
  progress: number;
};

export type CameraPanAnimation = {
  from: Point;
  to: Point;
  progress: number;
};

function isCloserToPoint(candidate: Point, target: Point, other: Point): boolean {
  return distance(candidate, target) < distance(other, target);
}

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function interpolatePoint(from: Point, to: Point, progress: number): Point {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return {
    x: from.x + (to.x - from.x) * clampedProgress,
    y: from.y + (to.y - from.y) * clampedProgress,
  };
}

export function getDirectionStubUnit(connection: Connection, stationId: string): Point | null {
  const direction = getConnectionFirstStepDirection(connection, stationId);
  if (!direction) return null;
  const radians = (getDirectionAngle(direction) * Math.PI) / 180;
  return {
    x: snapUnitComponent(Math.cos(radians)),
    y: snapUnitComponent(Math.sin(radians)),
  };
}

export function getDirectionStubStart(
  markerPoints: Point[],
  linePoint: Point,
  unit: Point,
): Point {
  if (markerPoints.length === 0) return linePoint;
  if (markerPoints.length === 1) return markerPoints[0];

  const minX = Math.min(...markerPoints.map((point) => point.x));
  const maxX = Math.max(...markerPoints.map((point) => point.x));
  const minY = Math.min(...markerPoints.map((point) => point.y));
  const maxY = Math.max(...markerPoints.map((point) => point.y));
  const isVertical = Math.abs(maxX - minX) < 0.01;
  const isHorizontal = Math.abs(maxY - minY) < 0.01;

  if (isVertical && unit.y !== 0) {
    const targetY = unit.y < 0 ? minY : maxY;
    return markerPoints.find((point) => Math.abs(point.y - targetY) < 0.01) ?? linePoint;
  }
  if (isHorizontal && unit.x !== 0) {
    const targetX = unit.x < 0 ? minX : maxX;
    return markerPoints.find((point) => Math.abs(point.x - targetX) < 0.01) ?? linePoint;
  }
  return linePoint;
}

export function getStationSpecificDirectionStubStart(
  stationId: string,
  lineId: LineId,
  linePoint: Point,
): Point | null {
  if (stationId === "stratford" && (lineId === "central" || lineId === "elizabeth")) {
    return linePoint;
  }
  return null;
}

function snapUnitComponent(value: number): number {
  if (Math.abs(value) < 0.000_001) return 0;
  if (Math.abs(Math.abs(value) - 1) < 0.000_001) return Math.sign(value);
  if (Math.abs(Math.abs(value) - Math.SQRT1_2) < 0.000_001) {
    return Math.sign(value) * Math.SQRT1_2;
  }
  return value;
}
