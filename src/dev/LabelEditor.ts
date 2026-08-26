import { LINE_BY_ID, compareLineIds } from "../data/lines";
import type { LineId, NetworkData, Point, Station } from "../data/types";
import { GRID_CELL_SIZE, gridPointToSvgPoint } from "../rendering/grid";
import { STUB_STROKE_WIDTH } from "../rendering/lineStyles";
import { renderRevealedLine } from "../rendering/lineRenderer";
import {
  getDirectionStubStart,
  getDirectionStubUnit,
  groupConnectionsByRenderedPath,
} from "../rendering/mapRenderer";
import { CorridorLayout } from "../rendering/corridorLayout";
import {
  appendStationLabelText,
  getStationLabelPlacement,
  renderStationMarker,
} from "../rendering/stationRenderer";
import { renderRiverThames } from "../rendering/riverRenderer";
import {
  getCenteredOffset,
  PARALLEL_LINE_SPACING,
} from "../rendering/pathOffset";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_PADDING = GRID_CELL_SIZE * 4;
const STUB_LENGTH = 40;
const INITIAL_VIEWBOX_WIDTH = 1_700;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 80;
const ZOOM_STEP = 1.8;
const LABEL_VISUAL_CENTER_FALLBACK_OFFSET = { x: 0, y: 5 };
const STORAGE_KEY = "tube-speedrun.label-editor.offsets";
const LABEL_OBSTACLE_SELECTOR = [
  ".map-line",
  ".label-editor-direction-stub",
  ".interchange-marker",
  ".station-bar-marker",
  ".conjoined-station-link",
  ".river-thames-outline",
  ".river-thames-fill",
].join(",");

type ViewBox = { x: number; y: number; width: number; height: number };

type DragState = {
  stationId: string;
  pointerId: number;
  startPoint: Point;
  startOffset: Point;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (contents: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export class LabelEditor {
  private readonly network: NetworkData;
  private readonly layout: CorridorLayout;
  private readonly allConnectionIds: Set<string>;
  private readonly offsets = new Map<string, Point>();
  private readonly svg: SVGSVGElement;
  private readonly output: HTMLTextAreaElement;
  private readonly selectedValue: HTMLSpanElement;
  private readonly offsetValue: HTMLSpanElement;
  private readonly snapInput: HTMLInputElement;
  private readonly cellHorizontalCenterSnapInput: HTMLInputElement;
  private readonly cellVerticalCenterSnapInput: HTMLInputElement;
  private readonly showStubsInput: HTMLInputElement;
  private readonly showCollisionsInput: HTMLInputElement;
  private readonly stepSelect: HTMLSelectElement;
  private readonly baseViewBox: ViewBox;
  private readonly resizeObserver: ResizeObserver;
  private collisionFrame: number | null = null;

  private viewBox: ViewBox;
  private selectedStationId: string | null = null;
  private dragState: DragState | null = null;
  private panState: { pointerId: number; point: Point; viewBox: ViewBox } | null = null;
  private zoom = 1;

  constructor(root: HTMLElement, network: NetworkData) {
    this.network = network;
    this.layout = new CorridorLayout(network);
    this.allConnectionIds = new Set(network.connections.map((connection) => connection.id));
    this.baseViewBox = getNetworkViewBox(network);
    this.viewBox = { ...this.baseViewBox };
    this.zoom = this.baseViewBox.width / this.viewBox.width;

    for (const station of network.stations) {
      this.offsets.set(station.id, { ...station.labelOffset });
    }
    this.loadDraft();

    root.replaceChildren();
    root.className = "app-shell label-editor-shell";

    const toolbar = document.createElement("div");
    toolbar.className = "label-editor-toolbar";

    this.selectedValue = document.createElement("span");
    this.offsetValue = document.createElement("span");
    this.snapInput = checkboxInput(true);
    this.cellHorizontalCenterSnapInput = checkboxInput(false);
    this.cellVerticalCenterSnapInput = checkboxInput(false);
    this.showStubsInput = checkboxInput(true);
    this.showCollisionsInput = checkboxInput(true);
    this.stepSelect = document.createElement("select");
    for (const [label, value] of [
      ["0.25 cell", "8"],
      ["0.5 cell", "16"],
      ["1 cell", "32"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.stepSelect.append(option);
    }

    toolbar.append(
      toolbarGroup("Selected", this.selectedValue),
      toolbarGroup("Offset", this.offsetValue),
      labeledControl("Snap", this.snapInput),
      labeledControl("Cell H-center", this.cellHorizontalCenterSnapInput),
      labeledControl("Cell V-center", this.cellVerticalCenterSnapInput),
      labeledControl("Step", this.stepSelect),
      labeledControl("Stubs", this.showStubsInput),
      labeledControl("Collisions", this.showCollisionsInput),
      button("Zoom +", () => this.zoomAtCenter(ZOOM_STEP)),
      button("Zoom -", () => this.zoomAtCenter(1 / ZOOM_STEP)),
      button("Full map", () => this.resetView()),
      button("Save draft", () => this.saveDraft()),
      button("Reset draft", () => this.resetDraft()),
      button("Copy TS", () => void this.copyExport()),
      button("Save TS", () => void this.saveExport()),
    );

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "tube-map label-editor-map");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Developer station label editor");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    this.output = document.createElement("textarea");
    this.output.className = "label-editor-output";
    this.output.spellcheck = false;
    this.output.readOnly = true;

    root.append(toolbar, this.svg, this.output);
    this.viewBox = getInitialViewBox(network, this.baseViewBox, this.getSvgAspect());
    this.zoom = this.baseViewBox.width / this.viewBox.width;
    this.output.value = this.createExportSource();
    this.resizeObserver = new ResizeObserver(() => {
      this.matchViewBoxToSvgAspect();
      this.render();
    });
    this.resizeObserver.observe(this.svg);

    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    for (const input of [
      this.snapInput,
      this.cellHorizontalCenterSnapInput,
      this.cellVerticalCenterSnapInput,
      this.showStubsInput,
      this.showCollisionsInput,
      this.stepSelect,
    ]) {
      input.addEventListener("change", () => this.render());
    }

    this.svg.addEventListener("pointerdown", (event) => {
      const label = (event.target as Element | null)?.closest<SVGTextElement>(".label-editor-label");
      if (label?.dataset.stationId) {
        this.selectStation(label.dataset.stationId);
        this.dragState = {
          stationId: label.dataset.stationId,
          pointerId: event.pointerId,
          startPoint: this.clientPointToSvgPoint(event.clientX, event.clientY),
          startOffset: this.getOffset(label.dataset.stationId),
        };
        this.svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      this.panState = {
        pointerId: event.pointerId,
        point: { x: event.clientX, y: event.clientY },
        viewBox: { ...this.viewBox },
      };
      this.svg.setPointerCapture(event.pointerId);
    });

    this.svg.addEventListener("pointermove", (event) => {
      if (this.dragState?.pointerId === event.pointerId) {
        const point = this.clientPointToSvgPoint(event.clientX, event.clientY);
        const offset = {
          x: this.dragState.startOffset.x + point.x - this.dragState.startPoint.x,
          y: this.dragState.startOffset.y + point.y - this.dragState.startPoint.y,
        };
        this.setOffset(this.dragState.stationId, this.snapOffset(this.dragState.stationId, offset));
        this.render();
        event.preventDefault();
        return;
      }

      if (this.panState?.pointerId === event.pointerId) {
        const scaleX = this.viewBox.width / Math.max(1, this.svg.clientWidth);
        const scaleY = this.viewBox.height / Math.max(1, this.svg.clientHeight);
        this.viewBox = {
          ...this.panState.viewBox,
          x: this.panState.viewBox.x - (event.clientX - this.panState.point.x) * scaleX,
          y: this.panState.viewBox.y - (event.clientY - this.panState.point.y) * scaleY,
        };
        this.render();
      }
    });

    this.svg.addEventListener("pointerup", (event) => this.endPointer(event));
    this.svg.addEventListener("pointercancel", (event) => this.endPointer(event));

    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = Math.exp(Math.max(-140, Math.min(140, event.deltaY)) * 0.0018);
      this.zoomAtPoint(this.clientPointToSvgPoint(event.clientX, event.clientY), 1 / factor);
    }, { passive: false });

    document.addEventListener("keydown", (event) => {
      if (!this.selectedStationId || isTextInput(event.target)) return;
      const direction = getNudgeDirection(event.key);
      if (!direction) return;

      const multiplier = event.shiftKey ? 4 : event.altKey ? 0.25 : 1;
      const nudgeStep = {
        x: this.cellHorizontalCenterSnapInput.checked ? GRID_CELL_SIZE : this.snapStep,
        y: this.cellVerticalCenterSnapInput.checked ? GRID_CELL_SIZE : this.snapStep,
      };
      const offset = this.getOffset(this.selectedStationId);
      this.setOffset(this.selectedStationId, this.snapOffset(this.selectedStationId, {
        x: offset.x + direction.x * nudgeStep.x * multiplier,
        y: offset.y + direction.y * nudgeStep.y * multiplier,
      }));
      this.render();
      event.preventDefault();
    });
  }

  private render(): void {
    this.matchViewBoxToSvgAspect();
    this.svg.replaceChildren();
    this.applyViewBox();
    this.renderGrid();
    renderRiverThames(this.svg, this.viewBox);
    this.renderLines();
    if (this.showStubsInput.checked) this.renderDirectionStubs();
    this.renderStations();
    this.renderLabels();
    this.updateSelectedStatus();
    this.output.value = this.createExportSource();
    if (this.collisionFrame !== null) {
      window.cancelAnimationFrame(this.collisionFrame);
      this.collisionFrame = null;
    }
    if (this.showCollisionsInput.checked) {
      this.collisionFrame = window.requestAnimationFrame(() => {
        this.collisionFrame = null;
        this.markCollisions();
      });
    }
  }

  private applyViewBox(): void {
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
  }

  private renderGrid(): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "grid-layer label-editor-grid");
    const minX = Math.floor(this.viewBox.x / GRID_CELL_SIZE) * GRID_CELL_SIZE - GRID_CELL_SIZE;
    const maxX = this.viewBox.x + this.viewBox.width + GRID_CELL_SIZE;
    const minY = Math.floor(this.viewBox.y / GRID_CELL_SIZE) * GRID_CELL_SIZE - GRID_CELL_SIZE;
    const maxY = this.viewBox.y + this.viewBox.height + GRID_CELL_SIZE;

    for (let x = minX; x <= maxX; x += GRID_CELL_SIZE / 4) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(minY));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(maxY));
      line.setAttribute("class", getEditorGridLineClass(x));
      layer.append(line);
    }
    for (let y = minY; y <= maxY; y += GRID_CELL_SIZE / 4) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(minX));
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(maxX));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", getEditorGridLineClass(y));
      layer.append(line);
    }
    this.svg.append(layer);
  }

  private renderLines(): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "revealed-lines");
    this.svg.append(layer);

    const renderedPaths = this.network.connections.map((connection) => ({
      connection,
      points: this.layout.getConnectionRenderPoints(connection, this.allConnectionIds),
    }));

    for (const group of groupConnectionsByRenderedPath(renderedPaths)) {
      group.forEach(({ connection, points }, index) => {
        renderRevealedLine(
          layer,
          connection,
          this.network,
          getCenteredOffset(index, group.length, PARALLEL_LINE_SPACING),
          points,
        );
      });
    }
  }

  private renderDirectionStubs(): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "label-editor-direction-stubs");
    this.svg.append(layer);

    const rendered = new Set<string>();
    for (const connection of this.network.connections) {
      for (const stationId of [connection.from, connection.to]) {
        const unit = getDirectionStubUnit(connection, stationId);
        if (!unit) continue;
        const linePoint = this.layout.getStationLinePoint(stationId, connection.line);
        const markerGroups = this.layout.getStationMarkerGroups(stationId);
        const start = getDirectionStubStart(markerGroups, connection.line, linePoint);
        const key = `${stationId}:${connection.line}:${unit.x}:${unit.y}:${start.x}:${start.y}`;
        if (rendered.has(key)) continue;
        rendered.add(key);
        const end = {
          x: start.x + unit.x * STUB_LENGTH,
          y: start.y + unit.y * STUB_LENGTH,
        };
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(start.x));
        line.setAttribute("y1", String(start.y));
        line.setAttribute("x2", String(end.x));
        line.setAttribute("y2", String(end.y));
        line.setAttribute("stroke", LINE_BY_ID[connection.line].color);
        line.setAttribute("stroke-width", String(STUB_STROKE_WIDTH));
        line.setAttribute("class", "label-editor-direction-stub");
        if (connection.line === "walk") line.setAttribute("stroke-dasharray", "8 6");
        layer.append(line);
      }
    }
  }

  private renderStations(): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "stations");
    this.svg.append(layer);
    for (const station of this.network.stations) {
      renderStationMarker(
        layer,
        station,
        this.network,
        getPrimaryLine(station),
        false,
        this.layout.getStationMarkerGroups(station.id),
      );
    }
  }

  private renderLabels(): void {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "label-editor-labels");
    this.svg.append(layer);

    for (const station of this.network.stations) {
      const stationPoint = gridPointToSvgPoint(station);
      const offset = this.getOffset(station.id);
      const placement = getStationLabelPlacement({ ...station, labelOffset: offset });
      const label = document.createElementNS(SVG_NS, "text");
      label.dataset.stationId = station.id;
      label.setAttribute("x", String(stationPoint.x + offset.x));
      label.setAttribute("y", String(stationPoint.y + offset.y));
      label.setAttribute("text-anchor", placement.textAnchor);
      label.setAttribute("font-size", "18");
      label.setAttribute("stroke-width", "4");
      label.setAttribute("class", station.id === this.selectedStationId
        ? "label-editor-label label-editor-label-selected"
        : "label-editor-label");
      appendStationLabelText(label, { ...station, labelOffset: offset }, {
        x: stationPoint.x + offset.x,
        y: stationPoint.y + offset.y,
        textAnchor: placement.textAnchor,
      });
      layer.append(label);
    }

    const collisionLayer = document.createElementNS(SVG_NS, "g");
    collisionLayer.setAttribute("class", "label-editor-collisions");
    this.svg.append(collisionLayer);
  }

  private markCollisions(): void {
    const labels = [...this.svg.querySelectorAll<SVGTextElement>(".label-editor-label")];
    const collisionLayer = this.svg.querySelector<SVGGElement>(".label-editor-collisions");
    if (!collisionLayer) return;
    collisionLayer.replaceChildren();

    const collided = new Set<SVGTextElement>();
    for (let first = 0; first < labels.length - 1; first += 1) {
      const firstRect = labels[first].getBoundingClientRect();
      if (firstRect.width === 0 || firstRect.height === 0) continue;
      for (let second = first + 1; second < labels.length; second += 1) {
        const secondRect = labels[second].getBoundingClientRect();
        if (rectsOverlap(firstRect, secondRect)) {
          collided.add(labels[first]);
          collided.add(labels[second]);
        }
      }
    }

    for (const label of labels) {
      if (labelIntersectsObstacle(label)) collided.add(label);
      label.classList.toggle("label-editor-label-collision", collided.has(label));
      if (collided.has(label)) collisionLayer.append(createCollisionRect(label.getBBox()));
    }
  }

  private selectStation(stationId: string): void {
    this.selectedStationId = stationId;
    this.updateSelectedStatus();
  }

  private updateSelectedStatus(): void {
    const station = this.selectedStationId
      ? this.network.stations.find((candidate) => candidate.id === this.selectedStationId)
      : null;
    this.selectedValue.textContent = station ? station.name : "None";
    this.offsetValue.textContent = station ? formatOffset(this.getOffset(station.id)) : "0, 0";
  }

  private getOffset(stationId: string): Point {
    return this.offsets.get(stationId) ?? { x: 28, y: -24 };
  }

  private setOffset(stationId: string, offset: Point): void {
    this.offsets.set(stationId, {
      x: roundOffset(offset.x),
      y: roundOffset(offset.y),
    });
  }

  private get snapStep(): number {
    return Number(this.stepSelect.value);
  }

  private snapOffset(stationId: string, offset: Point): Point {
    if (!this.snapInput.checked) return offset;
    if (this.cellHorizontalCenterSnapInput.checked || this.cellVerticalCenterSnapInput.checked) {
      const centerAdjustment = this.getLabelVisualCenterAdjustment(stationId);
      return {
        x: this.cellHorizontalCenterSnapInput.checked
          ? snapValue(offset.x + centerAdjustment.x, GRID_CELL_SIZE) - centerAdjustment.x
          : snapValue(offset.x, this.snapStep),
        y: this.cellVerticalCenterSnapInput.checked
          ? snapValue(offset.y + centerAdjustment.y, GRID_CELL_SIZE) - centerAdjustment.y
          : snapValue(offset.y, this.snapStep),
      };
    }
    return snapPoint(offset, this.snapStep);
  }

  private getLabelVisualCenterAdjustment(stationId: string): Point {
    const label = this.svg.querySelector<SVGTextElement>(`.label-editor-label[data-station-id="${cssEscape(stationId)}"]`);
    if (!label) return LABEL_VISUAL_CENTER_FALLBACK_OFFSET;
    const box = label.getBBox();
    const x = Number(label.getAttribute("x"));
    const y = Number(label.getAttribute("y"));
    if (!Number.isFinite(x) || !Number.isFinite(y) || box.width === 0 || box.height === 0) {
      return LABEL_VISUAL_CENTER_FALLBACK_OFFSET;
    }
    return {
      x: box.x + box.width / 2 - x,
      y: box.y + box.height / 2 - y,
    };
  }

  private zoomAtCenter(factor: number): void {
    this.zoomAtPoint({
      x: this.viewBox.x + this.viewBox.width / 2,
      y: this.viewBox.y + this.viewBox.height / 2,
    }, factor);
  }

  private zoomAtPoint(point: Point, factor: number): void {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const width = this.baseViewBox.width / nextZoom;
    const height = width / this.getSvgAspect();
    const relativeX = (point.x - this.viewBox.x) / this.viewBox.width;
    const relativeY = (point.y - this.viewBox.y) / this.viewBox.height;
    this.zoom = nextZoom;
    this.viewBox = {
      x: point.x - width * relativeX,
      y: point.y - height * relativeY,
      width,
      height,
    };
    this.render();
  }

  private resetView(): void {
    this.zoom = 1;
    this.viewBox = fitViewBoxToAspect(this.baseViewBox, this.getSvgAspect());
    this.render();
  }

  private matchViewBoxToSvgAspect(): void {
    const aspect = this.getSvgAspect();
    const height = this.viewBox.width / aspect;
    if (Math.abs(height - this.viewBox.height) < 0.01) return;
    this.viewBox = {
      x: this.viewBox.x,
      y: this.viewBox.y + (this.viewBox.height - height) / 2,
      width: this.viewBox.width,
      height,
    };
  }

  private getSvgAspect(): number {
    return Math.max(0.1, this.svg.clientWidth / Math.max(1, this.svg.clientHeight));
  }

  private clientPointToSvgPoint(clientX: number, clientY: number): Point {
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return { x: clientX, y: clientY };
    const svgPoint = point.matrixTransform(matrix.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  }

  private endPointer(event: PointerEvent): void {
    if (this.dragState?.pointerId === event.pointerId) {
      this.dragState = null;
    }
    if (this.panState?.pointerId === event.pointerId) {
      this.panState = null;
    }
    if (this.svg.hasPointerCapture(event.pointerId)) {
      this.svg.releasePointerCapture(event.pointerId);
    }
  }

  private saveDraft(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.createOffsetRecord()));
  }

  private resetDraft(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.offsets.clear();
    for (const station of this.network.stations) {
      this.offsets.set(station.id, { ...station.labelOffset });
    }
    this.selectedStationId = null;
    this.render();
  }

  private loadDraft(): void {
    const source = localStorage.getItem(STORAGE_KEY);
    if (!source) return;
    try {
      const values = JSON.parse(source) as Record<string, Point>;
      for (const station of this.network.stations) {
        const offset = values[station.id];
        if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
          this.offsets.set(station.id, offset);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private async copyExport(): Promise<void> {
    const source = this.createExportSource();
    this.output.value = source;
    await navigator.clipboard?.writeText(source);
  }

  private async saveExport(): Promise<void> {
    const source = this.createExportSource();
    this.output.value = source;
    const pickerWindow = window as SaveFilePickerWindow;
    if (pickerWindow.showSaveFilePicker) {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: "labelOffsets.generated.ts",
        types: [{
          description: "TypeScript",
          accept: { "text/typescript": [".ts"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(source);
      await writable.close();
      return;
    }

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([source], { type: "text/typescript" }));
    link.download = "labelOffsets.generated.ts";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private createExportSource(): string {
    const entries = this.network.stations
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((station) => {
        const offset = this.getOffset(station.id);
        return `  ${JSON.stringify(station.id)}: { x: ${roundOffset(offset.x)}, y: ${roundOffset(offset.y)} },`;
      })
      .join("\n");
    return [
      "// Generated by the developer label editor.",
      "",
      'import type { Point } from "./types";',
      "",
      "export const stationLabelOffsets = {",
      entries,
      "} satisfies Record<string, Point>;",
      "",
    ].join("\n");
  }

  private createOffsetRecord(): Record<string, Point> {
    return Object.fromEntries(
      this.network.stations.map((station) => [station.id, this.getOffset(station.id)]),
    );
  }
}

function getNetworkViewBox(network: NetworkData): ViewBox {
  const points = [
    ...network.stations.map(gridPointToSvgPoint),
    ...network.connections.flatMap((connection) => connection.path.map(gridPointToSvgPoint)),
  ];
  const minX = Math.min(...points.map((point) => point.x)) - MAP_PADDING;
  const maxX = Math.max(...points.map((point) => point.x)) + MAP_PADDING;
  const minY = Math.min(...points.map((point) => point.y)) - MAP_PADDING;
  const maxY = Math.max(...points.map((point) => point.y)) + MAP_PADDING;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getInitialViewBox(network: NetworkData, baseViewBox: ViewBox, aspect: number): ViewBox {
  const anchorStation =
    network.stations.find((station) => station.id === "king-s-cross-st-pancras") ??
    network.stations.find((station) => station.id === "tottenham-court-road") ??
    network.stations[0];
  if (!anchorStation) return { ...baseViewBox };

  const anchor = gridPointToSvgPoint(anchorStation);
  const width = Math.min(INITIAL_VIEWBOX_WIDTH, baseViewBox.width);
  const height = width / aspect;
  return {
    x: anchor.x - width / 2,
    y: anchor.y - height / 2,
    width,
    height,
  };
}

function fitViewBoxToAspect(viewBox: ViewBox, aspect: number): ViewBox {
  const sourceAspect = viewBox.width / viewBox.height;
  const width = sourceAspect >= aspect ? viewBox.width : viewBox.height * aspect;
  const height = sourceAspect >= aspect ? viewBox.width / aspect : viewBox.height;
  return {
    x: viewBox.x + (viewBox.width - width) / 2,
    y: viewBox.y + (viewBox.height - height) / 2,
    width,
    height,
  };
}

function getEditorGridLineClass(value: number): string {
  const gridUnits = Math.round(value / (GRID_CELL_SIZE / 4));
  if (gridUnits % 4 === 0) return "grid-line grid-line-major";
  if (gridUnits % 2 === 0) return "grid-line label-editor-grid-half";
  return "grid-line label-editor-grid-quarter";
}

function getPrimaryLine(station: Station): LineId {
  return [...station.lines].sort(compareLineIds).find((line) => line !== "walk") ?? station.lines[0] ?? "walk";
}

function checkboxInput(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}

function labeledControl(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "label-editor-control";
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}

function toolbarGroup(label: string, value: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "label-editor-status";
  const labelElement = document.createElement("span");
  labelElement.className = "label-editor-status-label";
  labelElement.textContent = label;
  wrapper.append(labelElement, value);
  return wrapper;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function snapPoint(point: Point, step: number): Point {
  return {
    x: snapValue(point.x, step),
    y: snapValue(point.y, step),
  };
}

function snapValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function roundOffset(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatOffset(offset: Point): string {
  return `${roundOffset(offset.x)}, ${roundOffset(offset.y)}`;
}

function getNudgeDirection(key: string): Point | null {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function rectsOverlap(first: DOMRect, second: DOMRect): boolean {
  return first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top;
}

function labelIntersectsObstacle(label: SVGTextElement): boolean {
  const rect = label.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  for (let row = 0; row < 3; row += 1) {
    const y = rect.top + (rect.height * row) / 2;
    for (let column = 0; column < 7; column += 1) {
      const x = rect.left + (rect.width * column) / 6;
      for (const element of document.elementsFromPoint(x, y)) {
        if (element === label || element.closest(".label-editor-labels")) continue;
        if (element.matches(LABEL_OBSTACLE_SELECTOR)) return true;
      }
    }
  }
  return false;
}

function createCollisionRect(box: DOMRect | SVGRect): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(box.x));
  rect.setAttribute("y", String(box.y));
  rect.setAttribute("width", String(box.width));
  rect.setAttribute("height", String(box.height));
  rect.setAttribute("class", "label-editor-collision-box");
  return rect;
}
