import { compareLineIds, LINE_BY_ID } from "../data/lines";
import type { GameState } from "../game/GameState";
import {
  getConnectionFirstStepDirection,
  getDirectionAngle,
  getStation,
  type MovementDirection,
} from "../game/movement";
import type { Connection, LineId, NetworkData, Point } from "../data/types";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "./grid";
import { CorridorLayout, type StationMarkerGroup } from "./corridorLayout";
import {
  DEFAULT_DIRECTION_STUB_LENGTH,
  renderDirectionStub,
} from "./directionStubRenderer";
import { renderRevealedLine } from "./lineRenderer";
import {
  getCanonicalPath,
  getCanonicalPathKey,
  getCenteredOffset,
  offsetPolylinePoints,
  PARALLEL_LINE_SPACING,
  PARALLEL_STUB_SPACING,
} from "./pathOffset";
import { renderRiverThames } from "./riverRenderer";
import {
  CONJOINED_HIGHLIGHT_RADIUS,
  getStationLabelPlacement,
  isInterchangeStation,
  renderStationMarker,
  STATION_BAR_WIDTH,
  type StationMarkerRenderOptions,
} from "./stationRenderer";

export {
  DEFAULT_DIRECTION_STUB_LENGTH,
  getDirectionStubHitPathPoints,
  getStubArrowHeadPoints,
  getStubShaftEnd,
} from "./directionStubRenderer";

const SVG_NS = "http://www.w3.org/2000/svg";
const BASE_VIEWBOX_WIDTH = 760;
const BASE_VIEWBOX_HEIGHT = 560;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 1.25;
const DEFAULT_GAMEPLAY_ZOOM = 1.25;
const NON_INTERCHANGE_DIRECTION_STUB_LENGTH = DEFAULT_DIRECTION_STUB_LENGTH + 2;
const INTERCHANGE_DIRECTION_STUB_LENGTH =
  DEFAULT_DIRECTION_STUB_LENGTH + CONJOINED_HIGHLIGHT_RADIUS - STATION_BAR_WIDTH / 2;
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

  private readonly allConnectionIds: ReadonlySet<string>;

  private readonly fullConnectionPaths: RenderedConnectionPath[];

  private renderedScene: "gameplay" | "menu" | "explorer" | null = null;

  private zoom = DEFAULT_GAMEPLAY_ZOOM;

  private completedCameraCenter: Point | null = null;

  private renderedSeed: string | null = null;

  private menuPreviewOrbitOffsetMs = 0;

  constructor(container: HTMLElement, network: NetworkData) {
    this.network = network;
    this.corridorLayout = new CorridorLayout(network);
    this.mapBounds = getNetworkBounds(network);
    this.allConnectionIds = new Set(network.connections.map((connection) => connection.id));
    this.fullConnectionPaths = network.connections.map((connection) => ({
      connection,
      points: this.corridorLayout.getConnectionRenderPoints(connection, this.allConnectionIds),
      cameraPoints: this.corridorLayout.getConnectionCameraPoints(connection),
    }));
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "tube-map");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "London transport speedrun map");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    container.append(this.svg);
  }

  render(
    state: GameState,
    lineReveal: LineRevealAnimation | null = null,
    stationWipe: StationWipeAnimation | null = null,
    cameraPan: CameraPanAnimation | null = null,
    completionInteractionLocked = false,
    targetArrivalCelebration = false,
    directionStubsInteractive = true,
    visibleDirectionStubConnectionIds: ReadonlySet<string> | null = null,
  ): void {
    const needsGameplayBackground = this.renderedScene !== "gameplay";
    this.renderedScene = "gameplay";
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
    this.svg.classList.toggle("tube-map-completed", state.completed && !completionInteractionLocked);
    this.svg.classList.toggle("tube-map-target-arrival", targetArrivalCelebration);
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
    if (needsGameplayBackground) {
      this.svg.replaceChildren();
      this.renderMapBackground();
    } else {
      for (const element of Array.from(this.svg.children)) {
        if (
          element.classList.contains("revealed-lines") ||
          element.classList.contains("direction-stubs") ||
          element.classList.contains("stations")
        ) {
          element.remove();
        }
      }
    }

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
      const directionStubs = this.getDirectionStubs(
        state.currentStationId,
        state.selectedLineId,
        state.revealedConnections,
      ).filter((stub) =>
        visibleDirectionStubConnectionIds === null ||
        visibleDirectionStubConnectionIds.has(stub.connection.id)
      );
      this.renderDirectionStubs(
        stubLayer,
        directionStubs,
        isInterchangeStation(currentStation),
        state.revealedConnections,
        visibleConnections,
        directionStubsInteractive,
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

  }

  renderMenuPreview(now = performance.now()): void {
    const wasMenuPreview = this.svg.classList.contains("tube-map-menu-preview");
    const orbitDurationMs = MENU_PREVIEW_SECONDS_PER_ORBIT * 1_000;
    if (!wasMenuPreview) {
      this.menuPreviewOrbitOffsetMs = Math.random() * orbitDurationMs;
    }
    this.svg.classList.remove(
      "tube-map-running",
      "tube-map-completed",
      "tube-map-panning",
      "tube-map-explorer",
      "tube-map-target-arrival",
    );
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
    if (this.renderedScene !== "menu") {
      this.renderFullMapScene(false);
      this.renderedScene = "menu";
    }

    this.svg.classList.remove(
      "tube-map-running",
      "tube-map-completed",
      "tube-map-panning",
      "tube-map-target-arrival",
    );
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
    this.svg.classList.remove("tube-map-running", "tube-map-menu-preview", "tube-map-target-arrival");
    this.svg.classList.add("tube-map-completed", "tube-map-explorer");
    if (this.renderedScene !== "explorer") {
      this.renderFullMapScene(true);
      this.renderedScene = "explorer";
    }
  }

  private renderFullMapScene(revealLabels: boolean): void {
    this.svg.replaceChildren();
    this.renderMapBackground();

    const revealedLayer = document.createElementNS(SVG_NS, "g");
    revealedLayer.setAttribute("class", "revealed-lines");
    this.svg.append(revealedLayer);
    for (const group of groupConnectionsByRenderedPath(this.fullConnectionPaths)) {
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
      if (station.lines.length === 0) continue;
      renderStationMarker(
        stationLayer,
        station,
        this.network,
        station.lines[0],
        false,
        this.corridorLayout.getStationMarkerGroups(station.id),
        undefined,
        revealLabels
          ? { revealedLabel: { placement: getStationLabelPlacement(station) } }
          : undefined,
      );
    }
  }

  private renderMapBackground(): void {
    const scenePadding = Math.max(BASE_VIEWBOX_WIDTH, BASE_VIEWBOX_HEIGHT) * 3;
    const sceneViewBox = {
      x: this.mapBounds.minX - scenePadding,
      y: this.mapBounds.minY - scenePadding,
      width: this.mapBounds.maxX - this.mapBounds.minX + scenePadding * 2,
      height: this.mapBounds.maxY - this.mapBounds.minY + scenePadding * 2,
    };
    this.renderGrid(sceneViewBox);
    renderRiverThames(this.svg, sceneViewBox);
  }

  zoomIn(): void {
    this.zoom = Math.min(MAX_ZOOM, this.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoom = Math.max(MIN_ZOOM, this.zoom / ZOOM_STEP);
  }

  zoomByWheel(deltaY: number, anchorClient?: Point): void {
    const factor = Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0018);
    this.zoomByFactor(factor, anchorClient);
  }

  zoomByFactor(factor: number, anchorClient?: Point): void {
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }

    const previousViewBoxSize = this.getViewBoxSize();
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    if (nextZoom === this.zoom) {
      return;
    }
    this.zoom = nextZoom;

    if (!anchorClient || !this.completedCameraCenter) {
      return;
    }
    const bounds = this.svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const nextViewBoxSize = this.getViewBoxSize();
    const anchorRatio = {
      x: (anchorClient.x - bounds.left) / bounds.width - 0.5,
      y: (anchorClient.y - bounds.top) / bounds.height - 0.5,
    };
    this.completedCameraCenter = clampViewCenter(
      getZoomAnchoredCameraCenter(
        this.completedCameraCenter,
        previousViewBoxSize,
        nextViewBoxSize,
        anchorRatio,
      ),
      nextViewBoxSize,
      this.mapBounds,
      getMapPanPadding(nextViewBoxSize),
    );
  }

  resetZoom(): void {
    this.zoom = DEFAULT_GAMEPLAY_ZOOM;
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

  private getDirectionStubs(
    stationId: string,
    selectedLineId: LineId,
    revealedConnections: ReadonlySet<string>,
  ) {
    return getAvailableDirectionConnections(this.network, stationId, selectedLineId).flatMap((connection) => {
      const direction = getConnectionFirstStepDirection(connection, stationId);
      const unit = getDirectionStubUnit(connection, stationId);
      if (!direction || !unit) {
        return [];
      }

      const linePoint = this.corridorLayout.getStationLinePoint(stationId, connection.line);
      const routePoints = getExploredDirectionStubRoutePoints(
        connection.id,
        getDirectionStubRoutePoints(
          this.corridorLayout.getConnectionCameraPoints(connection),
          linePoint,
        ),
        revealedConnections,
      );
      const start = getDirectionStubStart(
        this.corridorLayout.getStationMarkerGroups(stationId),
        connection.line,
        linePoint,
      );

      return [
        {
          connection,
          direction,
          stationId,
          key: `${unit.x},${unit.y}|${start.x},${start.y}`,
          start,
          linePoint,
          routePoints,
          unit,
          normal: { x: -unit.y, y: unit.x },
        },
      ];
    });
  }

  private renderDirectionStubs(
    layer: SVGGElement,
    stubs: ReturnType<MapRenderer["getDirectionStubs"]>,
    interchange: boolean,
    revealedConnections: ReadonlySet<string>,
    visibleConnections: readonly Connection[],
    interactive: boolean,
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
      group.map((stub, index) => {
        const revealedLineOffset = getRevealedDirectionStubOffset(
          stub,
          visibleConnections,
          this.corridorLayout,
        );
        return {
          stub,
          offset: revealedLineOffset ??
            getCenteredOffset(index, group.length, PARALLEL_STUB_SPACING),
        };
      })
    );
    for (const { stub, offset } of renderItems) {
      const targetStationId = stub.connection.from === stub.stationId
        ? stub.connection.to
        : stub.connection.from;
      const targetStation = getStation(this.network, targetStationId);
      const control = renderDirectionStub(layer, {
        lineId: stub.connection.line,
        start: stub.start,
        unit: stub.unit,
        normal: stub.normal,
        routePoints: stub.routePoints,
        hitRoutePoints: stub.routePoints,
        offset,
        length: getDirectionStubRenderLength(interchange),
        hitStartInset: getDirectionStubHitStartInset(interchange),
        hideShaft: shouldHideWalkStubShaft(stub.connection, revealedConnections),
        interaction: interactive
          ? {
              direction: stub.direction,
              label: `Travel ${stub.direction} to ${targetStation.name} on the ${LINE_BY_ID[stub.connection.line].name} line`,
            }
          : undefined,
      });
      control.dataset.connectionId = stub.connection.id;
      control.dataset.targetStationId = targetStation.id;
      control.dataset.stubDirection = stub.direction;
    }
  }

}

export type MapBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type MapPadding = number | { x: number; y: number };

export function getZoomAnchoredCameraCenter(
  cameraCenter: Point,
  previousViewBoxSize: { width: number; height: number },
  nextViewBoxSize: { width: number; height: number },
  anchorRatio: Point,
): Point {
  return {
    x: cameraCenter.x + anchorRatio.x * (previousViewBoxSize.width - nextViewBoxSize.width),
    y: cameraCenter.y + anchorRatio.y * (previousViewBoxSize.height - nextViewBoxSize.height),
  };
}

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

export function getExploredDirectionStubRoutePoints(
  connectionId: string,
  routePoints: Point[],
  revealedConnections: ReadonlySet<string>,
): Point[] | undefined {
  return revealedConnections.has(connectionId) ? routePoints : undefined;
}

export function compareDirectionStubsByRenderedOffset(
  first: DirectionStubLike,
  second: DirectionStubLike,
  group: readonly DirectionStubLike[],
  corridorLayout: CorridorLayout,
): number {
  return getDirectionStubRenderedOffsetProjection(first, group, corridorLayout) -
    getDirectionStubRenderedOffsetProjection(second, group, corridorLayout);
}

export function getRevealedDirectionStubOffset(
  stub: DirectionStubLike,
  visibleConnections: readonly Connection[],
  corridorLayout: CorridorLayout,
): number | null {
  if (!visibleConnections.some((connection) => connection.id === stub.connection.id)) {
    return null;
  }

  const visibleConnectionIds = new Set(visibleConnections.map((connection) => connection.id));
  const cameraPoints = corridorLayout.getConnectionCameraPoints(stub.connection);
  const connectionRenderPoints = corridorLayout.getConnectionRenderPoints(
    stub.connection,
    visibleConnectionIds,
  );
  const directRenderOffset = dotPoints(
    getEndpointDelta(cameraPoints, connectionRenderPoints, stub.linePoint),
    stub.normal,
  );
  const sharedCameraPathGroup = groupConnectionsByRenderedPath(
    visibleConnections.map((connection) => ({
      connection,
      points: corridorLayout.getConnectionCameraPoints(connection),
    })),
  ).find((group) =>
    group.some((item) => item.connection.id === stub.connection.id)
  );
  const hasSharedCameraPath = sharedCameraPathGroup?.some(
    (item) => item.connection.line !== stub.connection.line,
  ) ?? false;
  if (!hasSharedCameraPath && Math.abs(directRenderOffset) <= 0.01) {
    return null;
  }

  const renderedPathGroups = groupConnectionsByRenderedPath(
    visibleConnections.map((connection) => ({
      connection,
      points: corridorLayout.getConnectionRenderPoints(connection, visibleConnectionIds),
    })),
  );
  const sharedPathGroup = renderedPathGroups.find((group) =>
    group.some((item) => item.connection.id === stub.connection.id)
  );
  if (!sharedPathGroup) return null;

  const itemIndex = sharedPathGroup.findIndex(
    (item) => item.connection.id === stub.connection.id,
  );
  const item = sharedPathGroup[itemIndex];
  if (!item) return null;

  const renderedLinePoints = offsetPolylinePoints(
    getCanonicalPath(item.points),
    getCenteredOffset(itemIndex, sharedPathGroup.length, PARALLEL_LINE_SPACING),
  );
  const endpointDelta = getEndpointDelta(
    cameraPoints,
    renderedLinePoints,
    stub.linePoint,
  );
  return dotPoints(endpointDelta, stub.normal);
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
  const cameraPoint = isCloserToPoint(cameraPoints[0], linePoint, cameraPoints.at(-1)!)
    ? cameraPoints[0]
    : cameraPoints.at(-1)!;
  const renderedPoint = isCloserToPoint(renderedPoints[0], linePoint, renderedPoints.at(-1)!)
    ? renderedPoints[0]
    : renderedPoints.at(-1)!;
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

export function getAvailableDirectionConnections(
  network: NetworkData,
  stationId: string,
  selectedLineId: LineId,
): Connection[] {
  return network.connections.filter(
    (connection) =>
      connection.line === selectedLineId &&
      (connection.from === stationId || (!connection.oneWay && connection.to === stationId)) &&
      getConnectionFirstStepDirection(connection, stationId) !== null,
  );
}

export function getDirectionStubRenderLength(interchange: boolean): number {
  return interchange ? INTERCHANGE_DIRECTION_STUB_LENGTH : NON_INTERCHANGE_DIRECTION_STUB_LENGTH;
}

export function getDirectionStubHitStartInset(interchange: boolean): number {
  return interchange ? CONJOINED_HIGHLIGHT_RADIUS : STATION_BAR_WIDTH / 2;
}

export function getDirectionStubStart(
  markerGroups: readonly StationMarkerGroup[],
  lineId: LineId,
  linePoint: Point,
): Point {
  return markerGroups.find((group) => group.lines.includes(lineId))?.point ?? linePoint;
}

export function shouldHideWalkStubShaft(
  connection: Connection,
  revealedConnections: ReadonlySet<string>,
): boolean {
  return connection.line === "walk" && revealedConnections.has(connection.id);
}

export function getDirectionStubRoutePoints(points: Point[], linePoint: Point): Point[] {
  if (points.length < 2) return points;
  return isCloserToPoint(points[0], linePoint, points.at(-1)!) ? points : [...points].reverse();
}

function snapUnitComponent(value: number): number {
  if (Math.abs(value) < 0.000_001) return 0;
  if (Math.abs(Math.abs(value) - 1) < 0.000_001) return Math.sign(value);
  if (Math.abs(Math.abs(value) - Math.SQRT1_2) < 0.000_001) {
    return Math.sign(value) * Math.SQRT1_2;
  }
  return value;
}
