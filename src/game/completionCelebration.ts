export const TARGET_ARRIVAL_CELEBRATION_MS = 1_080;

export type CompletionCelebration = {
  startedAt: number | null;
};

export function createCompletionCelebration(): CompletionCelebration {
  return { startedAt: null };
}

export function advanceCompletionCelebration(
  celebration: CompletionCelebration | null,
  movementAnimationActive: boolean,
  now: number,
): { celebration: CompletionCelebration | null; changed: boolean } {
  if (!celebration) {
    return { celebration: null, changed: false };
  }
  if (celebration.startedAt === null) {
    return movementAnimationActive
      ? { celebration, changed: false }
      : { celebration: { startedAt: now }, changed: true };
  }
  if (now - celebration.startedAt >= TARGET_ARRIVAL_CELEBRATION_MS) {
    return { celebration: null, changed: true };
  }
  return { celebration, changed: false };
}
