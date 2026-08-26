import { describe, expect, it } from "vitest";
import { networkData } from "../data/network";
import { AppController } from "./AppController";
import { ROUND_COUNT } from "./RunState";

describe("application controller", () => {
  it("moves atomically from menu through countdown into gameplay", () => {
    const app = new AppController(networkData);
    app.startRun("controller-seed", "set", 100);
    expect(app.phase).toMatchObject({ kind: "countdown", startedAt: 100 });
    expect(app.completeCountdown(2_200)).toBe(true);
    expect(app.phase).toMatchObject({
      kind: "gameplay",
      tutorial: false,
      state: { seed: "controller-seed", startTime: 2_200 },
    });
  });

  it("keeps tutorial state separate from a run", () => {
    const app = new AppController(networkData);
    app.startTutorial(50);
    expect(app.phase).toMatchObject({ kind: "gameplay", tutorial: true, run: null });
    app.showMenu();
    expect(app.phase).toEqual({ kind: "menu" });
  });

  it("advances completed rounds and produces results after round five", () => {
    const app = new AppController(networkData);
    app.startRun("five-round-controller", "random", 0);
    for (let round = 0; round < ROUND_COUNT; round += 1) {
      expect(app.completeCountdown(round * 1_000)).toBe(true);
      const gameplay = app.gameplay;
      expect(gameplay).not.toBeNull();
      app.setGameplayState({
        ...gameplay!.state,
        completed: true,
        endTime: round * 1_000 + 100,
      });
      app.advanceCompletedRound(round * 1_000 + 100);
    }
    expect(app.phase.kind).toBe("results");
    if (app.phase.kind === "results") {
      expect(app.phase.results.roundStats).toHaveLength(ROUND_COUNT);
    }
  });
});
