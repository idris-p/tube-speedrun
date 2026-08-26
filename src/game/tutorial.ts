import { createConnectionId } from "../data/network";
import type { NetworkData } from "../data/types";
import { createGameStateForRound, type GameState } from "./GameState";
import {
  attemptMoveInDirection,
  findDirectionalNeighbour,
  type MovementDirection,
  type MoveResult,
} from "./movement";

export const TUTORIAL_START_STATION_ID = "stanmore";
export const TUTORIAL_DESTINATION_STATION_ID = "oxford-circus";

const TUTORIAL_ROUTE = [
  { lineId: "jubilee", from: "stanmore", to: "canons-park" },
  { lineId: "jubilee", from: "canons-park", to: "queensbury" },
  { lineId: "jubilee", from: "queensbury", to: "kingsbury" },
  { lineId: "jubilee", from: "kingsbury", to: "wembley-park" },
  { lineId: "metropolitan", from: "wembley-park", to: "finchley-road" },
  { lineId: "metropolitan", from: "finchley-road", to: "baker-street" },
  { lineId: "bakerloo", from: "baker-street", to: "regent-s-park" },
  { lineId: "bakerloo", from: "regent-s-park", to: "oxford-circus" },
] as const;

export const TUTORIAL_CONNECTION_IDS: ReadonlySet<string> = new Set(
  TUTORIAL_ROUTE.map(({ lineId, from, to }) => createConnectionId(lineId, from, to)),
);

export function createTutorialGameState(network: NetworkData, now: number): GameState {
  return {
    ...createGameStateForRound(
      "tutorial",
      {
        startStationId: TUTORIAL_START_STATION_ID,
        destinationStationId: TUTORIAL_DESTINATION_STATION_ID,
      },
      network,
      now,
    ),
    selectedLineId: "jubilee",
  };
}

export function attemptTutorialMoveInDirection(
  state: GameState,
  network: NetworkData,
  direction: MovementDirection,
  now: number,
): MoveResult {
  const target = findDirectionalNeighbour(
    network,
    state.currentStationId,
    state.selectedLineId,
    direction,
  );
  const connectionId = target
    ? createConnectionId(state.selectedLineId, state.currentStationId, target.id)
    : null;

  if (connectionId && !TUTORIAL_CONNECTION_IDS.has(connectionId)) {
    return {
      state: { ...state, rejectedMoveAt: now },
      moved: false,
      targetStationId: null,
      reason: "direction-mismatch",
    };
  }

  return attemptMoveInDirection(state, network, direction, now);
}

export function getTutorialInstructions(state: GameState, touch: boolean): string[] {
  if (state.currentStationId === "wembley-park") {
    if (state.selectedLineId !== "metropolitan") {
      return [touch ? "Tap the screen to switch lines" : "Press A or D to switch lines"];
    }
    return [
      touch
        ? "Swipe diagonally to move"
        : "Move your mouse to the station and click the arrow to move",
    ];
  }

  if (state.currentStationId === "baker-street") {
    if (state.selectedLineId !== "bakerloo") {
      return [
        touch
          ? "Tap the left or right side of the screen to switch lines"
          : "Press A or D to switch lines",
        "Switch to the Bakerloo line",
      ];
    }
    return [
      touch
        ? "Swipe diagonally to move"
        : "Move your mouse to the station and click the arrow to move",
    ];
  }

  if (state.currentStationId === "finchley-road" && state.selectedLineId !== "metropolitan") {
    return [
      touch
        ? "Tap the left or right side of the screen to switch lines"
        : "Press A or D to switch lines",
      "Switch to the Metropolitan line",
    ];
  }

  if (state.currentStationId === "regent-s-park" && state.selectedLineId !== "bakerloo") {
    return [
      touch
        ? "Tap the left or right side of the screen to switch lines"
        : "Press A or D to switch lines",
      "Switch to the Bakerloo line",
    ];
  }

  if (["finchley-road", "regent-s-park"].includes(state.currentStationId)) {
    return [
      touch
        ? "Swipe diagonally to move"
        : "Move your mouse to the station and click the arrow to move",
    ];
  }

  return [
    touch
      ? "Swipe down to move"
      : "Move your mouse to the station and click the arrow to move",
  ];
}
