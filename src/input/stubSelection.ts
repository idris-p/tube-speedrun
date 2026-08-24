import type { MovementDirection } from "../game/movement";

export type StubSelectionState = {
  pointerId: number | null;
  direction: MovementDirection | null;
};

export function createStubSelectionState(): StubSelectionState {
  return { pointerId: null, direction: null };
}

export function beginStubSelection(
  pointerId: number,
  direction: MovementDirection,
): StubSelectionState {
  return { pointerId, direction };
}

export function dragStubSelection(
  state: StubSelectionState,
  pointerId: number,
  hoveredDirection: MovementDirection | null,
): StubSelectionState {
  if (state.pointerId !== pointerId || hoveredDirection === null) {
    return state;
  }
  return { ...state, direction: hoveredDirection };
}

export function releaseStubSelection(
  state: StubSelectionState,
  pointerId: number,
): { state: StubSelectionState; direction: MovementDirection | null } {
  if (state.pointerId !== pointerId) {
    return { state, direction: null };
  }
  return {
    state: createStubSelectionState(),
    direction: state.direction,
  };
}
