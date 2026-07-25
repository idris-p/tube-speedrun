import { describe, expect, it } from "vitest";
import {
  TARGET_ARRIVAL_CELEBRATION_MS,
  advanceCompletionCelebration,
  createCompletionCelebration,
} from "./completionCelebration";

describe("target arrival celebration", () => {
  it("waits for the final movement reveal before starting", () => {
    const pending = createCompletionCelebration();
    expect(advanceCompletionCelebration(pending, true, 100)).toEqual({
      celebration: pending,
      changed: false,
    });
    expect(advanceCompletionCelebration(pending, false, 160)).toEqual({
      celebration: { startedAt: 160 },
      changed: true,
    });
  });

  it("finishes only after the pause and two label pulses", () => {
    const running = { startedAt: 200 };
    expect(advanceCompletionCelebration(
      running,
      false,
      200 + TARGET_ARRIVAL_CELEBRATION_MS - 1,
    )).toEqual({ celebration: running, changed: false });
    expect(advanceCompletionCelebration(
      running,
      false,
      200 + TARGET_ARRIVAL_CELEBRATION_MS,
    )).toEqual({ celebration: null, changed: true });
  });
});
