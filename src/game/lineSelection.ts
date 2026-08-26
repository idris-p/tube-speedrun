import type { LineId, NetworkData } from "../data/types";
import { getNetworkIndex } from "../data/networkIndex";
import type { GameState } from "./GameState";

export type LineCyclePreview = {
  previous: LineId;
  current: LineId;
  next: LineId;
  lineCount: number;
};

export function cycleSelectedLine(state: GameState, network: NetworkData, offset: -1 | 1): GameState {
  if (state.completed) {
    return state;
  }

  const station = getNetworkIndex(network).stationById.get(state.currentStationId);
  if (!station || station.lines.length === 0) {
    return state;
  }

  const currentIndex = Math.max(0, station.lines.indexOf(state.selectedLineId));
  const nextIndex = (currentIndex + offset + station.lines.length) % station.lines.length;

  return {
    ...state,
    selectedLineId: station.lines[nextIndex],
  };
}

export function getLineCyclePreview(state: GameState, network: NetworkData): LineCyclePreview | null {
  const station = getNetworkIndex(network).stationById.get(state.currentStationId);
  if (!station || station.lines.length === 0) {
    return null;
  }

  const currentIndex = Math.max(0, station.lines.indexOf(state.selectedLineId));
  const previousIndex = (currentIndex - 1 + station.lines.length) % station.lines.length;
  const nextIndex = (currentIndex + 1) % station.lines.length;

  return {
    previous: station.lines[previousIndex],
    current: station.lines[currentIndex],
    next: station.lines[nextIndex],
    lineCount: station.lines.length,
  };
}
