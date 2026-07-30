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
import { cycleSelectedLine } from "./game/lineSelection";
import { attemptMoveInDirection, type MovementDirection } from "./game/movement";
import { bindKeyboardControls } from "./input/keyboard";
import {
  clearMouseIntentPosition,
  createMouseIntentState,
  updateMouseIntent,
} from "./input/mouseIntent";
import { MapRenderer } from "./rendering/mapRenderer";
import { LINE_REVEAL_ANIMATION_SPEED } from "./rendering/lineRenderer";
import { GRID_CELL_SIZE } from "./rendering/grid";
import { STATION_WIPE_COMPONENT_RADIUS } from "./rendering/stationRenderer";
import { Hud } from "./ui/hud";
import type { Point } from "./data/types";

inject();
injectSpeedInsights();

const REJECTED_MOVE_FLASH_MS = 180;
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
let completionCelebration: CompletionCelebration | null = null;
let countdown: { run: RunState; startedAt: number } | null = null;
let pointerPoint: Point | null = null;
let mouseIntent = createMouseIntentState();
let activeMovePointerId: number | null = null;
let heldMoveConsumed = false;
let lastHeldMoveAttemptDirection: MovementDirection | null = null;
let panPointerId: number | null = null;
let lastPanPoint: Point | null = null;
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

const hud = new Hud(appRoot, networkData, {
  onStartRandomSeed: () => startRun(generateSeed(), "random"),
  onStartSeed: (seed) => startRun(seed, "set"),
  onOpenMap: () => {
    state = null;
    runState = null;
    results = null;
    countdown = null;
    mapViewerActive = true;
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
});

const renderer = new MapRenderer(hud.mapHost, networkData);

function startRun(seed: string, seedSource: RunState["seedSource"]): void {
  mapViewerActive = false;
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
  pointerPoint = null;
  mouseIntent = createMouseIntentState();
  activeMovePointerId = null;
  heldMoveConsumed = false;
  lastHeldMoveAttemptDirection = null;
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
  } else if (state && runState) {
    renderer.render(
      state,
      pointerPoint,
      mouseIntent.direction,
      getActiveLineRevealAnimation(now),
      getActiveStationWipeAnimation(now),
      getActiveCameraPanAnimation(now),
      completionCelebration !== null,
      completionCelebration !== null && completionCelebration.startedAt !== null,
    );
    hud.update(state, now, runState, completionCelebration === null);
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
    // Explorer rendering is event-driven while idle.
  } else if (countdown) {
    if (now - countdown.startedAt >= COUNTDOWN_STEP_MS * COUNTDOWN_START_VALUE) {
      completeCountdown(countdown.run, now);
    } else {
      render(now);
    }
  } else if (state && runState) {
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
      nextCompletionCelebration.changed
    ) {
      render(now);
    } else {
      hud.update(state, now, runState, completionCelebration === null);
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

bindKeyboardControls((direction) => {
  if (!state || hud.isGameplayHelpOpen()) {
    return;
  }

  const previousState = state;
  state = cycleSelectedLine(state, networkData, direction);
  const pan = renderer.getLineSwitchCameraPan(previousState, state);
  if (!lineRevealAnimation && pan) {
    cameraPanAnimation = { ...pan, startedAt: performance.now() };
  } else {
    cameraPanAnimation = null;
  }
  tryHeldPointerMove(performance.now(), true);
  render();
});

renderer.svg.addEventListener("pointermove", (event) => {
  if (panPointerId === event.pointerId && lastPanPoint) {
    renderer.panByClientDelta(event.clientX - lastPanPoint.x, event.clientY - lastPanPoint.y);
    lastPanPoint = { x: event.clientX, y: event.clientY };
    render();
    return;
  }

  if (mapViewerActive) {
    return;
  }

  if (!state) {
    return;
  }

  if (state.completed) {
    return;
  }

  const currentMousePosition = { x: event.clientX, y: event.clientY };
  const previousDirection = mouseIntent.direction;
  mouseIntent = updateMouseIntent(mouseIntent, currentMousePosition, performance.now());
  pointerPoint = currentMousePosition;
  if (activeMovePointerId === event.pointerId) {
    tryHeldPointerMove(performance.now(), mouseIntent.direction !== previousDirection);
  }
  render();
});

renderer.svg.addEventListener("pointerleave", () => {
  if (panPointerId !== null || activeMovePointerId !== null) {
    return;
  }
  pointerPoint = null;
  mouseIntent = clearMouseIntentPosition(mouseIntent);
  render();
});

function attemptMoveFromCurrentIntent(now: number): boolean {
  if (!state || state.completed || hud.isGameplayHelpOpen()) {
    return false;
  }

  const previousState = state;
  const fromStationId = state.currentStationId;
  const selectedLineId = state.selectedLineId;
  const revealedConnectionsBeforeMove = state.revealedConnections;
  const result = attemptMoveInDirection(state, networkData, mouseIntent.direction, now);
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
      direction: mouseIntent.direction,
      stationWipeStarted: false,
      startedAt: now,
    };
  }

  if (state.completed) {
    completionCelebration = createCompletionCelebration();
    pointerPoint = null;
    mouseIntent = clearMouseIntentPosition(mouseIntent);
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

function tryHeldPointerMove(now: number, forceAttempt = false): void {
  if (
    activeMovePointerId === null ||
    heldMoveConsumed ||
    !state ||
    state.completed ||
    hud.isGameplayHelpOpen()
  ) {
    return;
  }

  if (!forceAttempt && lastHeldMoveAttemptDirection === mouseIntent.direction) {
    return;
  }

  lastHeldMoveAttemptDirection = mouseIntent.direction;
  heldMoveConsumed = attemptMoveFromCurrentIntent(now);
}

renderer.svg.addEventListener("wheel", (event) => {
  if (!canPanAndZoom()) {
    return;
  }

  event.preventDefault();
  renderer.zoomByWheel(event.deltaY);
  render();
}, { passive: false });

renderer.svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  if (state && !state.completed) {
    activeMovePointerId = event.pointerId;
    heldMoveConsumed = false;
    lastHeldMoveAttemptDirection = null;
    pointerPoint = { x: event.clientX, y: event.clientY };
    mouseIntent = updateMouseIntent(mouseIntent, pointerPoint, performance.now());
    renderer.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    tryHeldPointerMove(performance.now(), true);
    render();
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
  return !hud.isGameplayHelpOpen() &&
    (mapViewerActive || Boolean(state?.completed && completionCelebration === null));
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

function endMovePointer(event: PointerEvent): void {
  if (activeMovePointerId !== event.pointerId) {
    return;
  }

  if (renderer.svg.hasPointerCapture(event.pointerId)) {
    renderer.svg.releasePointerCapture(event.pointerId);
  }
  activeMovePointerId = null;
  heldMoveConsumed = false;
  lastHeldMoveAttemptDirection = null;
}

renderer.svg.addEventListener("pointerup", (event) => {
  endMovePointer(event);
  endPan(event);
});
renderer.svg.addEventListener("pointercancel", (event) => {
  endMovePointer(event);
  endPan(event);
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
