import type { LineId } from "../data/types";
import type { GameState } from "./GameState";

export type JourneySummaryStop = {
  stationId: string;
  kind: "start" | "interchange" | "destination";
};

export type JourneySummarySegment = {
  lineId: LineId;
};

export type JourneySummary = {
  stops: JourneySummaryStop[];
  segments: JourneySummarySegment[];
};

export function formatJourneyStationName(stationName: string): string {
  if (stationName === "Kensington (Olympia)") {
    return stationName;
  }

  return stationName.replace(/\s*\([^)]*\)/g, "").trim();
}

export function isCountedLineChange(previousLineId: LineId, nextLineId: LineId): boolean {
  return previousLineId !== nextLineId && !(previousLineId !== "walk" && nextLineId === "walk");
}

export function createJourneySummary(state: GameState): JourneySummary {
  const firstLineId = state.journeyLegs[0]?.lineId ?? state.selectedLineId;
  const stops: JourneySummaryStop[] = [
    { stationId: state.startStationId, kind: "start" },
  ];
  const segments: JourneySummarySegment[] = [];
  let displayedLineId = firstLineId;

  for (let index = 1; index < state.journeyLegs.length; index += 1) {
    const previousLeg = state.journeyLegs[index - 1];
    const leg = state.journeyLegs[index];
    if (previousLeg.lineId === leg.lineId) {
      continue;
    }

    segments.push({ lineId: displayedLineId });
    stops.push({ stationId: leg.fromStationId, kind: "interchange" });
    displayedLineId = leg.lineId;
  }

  segments.push({ lineId: displayedLineId });
  stops.push({ stationId: state.destinationStationId, kind: "destination" });

  return { stops, segments };
}
