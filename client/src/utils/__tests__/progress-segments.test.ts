import { describe, it, expect } from "vitest";
import { getProgressSegments } from "../progress-segments";

const CIRCUMFERENCE = 2 * Math.PI * 40; // ~251.33

describe("getProgressSegments", () => {
  it("returns three segments (Done, In Progress, Planned) for normal inputs", () => {
    const segments = getProgressSegments(10, 4, 3, CIRCUMFERENCE);

    expect(segments).toHaveLength(3);
    expect(segments[0].label).toBe("Done");
    expect(segments[1].label).toBe("In Progress");
    expect(segments[2].label).toBe("Planned");
  });

  it("computes correct counts for each segment", () => {
    const segments = getProgressSegments(10, 4, 3, CIRCUMFERENCE);

    expect(segments[0].count).toBe(4);
    expect(segments[1].count).toBe(3);
    expect(segments[2].count).toBe(3); // 10 - 4 - 3
  });

  it("dashLength values sum to the full circumference", () => {
    const segments = getProgressSegments(10, 4, 3, CIRCUMFERENCE);
    const totalDash = segments.reduce((sum, s) => sum + s.dashLength, 0);

    expect(totalDash).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it("computes correct dashLength for each segment", () => {
    const segments = getProgressSegments(10, 4, 3, CIRCUMFERENCE);

    expect(segments[0].dashLength).toBeCloseTo((4 / 10) * CIRCUMFERENCE, 5);
    expect(segments[1].dashLength).toBeCloseTo((3 / 10) * CIRCUMFERENCE, 5);
    expect(segments[2].dashLength).toBeCloseTo((3 / 10) * CIRCUMFERENCE, 5);
  });

  it("lays out segments sequentially via dashOffset", () => {
    const segments = getProgressSegments(10, 4, 3, CIRCUMFERENCE);

    expect(segments[0].dashOffset).toBeCloseTo(0, 5);
    expect(segments[1].dashOffset).toBeCloseTo(-segments[0].dashLength, 5);
    expect(segments[2].dashOffset).toBeCloseTo(
      -(segments[0].dashLength + segments[1].dashLength),
      5,
    );
  });

  it("handles total === 0 gracefully with a single Remaining segment", () => {
    const segments = getProgressSegments(0, 0, 0, CIRCUMFERENCE);

    expect(segments).toHaveLength(1);
    expect(segments[0].label).toBe("Remaining");
    expect(segments[0].dashLength).toBe(CIRCUMFERENCE);
    expect(segments[0].dashOffset).toBe(0);
  });

  it("handles all tasks completed", () => {
    const segments = getProgressSegments(5, 5, 0, CIRCUMFERENCE);

    expect(segments[0].count).toBe(5);
    expect(segments[0].dashLength).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(segments[1].count).toBe(0);
    expect(segments[2].count).toBe(0);
  });

  it("assigns distinct colors to each segment", () => {
    const segments = getProgressSegments(10, 3, 3, CIRCUMFERENCE);
    const colors = segments.map((s) => s.color);
    const uniqueColors = new Set(colors);

    expect(uniqueColors.size).toBe(3);
  });
});
