import { describe, it, expect } from "vitest";
import {
  linearRegressionSlope,
  classifyTrend,
  estimationAccuracy,
} from "../trend-analysis.js";

describe("linearRegressionSlope", () => {
  it("returns 0 for an empty array", () => {
    expect(linearRegressionSlope([])).toBe(0);
  });

  it("returns 0 for a single element", () => {
    expect(linearRegressionSlope([5])).toBe(0);
  });

  it("computes a positive slope for increasing values", () => {
    // y = 2x: points (0,0), (1,2), (2,4), (3,6)
    const slope = linearRegressionSlope([0, 2, 4, 6]);
    expect(slope).toBeCloseTo(2, 5);
  });

  it("computes a negative slope for decreasing values", () => {
    // y = -3x + 9: points (0,9), (1,6), (2,3), (3,0)
    const slope = linearRegressionSlope([9, 6, 3, 0]);
    expect(slope).toBeCloseTo(-3, 5);
  });

  it("returns 0 for flat values", () => {
    const slope = linearRegressionSlope([5, 5, 5, 5]);
    expect(slope).toBeCloseTo(0, 5);
  });

  it("computes correct slope for two points", () => {
    // (0, 1) and (1, 3) → slope = 2
    const slope = linearRegressionSlope([1, 3]);
    expect(slope).toBeCloseTo(2, 5);
  });

  it("handles non-perfect linear data", () => {
    // Roughly increasing: slope should be positive
    const slope = linearRegressionSlope([1, 3, 2, 5, 4, 7]);
    expect(slope).toBeGreaterThan(0);
  });
});

describe("classifyTrend", () => {
  it("returns 'Improving' for a slope above the default threshold", () => {
    expect(classifyTrend(0.05)).toBe("Improving");
  });

  it("returns 'Declining' for a slope below the negative default threshold", () => {
    expect(classifyTrend(-0.05)).toBe("Declining");
  });

  it("returns 'Stable' for a slope within the default threshold", () => {
    expect(classifyTrend(0.005)).toBe("Stable");
    expect(classifyTrend(-0.005)).toBe("Stable");
    expect(classifyTrend(0)).toBe("Stable");
  });

  it("returns 'Stable' for a slope exactly at the threshold boundary", () => {
    // slope === threshold is NOT > threshold, so it's Stable
    expect(classifyTrend(0.01)).toBe("Stable");
    expect(classifyTrend(-0.01)).toBe("Stable");
  });

  it("uses a custom threshold when provided", () => {
    expect(classifyTrend(0.5, 1.0)).toBe("Stable");
    expect(classifyTrend(1.5, 1.0)).toBe("Improving");
    expect(classifyTrend(-1.5, 1.0)).toBe("Declining");
  });
});

describe("estimationAccuracy", () => {
  it("returns 1 when actual equals estimated (perfect accuracy)", () => {
    expect(estimationAccuracy(30, 30)).toBe(1);
  });

  it("returns 0 when estimated is 0", () => {
    expect(estimationAccuracy(0, 10)).toBe(0);
    expect(estimationAccuracy(0, 0)).toBe(0);
  });

  it("returns a value between 0 and 1 for partial accuracy", () => {
    // estimated=100, actual=120 → 1 - |120-100|/100 = 1 - 0.2 = 0.8
    expect(estimationAccuracy(100, 120)).toBeCloseTo(0.8, 5);
  });

  it("clamps to 0 when actual far exceeds estimated", () => {
    // estimated=10, actual=100 → 1 - |100-10|/10 = 1 - 9 = -8 → clamped to 0
    expect(estimationAccuracy(10, 100)).toBe(0);
  });

  it("clamps to 1 (does not exceed 1)", () => {
    // estimated=100, actual=100 → exactly 1, no clamping needed
    expect(estimationAccuracy(100, 100)).toBe(1);
  });

  it("handles actual less than estimated", () => {
    // estimated=100, actual=80 → 1 - |80-100|/100 = 1 - 0.2 = 0.8
    expect(estimationAccuracy(100, 80)).toBeCloseTo(0.8, 5);
  });

  it("returns 0.5 when error is half the estimate", () => {
    // estimated=100, actual=50 → 1 - |50-100|/100 = 1 - 0.5 = 0.5
    expect(estimationAccuracy(100, 50)).toBeCloseTo(0.5, 5);
    // estimated=100, actual=150 → 1 - |150-100|/100 = 1 - 0.5 = 0.5
    expect(estimationAccuracy(100, 150)).toBeCloseTo(0.5, 5);
  });
});
