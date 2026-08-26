import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_START_VALUE,
  COUNTDOWN_STEP_MS,
  getLinearAnimationProgress,
  LINE_REVEAL_ANIMATION_DURATION_MS,
  LINE_SWITCH_CAMERA_PAN_DURATION_MS,
  REJECTED_MOVE_FLASH_MS,
  TOUCH_MOVE_STUB_FEEDBACK_MS,
} from "./timings";

describe("gameplay timings", () => {
  it("locks the player-facing timing constants", () => {
    expect(COUNTDOWN_START_VALUE).toBe(3);
    expect(COUNTDOWN_STEP_MS).toBe(700);
    expect(LINE_REVEAL_ANIMATION_DURATION_MS).toBe(160);
    expect(LINE_SWITCH_CAMERA_PAN_DURATION_MS).toBe(160);
    expect(REJECTED_MOVE_FLASH_MS).toBe(180);
    expect(TOUCH_MOVE_STUB_FEEDBACK_MS).toBe(100);
  });

  it("clamps progress before, during, and after an animation", () => {
    expect(getLinearAnimationProgress(100, 99, 160)).toBe(0);
    expect(getLinearAnimationProgress(100, 180, 160)).toBe(0.5);
    expect(getLinearAnimationProgress(100, 260, 160)).toBe(1);
    expect(getLinearAnimationProgress(100, 300, 160)).toBe(1);
  });
});
