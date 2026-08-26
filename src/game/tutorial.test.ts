import { describe, expect, it } from "vitest";
import { createConnectionId, networkData } from "../data/network";
import { getConnectionFirstStepDirection } from "./movement";
import {
  attemptTutorialMoveInDirection,
  createTutorialGameState,
  getTutorialInstructions,
  TUTORIAL_CONNECTION_IDS,
} from "./tutorial";

describe("interactive tutorial", () => {
  it("starts at Stanmore on Jubilee with Oxford Circus as the destination", () => {
    const state = createTutorialGameState(networkData, 100);

    expect(state.currentStationId).toBe("stanmore");
    expect(state.selectedLineId).toBe("jubilee");
    expect(state.destinationStationId).toBe("oxford-circus");
    expect(state.revealedConnections.size).toBe(0);
  });

  it("allows every connection in the fixed route in both directions", () => {
    expect(TUTORIAL_CONNECTION_IDS.size).toBe(8);
    for (const connectionId of TUTORIAL_CONNECTION_IDS) {
      expect(networkData.connections.some((connection) => connection.id === connectionId)).toBe(true);
    }
    expect(TUTORIAL_CONNECTION_IDS.has(
      createConnectionId("metropolitan", "wembley-park", "finchley-road"),
    )).toBe(true);
    expect(TUTORIAL_CONNECTION_IDS.has(
      createConnectionId("bakerloo", "regent-s-park", "oxford-circus"),
    )).toBe(true);
  });

  it("blocks the Jubilee route from Wembley Park towards Neasden", () => {
    const base = createTutorialGameState(networkData, 100);
    const state = {
      ...base,
      currentStationId: "wembley-park",
      selectedLineId: "jubilee" as const,
    };
    const connection = networkData.connections.find((candidate) =>
      candidate.line === "jubilee" &&
      candidate.from === "neasden" &&
      candidate.to === "wembley-park"
    );
    expect(connection).toBeDefined();
    const direction = getConnectionFirstStepDirection(connection!, "wembley-park");
    expect(direction).not.toBeNull();

    const result = attemptTutorialMoveInDirection(state, networkData, direction!, 200);

    expect(result.moved).toBe(false);
    expect(result.state.currentStationId).toBe("wembley-park");
  });

  it("supports the complete route and backwards movement", () => {
    let state = createTutorialGameState(networkData, 100);
    const route = [
      { lineId: "jubilee" as const, to: "canons-park" },
      { lineId: "jubilee" as const, to: "queensbury" },
      { lineId: "jubilee" as const, to: "kingsbury" },
      { lineId: "jubilee" as const, to: "wembley-park" },
      { lineId: "metropolitan" as const, to: "finchley-road" },
      { lineId: "metropolitan" as const, to: "baker-street" },
      { lineId: "bakerloo" as const, to: "regent-s-park" },
      { lineId: "bakerloo" as const, to: "oxford-circus" },
    ];

    for (const [index, leg] of route.entries()) {
      state = { ...state, selectedLineId: leg.lineId };
      const connection = networkData.connections.find((candidate) =>
        candidate.id === createConnectionId(leg.lineId, state.currentStationId, leg.to)
      );
      expect(connection).toBeDefined();
      const direction = getConnectionFirstStepDirection(connection!, state.currentStationId);
      expect(direction).not.toBeNull();
      const result = attemptTutorialMoveInDirection(state, networkData, direction!, 200 + index);
      expect(result.moved).toBe(true);
      state = result.state;

      if (leg.to === "canons-park") {
        const backwardDirection = getConnectionFirstStepDirection(connection!, "canons-park");
        const backward = attemptTutorialMoveInDirection(
          state,
          networkData,
          backwardDirection!,
          300,
        );
        expect(backward.moved).toBe(true);
        expect(backward.state.currentStationId).toBe("stanmore");
      }
    }

    expect(state.currentStationId).toBe("oxford-circus");
    expect(state.completed).toBe(true);
    expect(state.moveCount).toBe(8);
  });

  it("provides platform-specific line-switching instructions at Baker Street", () => {
    const base = createTutorialGameState(networkData, 100);
    const state = {
      ...base,
      currentStationId: "baker-street",
      selectedLineId: "metropolitan" as const,
    };

    expect(getTutorialInstructions(state, false)).toEqual([
      "Press A or D to switch lines",
      "Switch to the Bakerloo line",
    ]);
    expect(getTutorialInstructions(state, true)).toEqual([
      "Tap the left or right side of the screen to switch lines",
      "Switch to the Bakerloo line",
    ]);
  });
});
