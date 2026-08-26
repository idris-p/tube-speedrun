export const REJECTED_MOVE_FLASH_MS = 180;
export const TOUCH_MOVE_STUB_FEEDBACK_MS = 100;
export const COUNTDOWN_STEP_MS = 700;
export const COUNTDOWN_START_VALUE = 3;
export const LINE_REVEAL_ANIMATION_DURATION_MS = 160;
export const LINE_SWITCH_CAMERA_PAN_DURATION_MS = 160;
export const LINE_SWITCH_CAMERA_PAN_SPEED = 1 / LINE_SWITCH_CAMERA_PAN_DURATION_MS;

export function getLinearAnimationProgress(startedAt: number, now: number, durationMs: number): number {
  return Math.max(0, Math.min(1, (now - startedAt) / durationMs));
}
