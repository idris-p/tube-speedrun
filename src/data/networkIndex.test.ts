import { describe, expect, it } from "vitest";
import { createConnectionId, networkData } from "./network";
import { createNetworkIndex, getNetworkIndex } from "./networkIndex";

describe("network index", () => {
  it("preserves source connection order for each station", () => {
    const index = createNetworkIndex(networkData);

    for (const station of networkData.stations) {
      const expected = networkData.connections.filter(
        (connection) => connection.from === station.id || connection.to === station.id,
      );
      expect(index.connectionsByStation.get(station.id)).toEqual(expected);
    }
  });

  it("excludes reverse traversal of one-way connections without changing distance neighbours", () => {
    const index = createNetworkIndex(networkData);
    const terminalFour = index.outgoingConnectionsByStation.get("heathrow-terminal-4") ?? [];
    const terminalTwoAndThree = index.outgoingConnectionsByStation.get("heathrow-terminal-2-and-3") ?? [];
    const loopConnectionId = createConnectionId(
      "piccadilly",
      "heathrow-terminal-4",
      "heathrow-terminal-2-and-3",
    );

    expect(terminalFour.some((connection) => connection.id === loopConnectionId)).toBe(true);
    expect(terminalTwoAndThree.some((connection) => connection.id === loopConnectionId)).toBe(false);
    expect(index.neighbourIdsByStation.get("heathrow-terminal-2-and-3"))
      .toContain("heathrow-terminal-4");
  });

  it("reuses the immutable index for the same network", () => {
    expect(getNetworkIndex(networkData)).toBe(getNetworkIndex(networkData));
  });
});
