import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from '@vercel/speed-insights';
import "./style.css";
import { createConnectionId, networkData } from "./data/network";
import { validateNetworkData } from "./data/validation";
import type { GameState } from "./game/GameState";
import type { CountdownPhase } from "./game/AppPhase";
import { AppController } from "./game/AppController";
import {
  advanceCompletionCelebration,
  createCompletionCelebration,
  type CompletionCelebration,
} from "./game/completionCelebration";
import { generateSeed } from "./game/seed";
import { type RunState } from "./game/RunState";
import {
  COUNTDOWN_START_VALUE,
  COUNTDOWN_STEP_MS,
  getLinearAnimationProgress,
  LINE_REVEAL_ANIMATION_DURATION_MS,
  LINE_SWITCH_CAMERA_PAN_DURATION_MS,
  REJECTED_MOVE_FLASH_MS,
  TOUCH_MOVE_STUB_FEEDBACK_MS,
} from "./game/timings";
import {
  attemptTutorialMoveInDirection,
  getTutorialInstructions,
  TUTORIAL_CONNECTION_IDS,
} from "./game/tutorial";
import { cycleSelectedLine, getLineCyclePreview } from "./game/lineSelection";
import {
  attemptMoveInDirection,
  findDirectionalNeighbour,
  MOVEMENT_DIRECTIONS,
  type MovementDirection,
} from "./game/movement";
import { bindKeyboardControls } from "./input/keyboard";
import { bindMapPanZoom, type MapPanZoomBinding } from "./input/mapPanZoomController";
import { getPinchGesture, type PinchGesture } from "./input/pinchZoom";
import {
  getStubPathHitDistance,
  getSvgPoint,
  isPointInPolygon,
} from "./input/stubHitTesting";
import {
  beginStubSelection,
  createStubSelectionState,
  dragStubSelection,
  releaseStubSelection,
} from "./input/stubSelection";
import {
  beginTouchGameplayGesture,
  cancelTouchGameplayGesture,
  getTouchGameplayAction,
  updateTouchGameplayGesture,
  type TouchGameplayGesture,
} from "./input/touchGameplayGesture";
import { MapRenderer } from "./rendering/mapRenderer";
import { GRID_CELL_SIZE } from "./rendering/grid";
import { STATION_WIPE_COMPONENT_RADIUS } from "./rendering/stationRenderer";
import { Hud } from "./ui/hud";
import type { Point } from "./data/types";

inject();
injectSpeedInsights();

// Start when the line head reaches the largest current-station marker radius on the shortest grid move,
// then finish the wipe exactly as the line reveal reaches the station centre.
const STATION_WIPE_START_LINE_PROGRESS = Math.max(
  0,
  1 - STATION_WIPE_COMPONENT_RADIUS / GRID_CELL_SIZE,
);
const STATION_WIPE_ANIMATION_SPEED =
  1 / ((1 - STATION_WIPE_START_LINE_PROGRESS) * LINE_REVEAL_ANIMATION_DURATION_MS);

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root.");
}
const appRoot = root;

const validationErrors = validateNetworkData(networkData);
if (validationErrors.length > 0) {
  throw new Error(`Invalid network data:\n${validationErrors.join("\n")}`);
}

void boot();

async function boot(): Promise<void> {
  if (window.location.pathname.split("/").filter(Boolean).at(-1) === "label-editor") {
    if (!isDevMode()) {
      appRoot.replaceChildren("Label editor is only available in development.");
      return;
    }
    const { LabelEditor } = await import("./dev/LabelEditor");
    new LabelEditor(appRoot, networkData);
    return;
  }

  startGame();
}

function startGame(): void {
const app = new AppController(networkData);
let completionCelebration: CompletionCelebration | null = null;
let moveSelection = createStubSelectionState();
let selectedMoveStub: SVGGElement | null = null;
let hoveredMoveStub: SVGGElement | null = null;
let lastMousePoint: Point | null = null;
let panPointerId: number | null = null;
let lastPanPoint: Point | null = null;
const mapTouchPoints = new Map<number, Point>();
let mapPinchGesture: PinchGesture | null = null;
let touchGameplayGesture: TouchGameplayGesture | null = null;
let rejectedMoveTimeoutId: number | null = null;
let touchMoveStubFeedback: {
  stub: SVGGElement;
  direction: MovementDirection;
  stationId: string;
  lineId: GameState["selectedLineId"];
  timeoutId: number;
} | null = null;
let lineRevealAnimation: {
  connectionId: string;
  fromStationId: string;
  hiddenCurrentStationId: string | null;
  revealLine: boolean;
  direction: MovementDirection;
  stationWipeStarted: boolean;
  startedAt: number;
} | null = null;
let stationWipeAnimation: {
  stationId: string;
  direction: MovementDirection;
  startedAt: number;
} | null = null;
let cameraPanAnimation: {
  from: Point;
  to: Point;
  startedAt: number;
} | null = null;
let gameplayMapRenderer: MapRenderer | null = null;
let gameplayMapPanZoom: MapPanZoomBinding | null = null;
const touchGameplayControlsQuery = window.matchMedia("(hover: none) and (pointer: coarse)");

const hud = new Hud(appRoot, networkData, {
  onStartRandomSeed: () => startRun(generateSeed(), "random"),
  onStartSeed: (seed) => startRun(seed, "set"),
  onStartTutorial: () => startTutorial(),
  onOpenMap: () => {
    app.showMap();
    resetRunTransientState();
    renderer.resetExplorerView();
    hud.showMapViewer();
    render();
  },
  onFocusMapStation: (stationId) => {
    if (app.phase.kind !== "map") {
      return;
    }
    renderer.focusExplorerStation(stationId);
    render();
  },
  onReturnToMenu: () => {
    app.showMenu();
    resetRunTransientState();
    hud.showMenu();
    render();
  },
  onPlayAgain: () => {
    app.showMenu();
    resetRunTransientState();
    hud.showSeedChoiceMenu();
    render();
  },
  onAdvanceRound: () => advanceFromCompletedRound(),
  onZoomIn: () => {
    if (!canPanAndZoom()) {
      return;
    }
    renderer.zoomIn();
    render();
  },
  onZoomOut: () => {
    if (!canPanAndZoom()) {
      return;
    }
    renderer.zoomOut();
    render();
  },
  onOpenGameplayMap: () => {
    const map = getGameplayMapRenderer();
    gameplayMapPanZoom?.reset();
    map.resetExplorerView();
    map.renderExplorer();
  },
  onFocusGameplayMapStation: (stationId) => {
    const map = getGameplayMapRenderer();
    map.focusExplorerStation(stationId);
    map.renderExplorer();
  },
  onGameplayMapZoomIn: () => {
    const map = getGameplayMapRenderer();
    map.zoomIn();
    map.renderExplorer();
  },
  onGameplayMapZoomOut: () => {
    const map = getGameplayMapRenderer();
    map.zoomOut();
    map.renderExplorer();
  },
});

const renderer = new MapRenderer(hud.mapHost, networkData);
let resizeRenderFrame: number | null = null;
window.addEventListener("resize", () => {
  if (resizeRenderFrame !== null) {
    return;
  }
  resizeRenderFrame = window.requestAnimationFrame((now) => {
    resizeRenderFrame = null;
    render(now);
    if (hud.isGameplayMapOpen() && gameplayMapRenderer) {
      gameplayMapRenderer.renderExplorer();
    }
  });
});

function getGameplayMapRenderer(): MapRenderer {
  if (gameplayMapRenderer) return gameplayMapRenderer;
  gameplayMapRenderer = new MapRenderer(hud.gameplayMapHost, networkData);
  gameplayMapPanZoom = bindMapPanZoom(gameplayMapRenderer, () => gameplayMapRenderer?.renderExplorer());
  return gameplayMapRenderer;
}

function startRun(seed: string, seedSource: RunState["seedSource"]): void {
  app.startRun(seed, seedSource, performance.now());
  resetRunTransientState();
  render();
}

function startTutorial(): void {
  app.startTutorial(performance.now());
  resetRunTransientState();
  render();
}

function completeCountdown(now: number): void {
  if (!app.completeCountdown(now)) return;
  resetRunTransientState();
  render(now);
}

function advanceFromCompletedRound(): void {
  const gameplay = app.gameplay;
  if (!gameplay?.state.completed || !gameplay.run) {
    return;
  }

  const nextPhase = app.advanceCompletedRound(performance.now());
  if (nextPhase.kind === "results") {
    resetRunTransientState();
    render();
    return;
  }

  resetRunTransientState();
  render();
}

function resetRunTransientState(): void {
  cancelMovePointerSelection();
  resetTouchGameplayGesture();
  resetMapTouchGesture();
  lineRevealAnimation = null;
  stationWipeAnimation = null;
  cameraPanAnimation = null;
  completionCelebration = null;
  if (rejectedMoveTimeoutId !== null) {
    window.clearTimeout(rejectedMoveTimeoutId);
    rejectedMoveTimeoutId = null;
  }
  panPointerId = null;
  lastPanPoint = null;
  renderer.svg.classList.remove("tube-map-panning");
  renderer.resetZoom();
}

function render(now = performance.now()): void {
  const phase = app.phase;
  switch (phase.kind) {
    case "map":
      renderer.renderExplorer();
      break;
    case "results":
      renderer.renderMenuPreview(now);
      hud.showResults(phase.results);
      break;
    case "gameplay":
      renderer.render(
        phase.state,
        getActiveLineRevealAnimation(now),
        getActiveStationWipeAnimation(now),
        getActiveCameraPanAnimation(now),
        completionCelebration !== null,
        completionCelebration !== null && completionCelebration.startedAt !== null,
        !touchGameplayControlsQuery.matches,
        phase.tutorial ? TUTORIAL_CONNECTION_IDS : null,
      );
      refreshHoveredMoveStub();
      hud.update(
        phase.state,
        now,
        phase.run,
        completionCelebration === null,
        phase.tutorial
          ? getTutorialInstructions(phase.state, touchGameplayControlsQuery.matches)
          : null,
      );
      break;
    case "countdown":
      renderer.renderMenuPreview(now);
      hud.showCountdown(getCountdownValue(phase, now));
      break;
    case "menu":
      renderer.renderMenuPreview(now);
      hud.update(null, now);
      break;
  }
}

function tick(): void {
  const now = performance.now();
  const phase = app.phase;
  if (phase.kind === "map") {
    // The explorer is static until the player pans, zooms, searches, or resizes it.
  } else if (phase.kind === "countdown") {
    if (now - phase.startedAt >= COUNTDOWN_STEP_MS * COUNTDOWN_START_VALUE) {
      completeCountdown(now);
    } else {
      render(now);
    }
  } else if (phase.kind === "gameplay") {
    const hadLineRevealAnimation = lineRevealAnimation !== null;
    const hadStationWipeAnimation = stationWipeAnimation !== null;
    const hadCameraPanAnimation = cameraPanAnimation !== null;
    const lineRevealProgress = getLineRevealAnimationProgress(now);
    if (
      lineRevealAnimation?.hiddenCurrentStationId &&
      !lineRevealAnimation.stationWipeStarted &&
      lineRevealProgress >= STATION_WIPE_START_LINE_PROGRESS
    ) {
      stationWipeAnimation = {
        stationId: lineRevealAnimation.hiddenCurrentStationId,
        direction: lineRevealAnimation.direction,
        startedAt: now,
      };
      lineRevealAnimation.stationWipeStarted = true;
    }
    if (lineRevealAnimation && lineRevealProgress >= 1) {
      lineRevealAnimation = null;
    }
    if (stationWipeAnimation && getStationWipeAnimationProgress(now) >= 1) {
      stationWipeAnimation = null;
    }
    if (cameraPanAnimation && getCameraPanAnimationProgress(now) >= 1) {
      cameraPanAnimation = null;
    }
    const nextCompletionCelebration = advanceCompletionCelebration(
      completionCelebration,
      lineRevealAnimation !== null || stationWipeAnimation !== null,
      now,
    );
    completionCelebration = nextCompletionCelebration.celebration;
    if (
      hadLineRevealAnimation ||
      hadStationWipeAnimation ||
      hadCameraPanAnimation ||
      nextCompletionCelebration.changed ||
      renderer.svg.classList.contains("tube-map-menu-preview")
    ) {
      render(now);
    } else {
      hud.updateTimer(phase.state, now);
    }
  } else {
    renderer.renderMenuPreview(now);
  }
  requestAnimationFrame(tick);
}

function getCountdownValue(activeCountdown: CountdownPhase, now: number): number {
  const elapsedSteps = Math.floor((now - activeCountdown.startedAt) / COUNTDOWN_STEP_MS);
  return Math.max(1, COUNTDOWN_START_VALUE - elapsedSteps);
}

function getActiveLineRevealAnimation(now: number) {
  if (!lineRevealAnimation) {
    return null;
  }

  return {
    connectionId: lineRevealAnimation.connectionId,
    fromStationId: lineRevealAnimation.fromStationId,
    hiddenCurrentStationId: lineRevealAnimation.hiddenCurrentStationId,
    revealLine: lineRevealAnimation.revealLine,
    progress: getLineRevealAnimationProgress(now),
  };
}

function getLineRevealAnimationProgress(now: number): number {
  if (!lineRevealAnimation) {
    return 1;
  }

  return getLinearAnimationProgress(
    lineRevealAnimation.startedAt,
    now,
    LINE_REVEAL_ANIMATION_DURATION_MS,
  );
}

function getActiveStationWipeAnimation(now: number) {
  if (!stationWipeAnimation) {
    return null;
  }

  return {
    stationId: stationWipeAnimation.stationId,
    direction: stationWipeAnimation.direction,
    progress: getStationWipeAnimationProgress(now),
  };
}

function getStationWipeAnimationProgress(now: number): number {
  if (!stationWipeAnimation) {
    return 1;
  }

  return Math.max(0, Math.min(1, (now - stationWipeAnimation.startedAt) * STATION_WIPE_ANIMATION_SPEED));
}

function getActiveCameraPanAnimation(now: number) {
  if (!cameraPanAnimation) {
    return null;
  }

  return {
    from: cameraPanAnimation.from,
    to: cameraPanAnimation.to,
    progress: getCameraPanAnimationProgress(now),
  };
}

function getCameraPanAnimationProgress(now: number): number {
  if (!cameraPanAnimation) {
    return 1;
  }

  return getLinearAnimationProgress(
    cameraPanAnimation.startedAt,
    now,
    LINE_SWITCH_CAMERA_PAN_DURATION_MS,
  );
}

function changeSelectedLine(direction: -1 | 1): void {
  const gameplay = app.gameplay;
  if (!gameplay || hud.isGameplayOverlayOpen()) {
    return;
  }

  cancelTouchMoveStubFeedback();
  cancelMovePointerSelection();
  const previousState = gameplay.state;
  const nextState = cycleSelectedLine(gameplay.state, networkData, direction);
  app.setGameplayState(nextState);
  const pan = renderer.getLineSwitchCameraPan(previousState, nextState);
  if (!lineRevealAnimation && pan) {
    cameraPanAnimation = { ...pan, startedAt: performance.now() };
  } else {
    cameraPanAnimation = null;
  }
  render();
}

const disposeKeyboardControls = bindKeyboardControls(changeSelectedLine);

renderer.svg.addEventListener("pointermove", (event) => {
  rememberMousePoint(event);
  if (event.pointerType === "touch" && touchGameplayGesture?.pointerId === event.pointerId) {
    touchGameplayGesture = updateTouchGameplayGesture(
      touchGameplayGesture,
      event.pointerId,
      { x: event.clientX, y: event.clientY },
    );
    event.preventDefault();
    return;
  }
  if (event.pointerType === "touch" && mapTouchPoints.has(event.pointerId)) {
    mapTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mapTouchPoints.size >= 2) {
      const nextGesture = getPinchGesture(mapTouchPoints);
      if (mapPinchGesture && nextGesture) {
        renderer.panByClientDelta(
          nextGesture.midpoint.x - mapPinchGesture.midpoint.x,
          nextGesture.midpoint.y - mapPinchGesture.midpoint.y,
        );
        renderer.zoomByFactor(
          nextGesture.distance / mapPinchGesture.distance,
          nextGesture.midpoint,
        );
      }
      mapPinchGesture = nextGesture;
      render();
      event.preventDefault();
      return;
    }
  }
  if (panPointerId === event.pointerId && lastPanPoint) {
    renderer.panByClientDelta(event.clientX - lastPanPoint.x, event.clientY - lastPanPoint.y);
    lastPanPoint = { x: event.clientX, y: event.clientY };
    render();
    return;
  }

  if (event.pointerType === "touch" && touchGameplayControlsQuery.matches) {
    return;
  }

  if (!canSelectMovementStub()) {
    setHoveredMoveStub(null);
    return;
  }

  const hoveredStub = getDirectionStubControlAtPoint(event.clientX, event.clientY);
  setHoveredMoveStub(hoveredStub);
  if (hoveredStub && moveSelection.pointerId === event.pointerId) {
    selectMoveStub(hoveredStub);
  }
  if (moveSelection.pointerId === event.pointerId) {
    event.preventDefault();
  }
});

renderer.svg.addEventListener("pointerleave", () => {
  lastMousePoint = null;
  if (moveSelection.pointerId === null) {
    setHoveredMoveStub(null);
  }
});

function attemptMoveFromStub(direction: MovementDirection, now: number): boolean {
  const gameplay = app.gameplay;
  if (!canSelectMovementStub() || !gameplay) {
    return false;
  }

  const previousState = gameplay.state;
  const fromStationId = gameplay.state.currentStationId;
  const selectedLineId = gameplay.state.selectedLineId;
  const revealedConnectionsBeforeMove = gameplay.state.revealedConnections;
  const result = gameplay.tutorial
    ? attemptTutorialMoveInDirection(gameplay.state, networkData, direction, now)
    : attemptMoveInDirection(gameplay.state, networkData, direction, now);
  app.setGameplayState(result.state);

  if (result.moved && result.targetStationId) {
    const connectionId = createConnectionId(selectedLineId, fromStationId, result.targetStationId);
    const revealLine = !revealedConnectionsBeforeMove.has(connectionId);
    stationWipeAnimation = null;
    cameraPanAnimation = null;
    lineRevealAnimation = {
      connectionId,
      fromStationId,
      hiddenCurrentStationId: revealLine && !isStationVisible(result.targetStationId, previousState, revealedConnectionsBeforeMove)
        ? result.targetStationId
        : null,
      revealLine,
      direction,
      stationWipeStarted: false,
      startedAt: now,
    };
  }

  if (result.state.completed) {
    completionCelebration = createCompletionCelebration();
  }

  if (!result.moved && result.state.rejectedMoveAt !== null) {
    const rejectedMoveAt = result.state.rejectedMoveAt;
    if (rejectedMoveTimeoutId !== null) window.clearTimeout(rejectedMoveTimeoutId);
    rejectedMoveTimeoutId = window.setTimeout(() => {
      rejectedMoveTimeoutId = null;
      const activeGameplay = app.gameplay;
      if (!activeGameplay || activeGameplay.state.rejectedMoveAt !== rejectedMoveAt) {
        return;
      }

      app.setGameplayState({ ...activeGameplay.state, rejectedMoveAt: null });
      render();
    }, REJECTED_MOVE_FLASH_MS);
  }

  return result.moved;
}

function getDirectionStubControl(target: EventTarget | null): SVGGElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const control = target.closest<SVGGElement>(".direction-stub-control[data-movement-direction]");
  return control && renderer.svg.contains(control) ? control : null;
}

function getDirectionStubControlAtPoint(clientX: number, clientY: number): SVGGElement | null {
  let closestControl: SVGGElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestPriority = -1;
  for (const control of renderer.svg.querySelectorAll<SVGGElement>(
    ".direction-stub-control[data-movement-direction]",
  )) {
    const hitTarget = control.querySelector<SVGPathElement>(".direction-stub-hit");
    if (!hitTarget) {
      continue;
    }
    const point = getSvgPoint(hitTarget, clientX, clientY);
    if (!point) {
      continue;
    }
    const hitPath = getRenderedStubPathPoints(hitTarget);
    const hitWidth = Number(hitTarget.getAttribute("stroke-width"));
    if (hitPath.length < 2 || !Number.isFinite(hitWidth)) {
      continue;
    }
    const distance = getStubPathHitDistance(point, hitPath);
    if (distance === null || distance > hitWidth / 2) {
      continue;
    }
    const priority = getVisibleStubHitPriority(control, point);
    if (
      priority < closestPriority ||
      (priority === closestPriority && distance >= closestDistance)
    ) {
      continue;
    }
    closestControl = control;
    closestDistance = distance;
    closestPriority = priority;
  }
  return closestControl;
}

function canSelectMovementStub(): boolean {
  const gameplay = app.gameplay;
  return Boolean(gameplay && !gameplay.state.completed) &&
    !hud.isGameplayOverlayOpen() &&
    touchMoveStubFeedback === null &&
    lineRevealAnimation === null &&
    cameraPanAnimation === null;
}

function getVisibleStubHitPriority(control: SVGGElement, point: Point): number {
  if (control.classList.contains("direction-stub-hovered")) {
    const arrowHead = control.querySelector<SVGPolygonElement>(".direction-stub-arrowhead");
    const points = arrowHead?.points;
    if (points) {
      const polygon = Array.from(points).map((candidate) => ({
        x: candidate.x,
        y: candidate.y,
      }));
      if (isPointInPolygon(point, polygon)) {
        return 2;
      }
    }
  }

  const visibleLine = control.querySelector<SVGPathElement>(".direction-stub");
  if (visibleLine) {
    const linePath = getRenderedStubPathPoints(visibleLine);
    const lineWidth = Number(visibleLine.getAttribute("stroke-width"));
    const lineDistance = getStubPathHitDistance(point, linePath);
    if (lineDistance !== null && lineDistance <= lineWidth / 2) {
      return 1;
    }
  }

  return 0;
}

function getRenderedStubPathPoints(path: SVGPathElement): Point[] {
  const serialized = path.dataset.pathPoints;
  if (!serialized) return [];
  const points = serialized.split(" ").map((value) => {
    const [x, y] = value.split(",").map(Number);
    return { x, y };
  });
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ? points : [];
}

function setHoveredMoveStub(stub: SVGGElement | null): void {
  if (hoveredMoveStub === stub) {
    return;
  }
  hoveredMoveStub?.classList.remove("direction-stub-hovered");
  hoveredMoveStub = stub;
  hoveredMoveStub?.classList.add("direction-stub-hovered");
}

function rememberMousePoint(event: PointerEvent): void {
  if (event.pointerType === "mouse") {
    lastMousePoint = { x: event.clientX, y: event.clientY };
  }
}

function refreshHoveredMoveStub(): void {
  if (!lastMousePoint || !canSelectMovementStub()) {
    setHoveredMoveStub(null);
    return;
  }
  setHoveredMoveStub(getDirectionStubControlAtPoint(lastMousePoint.x, lastMousePoint.y));
}

function getStubMovementDirection(stub: SVGGElement | null): MovementDirection | null {
  const direction = stub?.dataset.movementDirection;
  return MOVEMENT_DIRECTIONS.find((candidate) => candidate === direction) ?? null;
}

function selectMoveStub(stub: SVGGElement): void {
  const direction = getStubMovementDirection(stub);
  if (!direction) {
    return;
  }
  selectedMoveStub?.classList.remove("direction-stub-selected");
  selectedMoveStub = stub;
  moveSelection = dragStubSelection(moveSelection, moveSelection.pointerId ?? -1, direction);
  selectedMoveStub.classList.add("direction-stub-selected");
}

function cancelMovePointerSelection(): void {
  const pointerId = moveSelection.pointerId;
  selectedMoveStub?.classList.remove("direction-stub-selected");
  selectedMoveStub = null;
  setHoveredMoveStub(null);
  moveSelection = createStubSelectionState();
  if (pointerId !== null && renderer.svg.hasPointerCapture(pointerId)) {
    renderer.svg.releasePointerCapture(pointerId);
  }
}

renderer.svg.addEventListener("wheel", (event) => {
  if (!canPanAndZoom()) {
    return;
  }

  event.preventDefault();
  renderer.zoomByWheel(event.deltaY, { x: event.clientX, y: event.clientY });
  render();
}, { passive: false });

renderer.svg.addEventListener("pointerdown", (event) => {
  rememberMousePoint(event);
  if (event.button !== 0) {
    return;
  }

  if (
    event.pointerType === "touch" &&
    touchGameplayControlsQuery.matches &&
    canUseTouchGameplayControls()
  ) {
    if (touchGameplayGesture) {
      touchGameplayGesture = cancelTouchGameplayGesture(touchGameplayGesture);
    } else {
      touchGameplayGesture = beginTouchGameplayGesture(
        event.pointerId,
        { x: event.clientX, y: event.clientY },
      );
      renderer.svg.setPointerCapture(event.pointerId);
    }
    setHoveredMoveStub(null);
    event.preventDefault();
    return;
  }

  if (event.pointerType === "touch" && canPanAndZoom()) {
    mapTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.svg.setPointerCapture(event.pointerId);
    if (mapTouchPoints.size >= 2) {
      mapPinchGesture = getPinchGesture(mapTouchPoints);
      panPointerId = null;
      lastPanPoint = null;
    } else {
      panPointerId = event.pointerId;
      lastPanPoint = { x: event.clientX, y: event.clientY };
    }
    renderer.svg.classList.add("tube-map-panning");
    event.preventDefault();
    return;
  }

  if (event.pointerType === "touch" && touchGameplayControlsQuery.matches) {
    event.preventDefault();
    return;
  }

  const stub = getDirectionStubControlAtPoint(event.clientX, event.clientY);
  const direction = getStubMovementDirection(stub);
  if (stub && direction && canSelectMovementStub()) {
    moveSelection = beginStubSelection(event.pointerId, direction);
    selectMoveStub(stub);
    renderer.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  if (canPanAndZoom()) {
    panPointerId = event.pointerId;
    lastPanPoint = { x: event.clientX, y: event.clientY };
    renderer.svg.setPointerCapture(event.pointerId);
    renderer.svg.classList.add("tube-map-panning");
    event.preventDefault();
  }
});

function canPanAndZoom(): boolean {
  const gameplay = app.gameplay;
  return !hud.isGameplayOverlayOpen() &&
    (app.phase.kind === "map" || Boolean(gameplay?.state.completed && completionCelebration === null));
}

function canUseTouchGameplayControls(): boolean {
  const gameplay = app.gameplay;
  return touchGameplayControlsQuery.matches &&
    Boolean(gameplay && !gameplay.state.completed) &&
    !hud.isGameplayOverlayOpen() &&
    touchMoveStubFeedback === null;
}

function canCycleLineWithTouch(): boolean {
  const gameplay = app.gameplay;
  const lineCount = gameplay ? getLineCyclePreview(gameplay.state, networkData)?.lineCount ?? 0 : 0;
  return lineCount > 1;
}

function endTouchGameplayPointer(event: PointerEvent, performAction: boolean): boolean {
  if (event.pointerType !== "touch" || touchGameplayGesture?.pointerId !== event.pointerId) {
    return false;
  }

  touchGameplayGesture = updateTouchGameplayGesture(
    touchGameplayGesture,
    event.pointerId,
    { x: event.clientX, y: event.clientY },
  );
  const gameplayBounds = renderer.svg.getBoundingClientRect();
  const action = performAction && canUseTouchGameplayControls()
    ? getTouchGameplayAction(
        touchGameplayGesture,
        gameplayBounds.left + gameplayBounds.width / 2,
      )
    : null;
  if (renderer.svg.hasPointerCapture(event.pointerId)) {
    renderer.svg.releasePointerCapture(event.pointerId);
  }
  touchGameplayGesture = null;

  if (action?.type === "move") {
    if (!showTouchMoveStubFeedback(action.direction)) {
      attemptMoveFromStub(action.direction, performance.now());
      render();
    }
  } else if (action?.type === "cycle-line" && canCycleLineWithTouch()) {
    changeSelectedLine(action.offset);
  }

  event.preventDefault();
  return true;
}

function resetTouchGameplayGesture(): void {
  const pointerId = touchGameplayGesture?.pointerId;
  if (pointerId !== undefined && renderer.svg.hasPointerCapture(pointerId)) {
    renderer.svg.releasePointerCapture(pointerId);
  }
  touchGameplayGesture = null;
  cancelTouchMoveStubFeedback();
}

function showTouchMoveStubFeedback(direction: MovementDirection): boolean {
  const gameplay = app.gameplay;
  if (!gameplay || !canSelectMovementStub()) {
    return false;
  }

  const target = findDirectionalNeighbour(
    networkData,
    gameplay.state.currentStationId,
    gameplay.state.selectedLineId,
    direction,
  );
  if (!target) {
    return false;
  }

  const stub = Array.from(
    renderer.svg.querySelectorAll<SVGGElement>(".direction-stub-control[data-stub-direction]"),
  ).find((candidate) =>
    candidate.dataset.stubDirection === direction &&
    candidate.dataset.targetStationId === target.id
  );
  if (!stub) {
    return false;
  }

  const stationId = gameplay.state.currentStationId;
  const lineId = gameplay.state.selectedLineId;
  stub.classList.add("direction-stub-touch-feedback");
  const timeoutId = window.setTimeout(() => {
    const feedback = touchMoveStubFeedback;
    if (!feedback || feedback.stub !== stub) {
      return;
    }

    feedback.stub.classList.remove("direction-stub-touch-feedback");
    touchMoveStubFeedback = null;
    const activeGameplay = app.gameplay;
    if (
      activeGameplay?.state.currentStationId !== feedback.stationId ||
      activeGameplay.state.selectedLineId !== feedback.lineId
    ) {
      return;
    }

    attemptMoveFromStub(feedback.direction, performance.now());
    render();
  }, TOUCH_MOVE_STUB_FEEDBACK_MS);
  touchMoveStubFeedback = { stub, direction, stationId, lineId, timeoutId };
  return true;
}

function cancelTouchMoveStubFeedback(): void {
  if (!touchMoveStubFeedback) {
    return;
  }

  window.clearTimeout(touchMoveStubFeedback.timeoutId);
  touchMoveStubFeedback.stub.classList.remove("direction-stub-touch-feedback");
  touchMoveStubFeedback = null;
}

function endPan(event: PointerEvent): void {
  if (panPointerId !== event.pointerId) {
    return;
  }

  if (renderer.svg.hasPointerCapture(event.pointerId)) {
    renderer.svg.releasePointerCapture(event.pointerId);
  }
  panPointerId = null;
  lastPanPoint = null;
  renderer.svg.classList.remove("tube-map-panning");
}

function endMapTouchPointer(event: PointerEvent): boolean {
  if (event.pointerType !== "touch" || !mapTouchPoints.delete(event.pointerId)) {
    return false;
  }
  if (renderer.svg.hasPointerCapture(event.pointerId)) {
    renderer.svg.releasePointerCapture(event.pointerId);
  }
  const remainingTouch = mapTouchPoints.entries().next().value as [number, Point] | undefined;
  mapPinchGesture = null;
  if (remainingTouch) {
    panPointerId = remainingTouch[0];
    lastPanPoint = remainingTouch[1];
  } else {
    panPointerId = null;
    lastPanPoint = null;
    renderer.svg.classList.remove("tube-map-panning");
  }
  return true;
}

function resetMapTouchGesture(): void {
  for (const pointerId of mapTouchPoints.keys()) {
    if (renderer.svg.hasPointerCapture(pointerId)) {
      renderer.svg.releasePointerCapture(pointerId);
    }
  }
  mapTouchPoints.clear();
  mapPinchGesture = null;
}

function endMovePointer(event: PointerEvent, moveOnRelease: boolean): void {
  if (moveSelection.pointerId !== event.pointerId) {
    return;
  }

  const releasedSelection = releaseStubSelection(moveSelection, event.pointerId);
  const direction = releasedSelection.direction;
  cancelMovePointerSelection();
  if (moveOnRelease && direction) {
    attemptMoveFromStub(direction, performance.now());
    render();
  }
}

renderer.svg.addEventListener("pointerup", (event) => {
  if (endTouchGameplayPointer(event, true)) {
    return;
  }
  endMapTouchPointer(event);
  endMovePointer(event, true);
  endPan(event);
});
renderer.svg.addEventListener("pointercancel", (event) => {
  if (endTouchGameplayPointer(event, false)) {
    return;
  }
  endMapTouchPointer(event);
  endMovePointer(event, false);
  endPan(event);
});
renderer.svg.addEventListener("lostpointercapture", (event) => {
  if (endTouchGameplayPointer(event, false)) return;
  endMapTouchPointer(event);
  endMovePointer(event, false);
  endPan(event);
});

renderer.svg.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const stub = getDirectionStubControl(event.target);
  const direction = getStubMovementDirection(stub);
  if (!direction || !canSelectMovementStub()) {
    return;
  }
  event.preventDefault();
  attemptMoveFromStub(direction, performance.now());
  render();
});

render();
requestAnimationFrame(tick);

const handleTouchControlModeChange = (): void => {
  cancelMovePointerSelection();
  resetTouchGameplayGesture();
  render();
};
if (typeof touchGameplayControlsQuery.addEventListener === "function") {
  touchGameplayControlsQuery.addEventListener("change", handleTouchControlModeChange);
} else {
  const legacyQuery = touchGameplayControlsQuery as MediaQueryList & {
    addListener: (listener: (event: MediaQueryListEvent) => void) => void;
  };
  legacyQuery.addListener(handleTouchControlModeChange);
}
window.addEventListener("pagehide", () => {
  disposeKeyboardControls();
  gameplayMapPanZoom?.dispose();
  if (typeof touchGameplayControlsQuery.removeEventListener === "function") {
    touchGameplayControlsQuery.removeEventListener("change", handleTouchControlModeChange);
  } else {
    const legacyQuery = touchGameplayControlsQuery as MediaQueryList & {
      removeListener: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    legacyQuery.removeListener(handleTouchControlModeChange);
  }
}, { once: true });

function isStationVisible(
  stationId: string,
  currentState: GameState,
  revealedConnectionIds: Set<string>,
): boolean {
  if (currentState.currentStationId === stationId || currentState.startStationId === stationId) {
    return true;
  }

  return networkData.connections.some(
    (connection) =>
      revealedConnectionIds.has(connection.id) &&
      (connection.from === stationId || connection.to === stationId),
  );
}

}

function isDevMode(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}
