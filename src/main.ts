import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from '@vercel/speed-insights';
import "./style.css";
import { createConnectionId, networkData } from "./data/network";
import { validateNetworkData } from "./data/validation";
import { createGameStateForRound, getElapsedMilliseconds, type GameState } from "./game/GameState";
import {
  advanceCompletionCelebration,
  createCompletionCelebration,
  type CompletionCelebration,
} from "./game/completionCelebration";
import { generateRoundConfigs, generateSeed } from "./game/seed";
import { ROUND_COUNT, type RoundStats, type RunResults, type RunState } from "./game/RunState";
import {
  attemptTutorialMoveInDirection,
  createTutorialGameState,
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
import { LINE_REVEAL_ANIMATION_SPEED } from "./rendering/lineRenderer";
import { GRID_CELL_SIZE } from "./rendering/grid";
import { STATION_WIPE_COMPONENT_RADIUS } from "./rendering/stationRenderer";
import { Hud } from "./ui/hud";
import type { Point } from "./data/types";

inject();
injectSpeedInsights();

const REJECTED_MOVE_FLASH_MS = 180;
const TOUCH_MOVE_STUB_FEEDBACK_MS = 100;
const COUNTDOWN_STEP_MS = 700;
const COUNTDOWN_START_VALUE = 3;
const LINE_SWITCH_CAMERA_PAN_SPEED = 1 / 160;
const LINE_REVEAL_ANIMATION_DURATION_MS = 1 / LINE_REVEAL_ANIMATION_SPEED;

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
  if (window.location.pathname === "/label-editor") {
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
let state: GameState | null = null;
let runState: RunState | null = null;
let results: RunResults | null = null;
let mapViewerActive = false;
let tutorialActive = false;
let completionCelebration: CompletionCelebration | null = null;
let countdown: { run: RunState; startedAt: number } | null = null;
let moveSelection = createStubSelectionState();
let selectedMoveStub: SVGGElement | null = null;
let hoveredMoveStub: SVGGElement | null = null;
let lastMousePoint: Point | null = null;
let panPointerId: number | null = null;
let lastPanPoint: Point | null = null;
const mapTouchPoints = new Map<number, Point>();
let mapPinchGesture: PinchGesture | null = null;
let touchGameplayGesture: TouchGameplayGesture | null = null;
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
let gameplayMapRenderer: MapRenderer;
let gameplayMapPanPointerId: number | null = null;
let gameplayMapLastPanPoint: Point | null = null;
const gameplayMapTouchPoints = new Map<number, Point>();
let gameplayMapPinchGesture: PinchGesture | null = null;
const touchGameplayControlsQuery = window.matchMedia("(hover: none) and (pointer: coarse)");

const hud = new Hud(appRoot, networkData, {
  onStartRandomSeed: () => startRun(generateSeed(), "random"),
  onStartSeed: (seed) => startRun(seed, "set"),
  onStartTutorial: () => startTutorial(),
  onOpenMap: () => {
    state = null;
    runState = null;
    results = null;
    countdown = null;
    mapViewerActive = true;
    tutorialActive = false;
    resetRunTransientState();
    renderer.resetExplorerView();
    hud.showMapViewer();
    render();
  },
  onFocusMapStation: (stationId) => {
    if (!mapViewerActive) {
      return;
    }
    renderer.focusExplorerStation(stationId);
    render();
  },
  onReturnToMenu: () => {
    state = null;
    runState = null;
    results = null;
    countdown = null;
    mapViewerActive = false;
    tutorialActive = false;
    resetRunTransientState();
    hud.showMenu();
    render();
  },
  onPlayAgain: () => {
    state = null;
    runState = null;
    results = null;
    countdown = null;
    mapViewerActive = false;
    tutorialActive = false;
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
    resetGameplayMapGesture();
    gameplayMapRenderer.resetExplorerView();
    gameplayMapRenderer.renderExplorer();
  },
  onFocusGameplayMapStation: (stationId) => {
    gameplayMapRenderer.focusExplorerStation(stationId);
    gameplayMapRenderer.renderExplorer();
  },
  onGameplayMapZoomIn: () => {
    gameplayMapRenderer.zoomIn();
    gameplayMapRenderer.renderExplorer();
  },
  onGameplayMapZoomOut: () => {
    gameplayMapRenderer.zoomOut();
    gameplayMapRenderer.renderExplorer();
  },
  onCycleLine: (direction) => changeSelectedLine(direction),
});

const renderer = new MapRenderer(hud.mapHost, networkData);
gameplayMapRenderer = new MapRenderer(hud.gameplayMapHost, networkData);
let resizeRenderFrame: number | null = null;
window.addEventListener("resize", () => {
  if (resizeRenderFrame !== null) {
    return;
  }
  resizeRenderFrame = window.requestAnimationFrame((now) => {
    resizeRenderFrame = null;
    render(now);
    if (hud.isGameplayMapOpen()) {
      gameplayMapRenderer.renderExplorer();
    }
  });
});

gameplayMapRenderer.svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  gameplayMapRenderer.zoomByWheel(event.deltaY, { x: event.clientX, y: event.clientY });
  gameplayMapRenderer.renderExplorer();
}, { passive: false });

gameplayMapRenderer.svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  if (event.pointerType === "touch") {
    gameplayMapTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gameplayMapRenderer.svg.setPointerCapture(event.pointerId);
    if (gameplayMapTouchPoints.size >= 2) {
      gameplayMapPinchGesture = getPinchGesture(gameplayMapTouchPoints);
      gameplayMapPanPointerId = null;
      gameplayMapLastPanPoint = null;
    } else {
      gameplayMapPanPointerId = event.pointerId;
      gameplayMapLastPanPoint = { x: event.clientX, y: event.clientY };
    }
    gameplayMapRenderer.svg.classList.add("tube-map-panning");
    event.preventDefault();
    return;
  }
  gameplayMapPanPointerId = event.pointerId;
  gameplayMapLastPanPoint = { x: event.clientX, y: event.clientY };
  gameplayMapRenderer.svg.setPointerCapture(event.pointerId);
  gameplayMapRenderer.svg.classList.add("tube-map-panning");
  event.preventDefault();
});

gameplayMapRenderer.svg.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" && gameplayMapTouchPoints.has(event.pointerId)) {
    gameplayMapTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gameplayMapTouchPoints.size >= 2) {
      const nextGesture = getPinchGesture(gameplayMapTouchPoints);
      if (gameplayMapPinchGesture && nextGesture) {
        gameplayMapRenderer.panByClientDelta(
          nextGesture.midpoint.x - gameplayMapPinchGesture.midpoint.x,
          nextGesture.midpoint.y - gameplayMapPinchGesture.midpoint.y,
        );
        gameplayMapRenderer.zoomByFactor(
          nextGesture.distance / gameplayMapPinchGesture.distance,
          nextGesture.midpoint,
        );
      }
      gameplayMapPinchGesture = nextGesture;
      gameplayMapRenderer.renderExplorer();
      event.preventDefault();
      return;
    }
  }
  if (gameplayMapPanPointerId !== event.pointerId || !gameplayMapLastPanPoint) {
    return;
  }
  gameplayMapRenderer.panByClientDelta(
    event.clientX - gameplayMapLastPanPoint.x,
    event.clientY - gameplayMapLastPanPoint.y,
  );
  gameplayMapLastPanPoint = { x: event.clientX, y: event.clientY };
  gameplayMapRenderer.renderExplorer();
  gameplayMapRenderer.svg.classList.add("tube-map-panning");
});

const endGameplayMapPan = (event: PointerEvent): void => {
  if (event.pointerType === "touch" && gameplayMapTouchPoints.delete(event.pointerId)) {
    if (gameplayMapRenderer.svg.hasPointerCapture(event.pointerId)) {
      gameplayMapRenderer.svg.releasePointerCapture(event.pointerId);
    }
    const remainingTouch = gameplayMapTouchPoints.entries().next().value as [number, Point] | undefined;
    gameplayMapPinchGesture = null;
    if (remainingTouch) {
      gameplayMapPanPointerId = remainingTouch[0];
      gameplayMapLastPanPoint = remainingTouch[1];
    } else {
      gameplayMapPanPointerId = null;
      gameplayMapLastPanPoint = null;
      gameplayMapRenderer.svg.classList.remove("tube-map-panning");
    }
    return;
  }
  if (gameplayMapPanPointerId !== event.pointerId) {
    return;
  }
  if (gameplayMapRenderer.svg.hasPointerCapture(event.pointerId)) {
    gameplayMapRenderer.svg.releasePointerCapture(event.pointerId);
  }
  gameplayMapPanPointerId = null;
  gameplayMapLastPanPoint = null;
  gameplayMapRenderer.svg.classList.remove("tube-map-panning");
};
gameplayMapRenderer.svg.addEventListener("pointerup", endGameplayMapPan);
gameplayMapRenderer.svg.addEventListener("pointercancel", endGameplayMapPan);

function resetGameplayMapGesture(): void {
  for (const pointerId of gameplayMapTouchPoints.keys()) {
    if (gameplayMapRenderer.svg.hasPointerCapture(pointerId)) {
      gameplayMapRenderer.svg.releasePointerCapture(pointerId);
    }
  }
  gameplayMapTouchPoints.clear();
  gameplayMapPinchGesture = null;
  gameplayMapPanPointerId = null;
  gameplayMapLastPanPoint = null;
  gameplayMapRenderer.svg.classList.remove("tube-map-panning");
}

function startRun(seed: string, seedSource: RunState["seedSource"]): void {
  mapViewerActive = false;
  tutorialActive = false;
  runState = {
    seed,
    seedSource,
    rounds: generateRoundConfigs(seed, networkData),
    currentRoundIndex: 0,
    completedRoundStats: [],
  };
  results = null;
  state = null;
  countdown = { run: runState, startedAt: performance.now() };
  resetRunTransientState();
  render();
}

function startTutorial(): void {
  mapViewerActive = false;
  tutorialActive = true;
  runState = null;
  results = null;
  countdown = null;
  state = createTutorialGameState(networkData, performance.now());
  resetRunTransientState();
  render();
}

function completeCountdown(activeRun: RunState, now: number): void {
  countdown = null;
  runState = activeRun;
  state = createGameStateForRound(
    activeRun.seed,
    activeRun.rounds[activeRun.currentRoundIndex],
    networkData,
    now,
  );
  resetRunTransientState();
  render(now);
}

function advanceFromCompletedRound(): void {
  if (!state?.completed || !runState) {
    return;
  }

  const stats = getCurrentRoundStats(state);
  const completedRoundStats = upsertRoundStats(runState.completedRoundStats, stats);
  if (runState.currentRoundIndex >= ROUND_COUNT - 1) {
    results = {
      seed: runState.seed,
      seedSource: runState.seedSource,
      rounds: runState.rounds,
      roundStats: completedRoundStats,
    };
    state = null;
    runState = null;
    countdown = null;
    resetRunTransientState();
    render();
    return;
  }

  runState = {
    ...runState,
    currentRoundIndex: runState.currentRoundIndex + 1,
    completedRoundStats,
  };
  state = null;
  countdown = { run: runState, startedAt: performance.now() };
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
  panPointerId = null;
  lastPanPoint = null;
  renderer.svg.classList.remove("tube-map-panning");
  renderer.resetZoom();
}

function render(now = performance.now()): void {
  if (mapViewerActive) {
    renderer.renderExplorer();
  } else if (results) {
    renderer.renderMenuPreview(now);
    hud.showResults(results);
  } else if (state) {
    renderer.render(
      state,
      getActiveLineRevealAnimation(now),
      getActiveStationWipeAnimation(now),
      getActiveCameraPanAnimation(now),
      completionCelebration !== null,
      completionCelebration !== null && completionCelebration.startedAt !== null,
      !touchGameplayControlsQuery.matches,
      tutorialActive ? TUTORIAL_CONNECTION_IDS : null,
    );
    refreshHoveredMoveStub();
    hud.update(
      state,
      now,
      runState,
      completionCelebration === null,
      tutorialActive
        ? getTutorialInstructions(state, touchGameplayControlsQuery.matches)
        : null,
    );
  } else if (countdown) {
    renderer.renderMenuPreview(now);
    hud.showCountdown(getCountdownValue(countdown, now));
  } else {
    renderer.renderMenuPreview(now);
    hud.update(null, now);
  }
}

function tick(): void {
  const now = performance.now();
  if (mapViewerActive) {
    // The explorer is static until the player pans, zooms, searches, or resizes it.
  } else if (countdown) {
    if (now - countdown.startedAt >= COUNTDOWN_STEP_MS * COUNTDOWN_START_VALUE) {
      completeCountdown(countdown.run, now);
    } else {
      render(now);
    }
  } else if (state) {
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
      hud.update(
        state,
        now,
        runState,
        completionCelebration === null,
        tutorialActive
          ? getTutorialInstructions(state, touchGameplayControlsQuery.matches)
          : null,
      );
    }
  } else if (results || !state) {
    renderer.renderMenuPreview(now);
  }
  requestAnimationFrame(tick);
}

function getCountdownValue(activeCountdown: NonNullable<typeof countdown>, now: number): number {
  const elapsedSteps = Math.floor((now - activeCountdown.startedAt) / COUNTDOWN_STEP_MS);
  return Math.max(1, COUNTDOWN_START_VALUE - elapsedSteps);
}

function getCurrentRoundStats(completedState: GameState): RoundStats {
  if (!runState) {
    throw new Error("Cannot collect round stats without a run state.");
  }

  return {
    roundNumber: runState.currentRoundIndex + 1,
    timeMs: getElapsedMilliseconds(completedState, completedState.endTime ?? performance.now()),
    moves: completedState.moveCount,
    lineChanges: completedState.changeCount,
  };
}

function upsertRoundStats(stats: RoundStats[], next: RoundStats): RoundStats[] {
  const existingIndex = stats.findIndex((candidate) => candidate.roundNumber === next.roundNumber);
  if (existingIndex < 0) {
    return [...stats, next];
  }

  return stats.map((candidate, index) => index === existingIndex ? next : candidate);
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

  return Math.max(0, Math.min(1, (now - lineRevealAnimation.startedAt) * LINE_REVEAL_ANIMATION_SPEED));
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

  return Math.max(0, Math.min(1, (now - cameraPanAnimation.startedAt) * LINE_SWITCH_CAMERA_PAN_SPEED));
}

function changeSelectedLine(direction: -1 | 1): void {
  if (!state || hud.isGameplayOverlayOpen()) {
    return;
  }

  cancelTouchMoveStubFeedback();
  cancelMovePointerSelection();
  const previousState = state;
  state = cycleSelectedLine(state, networkData, direction);
  const pan = renderer.getLineSwitchCameraPan(previousState, state);
  if (!lineRevealAnimation && pan) {
    cameraPanAnimation = { ...pan, startedAt: performance.now() };
  } else {
    cameraPanAnimation = null;
  }
  render();
}

bindKeyboardControls(changeSelectedLine);

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
  if (!canSelectMovementStub() || !state) {
    return false;
  }

  const previousState = state;
  const fromStationId = state.currentStationId;
  const selectedLineId = state.selectedLineId;
  const revealedConnectionsBeforeMove = state.revealedConnections;
  const result = tutorialActive
    ? attemptTutorialMoveInDirection(state, networkData, direction, now)
    : attemptMoveInDirection(state, networkData, direction, now);
  state = result.state;

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

  if (state.completed) {
    completionCelebration = createCompletionCelebration();
  }

  if (!result.moved && state.rejectedMoveAt !== null) {
    const rejectedMoveAt = state.rejectedMoveAt;
    window.setTimeout(() => {
      if (!state || state.rejectedMoveAt !== rejectedMoveAt) {
        return;
      }

      state = { ...state, rejectedMoveAt: null };
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
  return !mapViewerActive &&
    Boolean(state && !state.completed) &&
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
  return !hud.isGameplayOverlayOpen() &&
    (mapViewerActive || Boolean(state?.completed && completionCelebration === null));
}

function canUseTouchGameplayControls(): boolean {
  return touchGameplayControlsQuery.matches &&
    !mapViewerActive &&
    Boolean(state && !state.completed) &&
    !hud.isGameplayOverlayOpen() &&
    touchMoveStubFeedback === null;
}

function canCycleLineWithTouch(): boolean {
  const lineCount = state ? getLineCyclePreview(state, networkData)?.lineCount ?? 0 : 0;
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
  if (!state || !canSelectMovementStub()) {
    return false;
  }

  const target = findDirectionalNeighbour(
    networkData,
    state.currentStationId,
    state.selectedLineId,
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

  const stationId = state.currentStationId;
  const lineId = state.selectedLineId;
  stub.classList.add("direction-stub-touch-feedback");
  const timeoutId = window.setTimeout(() => {
    const feedback = touchMoveStubFeedback;
    if (!feedback || feedback.stub !== stub) {
      return;
    }

    feedback.stub.classList.remove("direction-stub-touch-feedback");
    touchMoveStubFeedback = null;
    if (
      state?.currentStationId !== feedback.stationId ||
      state.selectedLineId !== feedback.lineId
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
