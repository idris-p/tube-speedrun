import type { LineId, NetworkData } from "../data/types";
import type { RoundConfig } from "./RunState";
import { pickStartAndDestination } from "./seed";

export type GameState = {
  seed: string;
  startStationId: string;
  destinationStationId: string;
  currentStationId: string;
  selectedLineId: LineId;
  enteredStationLineId: LineId | null;
  revealedConnections: Set<string>;
  journeyLegs: JourneyLeg[];
  moveCount: number;
  changeCount: number;
  startTime: number;
  endTime: number | null;
  completed: boolean;
  rejectedMoveAt: number | null;
};

export type JourneyLeg = {
  fromStationId: string;
  toStationId: string;
  lineId: LineId;
};

export function createGameState(seed: string, network: NetworkData, now: number): GameState {
  const selection = pickStartAndDestination(seed, network);
  return createGameStateForRound(seed, selection, network, now);
}

export function createGameStateForRound(
  seed: string,
  selection: RoundConfig,
  network: NetworkData,
  now: number,
): GameState {
  const startStation = network.stations.find((station) => station.id === selection.startStationId);

  if (!startStation || startStation.lines.length === 0) {
    throw new Error(`Seed selected invalid start station: ${selection.startStationId}`);
  }

  return {
    seed,
    startStationId: selection.startStationId,
    destinationStationId: selection.destinationStationId,
    currentStationId: selection.startStationId,
    selectedLineId: startStation.lines[0],
    enteredStationLineId: null,
    revealedConnections: new Set<string>(),
    journeyLegs: [],
    moveCount: 0,
    changeCount: 0,
    startTime: now,
    endTime: null,
    completed: false,
    rejectedMoveAt: null,
  };
}

export function getElapsedMilliseconds(state: GameState, now: number): number {
  return Math.max(0, (state.endTime ?? now) - state.startTime);
}
