import { describe, expect, it } from "vitest";
import type { LineId } from "../data/types";
import { createGameState, type GameState } from "./GameState";
import { createJourneySummary, formatJourneyStationName } from "./journey";
import { attemptMove } from "./movement";
import type { NetworkData } from "../data/types";

const labelOffset = { x: 0, y: 0 };
const network: NetworkData = {
  temporary: true,
  notes: [],
  stations: [
    { id: "start", name: "Start", x: 0, y: 0, labelOffset, lines: ["bakerloo"] },
    { id: "middle", name: "Middle", x: 1, y: 0, labelOffset, lines: ["bakerloo"] },
    { id: "change-one", name: "Change One", x: 2, y: 0, labelOffset, lines: ["bakerloo", "jubilee"] },
    { id: "change-two", name: "Change Two", x: 4, y: 0, labelOffset, lines: ["jubilee", "metropolitan"] },
    { id: "end", name: "End", x: 6, y: 0, labelOffset, lines: ["metropolitan"] },
  ],
  connections: [
    { id: "bakerloo:start:middle", from: "start", to: "middle", line: "bakerloo", path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: "bakerloo:middle:change-one", from: "middle", to: "change-one", line: "bakerloo", path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
    { id: "jubilee:change-one:change-two", from: "change-one", to: "change-two", line: "jubilee", path: [{ x: 2, y: 0 }, { x: 4, y: 0 }] },
    { id: "metropolitan:change-two:end", from: "change-two", to: "end", line: "metropolitan", path: [{ x: 4, y: 0 }, { x: 6, y: 0 }] },
  ],
};

const walkingNetwork: NetworkData = {
  temporary: true,
  notes: [],
  stations: [
    { id: "start", name: "Start", x: 0, y: 0, labelOffset, lines: ["central", "walk"] },
    { id: "walked-to", name: "Walked To", x: 1, y: 0, labelOffset, lines: ["victoria", "walk"] },
    { id: "end", name: "End", x: 2, y: 0, labelOffset, lines: ["victoria"] },
  ],
  connections: [
    { id: "walk:start:walked-to", from: "start", to: "walked-to", line: "walk", path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: "victoria:walked-to:end", from: "walked-to", to: "end", line: "victoria", path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
  ],
};

function moveOnLine(
  state: ReturnType<typeof createGameState>,
  lineId: LineId,
  now: number,
): ReturnType<typeof createGameState> {
  return attemptMove({ ...state, selectedLineId: lineId }, network, 0, now).state;
}

describe("journey summary", () => {
  it("removes parenthetical qualifiers except from Kensington (Olympia)", () => {
    expect(formatJourneyStationName("Canary Wharf (Elizabeth line)")).toBe("Canary Wharf");
    expect(formatJourneyStationName("Hammersmith (Circle and Hammersmith & City)")).toBe("Hammersmith");
    expect(formatJourneyStationName("Kensington (Olympia)")).toBe("Kensington (Olympia)");
  });

  it("shows only the start, line-change stations, and destination", () => {
    let state: GameState = {
      ...createGameState("journey", network, 0),
      startStationId: "start",
      destinationStationId: "end",
      currentStationId: "start",
    };
    state = moveOnLine(state, "bakerloo", 100);
    state = moveOnLine(state, "bakerloo", 200);
    state = moveOnLine(state, "jubilee", 300);
    state = moveOnLine(state, "metropolitan", 400);

    expect(createJourneySummary(state)).toEqual({
      stops: [
        { stationId: "start", kind: "start" },
        { stationId: "change-one", kind: "interchange" },
        { stationId: "change-two", kind: "interchange" },
        { stationId: "end", kind: "destination" },
      ],
      segments: [
        { lineId: "bakerloo" },
        { lineId: "jubilee" },
        { lineId: "metropolitan" },
      ],
    });
    expect(state.changeCount).toBe(2);
  });

  it("does not add intermediate stations when the line stays the same", () => {
    const state = {
      ...createGameState("direct", network, 0),
      startStationId: "start",
      destinationStationId: "change-one",
      currentStationId: "start",
    };
    const middle = moveOnLine(state, "bakerloo", 100);
    const completed = moveOnLine(middle, "bakerloo", 200);

    expect(createJourneySummary(completed)).toEqual({
      stops: [
        { stationId: "start", kind: "start" },
        { stationId: "change-one", kind: "destination" },
      ],
      segments: [{ lineId: "bakerloo" }],
    });
  });

  it("includes a walking section and the station where the player boards a line", () => {
    let state: GameState = {
      ...createGameState("walking", walkingNetwork, 0),
      startStationId: "start",
      destinationStationId: "end",
      currentStationId: "start",
      selectedLineId: "walk" as const,
    };
    state = attemptMove(state, walkingNetwork, 0, 100).state;
    state = attemptMove({ ...state, selectedLineId: "victoria" }, walkingNetwork, 0, 200).state;

    expect(createJourneySummary(state)).toEqual({
      stops: [
        { stationId: "start", kind: "start" },
        { stationId: "walked-to", kind: "interchange" },
        { stationId: "end", kind: "destination" },
      ],
      segments: [
        { lineId: "walk" },
        { lineId: "victoria" },
      ],
    });
  });
});
