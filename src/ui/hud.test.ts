import { describe, expect, it } from "vitest";
import { networkData } from "../data/network";
import { createMapSearchEntries, filterMapSearchEntries, findMapSearchStationId } from "./hud";

describe("map station search", () => {
  const entries = createMapSearchEntries(networkData);

  it("finds stations by their full or unique partial name", () => {
    expect(findMapSearchStationId(entries, "Oxford Circus")).toBe("oxford-circus");
    expect(findMapSearchStationId(entries, "Tottenham Court")).toBe("tottenham-court-road");
  });

  it("keeps duplicate station names distinguishable by line", () => {
    expect(findMapSearchStationId(entries, "Hammersmith")).toBeNull();
    expect(findMapSearchStationId(entries, "Hammersmith (District and Piccadilly)")).toBe(
      "hammersmith-district-and-piccadilly",
    );
    expect(findMapSearchStationId(entries, "Hammersmith (Circle and Hammersmith & City)")).toBe(
      "hammersmith-circle-and-hammersmith-and-city",
    );
  });

  it("lists every station when empty and filters the custom dropdown as the player types", () => {
    expect(filterMapSearchEntries(entries, "")).toHaveLength(networkData.stations.length);
    expect(filterMapSearchEntries(entries, "Oxford").map((entry) => entry.stationId)).toEqual([
      "oxford-circus",
    ]);
  });
});
