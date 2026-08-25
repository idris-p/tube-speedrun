import { describe, expect, it } from "vitest";
import { getStubHitDistance, getStubPathHitDistance, isPointInPolygon } from "./stubHitTesting";

describe("direction stub hit testing", () => {
  it("chooses the centreline closest to the pointer when hit areas overlap", () => {
    const point = { x: 28, y: 2 };

    expect(getStubHitDistance(point, { x: 16, y: 0 }, { x: 58, y: 0 })).toBe(2);
    expect(
      getStubHitDistance(point, { x: 12, y: -12 }, { x: 41, y: -41 }),
    ).toBeGreaterThan(2);
  });

  it("does not extend a hit area backwards across the station centre", () => {
    const pointOnEastStub = { x: 20, y: 0 };

    expect(getStubHitDistance(pointOnEastStub, { x: 16, y: 0 }, { x: 58, y: 0 })).toBe(0);
    expect(getStubHitDistance(pointOnEastStub, { x: -16, y: 0 }, { x: -58, y: 0 })).toBeNull();
  });

  it("measures against each section of a curved stub path", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ];

    expect(getStubPathHitDistance({ x: 25, y: 5 }, path)).toBe(0);
    expect(getStubPathHitDistance({ x: 25, y: 0 }, path)).toBeCloseTo(Math.sqrt(12.5));
  });

  it("recognises clicks inside a visible arrowhead wing", () => {
    const arrowHead = [
      { x: 44, y: 0 },
      { x: 30, y: 13 },
      { x: 19, y: 13 },
      { x: 28, y: 5 },
      { x: 28, y: -5 },
      { x: 19, y: -13 },
      { x: 30, y: -13 },
    ];

    expect(isPointInPolygon({ x: 25, y: 10 }, arrowHead)).toBe(true);
    expect(isPointInPolygon({ x: 15, y: 10 }, arrowHead)).toBe(false);
  });
});
