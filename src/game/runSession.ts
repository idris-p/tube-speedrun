import type { NetworkData } from "../data/types";
import type { GameState } from "./GameState";
import { getElapsedMilliseconds } from "./GameState";
import { ROUND_COUNT, type RoundStats, type RunResults, type RunState } from "./RunState";
import { generateRoundConfigs } from "./seed";

export type RunAdvance =
  | { readonly type: "next-round"; readonly run: RunState }
  | { readonly type: "results"; readonly results: RunResults };

export function createRunState(
  seed: string,
  seedSource: RunState["seedSource"],
  network: NetworkData,
): RunState {
  return {
    seed,
    seedSource,
    rounds: generateRoundConfigs(seed, network),
    currentRoundIndex: 0,
    completedRoundStats: [],
  };
}

export function getRoundStats(run: RunState, completedState: GameState, now: number): RoundStats {
  return {
    roundNumber: run.currentRoundIndex + 1,
    timeMs: getElapsedMilliseconds(completedState, completedState.endTime ?? now),
    moves: completedState.moveCount,
    lineChanges: completedState.changeCount,
  };
}

export function upsertRoundStats(stats: readonly RoundStats[], next: RoundStats): RoundStats[] {
  const existingIndex = stats.findIndex((candidate) => candidate.roundNumber === next.roundNumber);
  if (existingIndex < 0) {
    return [...stats, next];
  }

  return stats.map((candidate, index) => index === existingIndex ? next : candidate);
}

export function advanceRun(run: RunState, completedState: GameState, now: number): RunAdvance {
  if (!completedState.completed) {
    throw new Error("Cannot advance a run from an incomplete round.");
  }

  const completedRoundStats = upsertRoundStats(
    run.completedRoundStats,
    getRoundStats(run, completedState, now),
  );
  if (run.currentRoundIndex >= ROUND_COUNT - 1) {
    return {
      type: "results",
      results: {
        seed: run.seed,
        seedSource: run.seedSource,
        rounds: run.rounds,
        roundStats: completedRoundStats,
      },
    };
  }

  return {
    type: "next-round",
    run: {
      ...run,
      currentRoundIndex: run.currentRoundIndex + 1,
      completedRoundStats,
    },
  };
}
