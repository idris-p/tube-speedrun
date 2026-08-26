import type { GameState } from "./GameState";
import type { RunResults, RunState } from "./RunState";

export type MenuPhase = {
  readonly kind: "menu";
};

export type MapPhase = {
  readonly kind: "map";
};

export type CountdownPhase = {
  readonly kind: "countdown";
  readonly run: RunState;
  readonly startedAt: number;
};

export type GameplayPhase = {
  readonly kind: "gameplay";
  readonly state: GameState;
  readonly run: RunState | null;
  readonly tutorial: boolean;
};

export type ResultsPhase = {
  readonly kind: "results";
  readonly results: RunResults;
};

export type AppPhase = MenuPhase | MapPhase | CountdownPhase | GameplayPhase | ResultsPhase;

export function getGameplayPhase(phase: AppPhase): GameplayPhase | null {
  return phase.kind === "gameplay" ? phase : null;
}
