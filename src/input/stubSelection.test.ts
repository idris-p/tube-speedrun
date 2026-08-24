import { describe, expect, it } from "vitest";
import {
  beginStubSelection,
  createStubSelectionState,
  dragStubSelection,
  releaseStubSelection,
} from "./stubSelection";

describe("direction stub press and drag selection", () => {
  it("moves using the stub selected when the pointer is released", () => {
    let selection = beginStubSelection(7, "east");
    selection = dragStubSelection(selection, 7, "north");

    expect(releaseStubSelection(selection, 7).direction).toBe("north");
  });

  it("retains the last selected stub while dragging through empty map space", () => {
    const selection = dragStubSelection(
      beginStubSelection(7, "east"),
      7,
      null,
    );

    expect(releaseStubSelection(selection, 7).direction).toBe("east");
  });

  it("ignores movement and release events from other pointers", () => {
    const initial = beginStubSelection(7, "east");
    const dragged = dragStubSelection(initial, 9, "west");
    const released = releaseStubSelection(dragged, 9);

    expect(dragged).toBe(initial);
    expect(released).toEqual({ state: initial, direction: null });
  });

  it("starts with no active pointer or direction", () => {
    expect(createStubSelectionState()).toEqual({ pointerId: null, direction: null });
  });
});
