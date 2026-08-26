import type { NetworkData } from "../data/types";
import type { AppPhase, GameplayPhase } from "./AppPhase";
import { createGameStateForRound, type GameState } from "./GameState";
import type { RunState } from "./RunState";
import { advanceRun, createRunState } from "./runSession";
import { createTutorialGameState } from "./tutorial";

export class AppController {
  private currentPhase: AppPhase = { kind: "menu" };

  constructor(private readonly network: NetworkData) {}

  get phase(): AppPhase {
    return this.currentPhase;
  }

  showMenu(): void {
    this.currentPhase = { kind: "menu" };
  }

  showMap(): void {
    this.currentPhase = { kind: "map" };
  }

  startRun(seed: string, seedSource: RunState["seedSource"], now: number): void {
    this.currentPhase = {
      kind: "countdown",
      run: createRunState(seed, seedSource, this.network),
      startedAt: now,
    };
  }

  startTutorial(now: number): void {
    this.currentPhase = {
      kind: "gameplay",
      state: createTutorialGameState(this.network, now),
      run: null,
      tutorial: true,
    };
  }

  completeCountdown(now: number): boolean {
    if (this.currentPhase.kind !== "countdown") return false;
    const { run } = this.currentPhase;
    this.currentPhase = {
      kind: "gameplay",
      state: createGameStateForRound(
        run.seed,
        run.rounds[run.currentRoundIndex],
        this.network,
        now,
      ),
      run,
      tutorial: false,
    };
    return true;
  }

  advanceCompletedRound(now: number): AppPhase {
    const gameplay = this.gameplay;
    if (!gameplay?.state.completed || !gameplay.run) return this.currentPhase;
    const next = advanceRun(gameplay.run, gameplay.state, now);
    this.currentPhase = next.type === "results"
      ? { kind: "results", results: next.results }
      : { kind: "countdown", run: next.run, startedAt: now };
    return this.currentPhase;
  }

  setGameplayState(state: GameState): void {
    const gameplay = this.gameplay;
    if (!gameplay) throw new Error("Cannot update gameplay state outside gameplay.");
    this.currentPhase = { ...gameplay, state };
  }

  get gameplay(): GameplayPhase | null {
    return this.currentPhase.kind === "gameplay" ? this.currentPhase : null;
  }
}
