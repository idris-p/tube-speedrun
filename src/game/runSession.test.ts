import { describe, expect, it } from "vitest";
import { networkData } from "../data/network";
import { createGameStateForRound } from "./GameState";
import { ROUND_COUNT } from "./RunState";
import { advanceRun, createRunState, upsertRoundStats } from "./runSession";

describe("run session", () => {
  it("creates the same five deterministic rounds for a seed", () => {
    const first = createRunState("run-session-seed", "set", networkData);
    const second = createRunState("run-session-seed", "set", networkData);

    expect(first.rounds).toHaveLength(ROUND_COUNT);
    expect(first.rounds).toEqual(second.rounds);
    expect(first.currentRoundIndex).toBe(0);
    expect(first.completedRoundStats).toEqual([]);
  });

  it("records a completed round and advances without mutating the run", () => {
    const run = createRunState("advance-seed", "random", networkData);
    const game = createGameStateForRound(run.seed, run.rounds[0], networkData, 100);
    const completed = { ...game, completed: true, endTime: 350, moveCount: 4, changeCount: 2 };
    const next = advanceRun(run, completed, 999);

    expect(next).toMatchObject({
      type: "next-round",
      run: {
        currentRoundIndex: 1,
        completedRoundStats: [{ roundNumber: 1, timeMs: 250, moves: 4, lineChanges: 2 }],
      },
    });
    expect(run.currentRoundIndex).toBe(0);
    expect(run.completedRoundStats).toEqual([]);
  });

  it("produces results after the fifth completed round", () => {
    const initial = createRunState("results-seed", "set", networkData);
    const run = {
      ...initial,
      currentRoundIndex: ROUND_COUNT - 1,
      completedRoundStats: Array.from({ length: ROUND_COUNT - 1 }, (_, index) => ({
        roundNumber: index + 1,
        timeMs: 100,
        moves: 1,
        lineChanges: 0,
      })),
    };
    const game = createGameStateForRound(run.seed, run.rounds[ROUND_COUNT - 1], networkData, 500);
    const next = advanceRun(run, { ...game, completed: true, endTime: 700 }, 900);

    expect(next.type).toBe("results");
    if (next.type === "results") {
      expect(next.results.roundStats).toHaveLength(ROUND_COUNT);
      expect(next.results.roundStats.at(-1)?.timeMs).toBe(200);
    }
  });

  it("replaces duplicate round statistics in place", () => {
    expect(upsertRoundStats(
      [{ roundNumber: 1, timeMs: 10, moves: 1, lineChanges: 0 }],
      { roundNumber: 1, timeMs: 20, moves: 2, lineChanges: 1 },
    )).toEqual([{ roundNumber: 1, timeMs: 20, moves: 2, lineChanges: 1 }]);
  });
});
