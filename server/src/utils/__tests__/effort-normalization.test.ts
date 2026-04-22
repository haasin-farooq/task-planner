import { describe, it, expect } from "vitest";
import { normalizeEffort } from "../effort-normalization.js";

describe("normalizeEffort", () => {
  it("returns an empty array for empty input", () => {
    expect(normalizeEffort([])).toEqual([]);
  });

  it("returns [100] for a single value", () => {
    expect(normalizeEffort([42])).toEqual([100]);
  });

  it("returns [100] for a single zero value", () => {
    expect(normalizeEffort([0])).toEqual([100]);
  });

  it("returns [100] for a single negative value", () => {
    expect(normalizeEffort([-5])).toEqual([100]);
  });

  it("scales proportionally and sums to 100", () => {
    const result = normalizeEffort([1, 1, 1, 1]);
    expect(result).toEqual([25, 25, 25, 25]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("handles unequal values", () => {
    const result = normalizeEffort([10, 20, 70]);
    expect(result).toEqual([10, 20, 70]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("distributes equally when all values are zero", () => {
    const result = normalizeEffort([0, 0, 0]);
    const sum = Math.round(result.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(100);
    // Each should be approximately 33.33
    for (const v of result) {
      expect(v).toBeCloseTo(33.33, 1);
    }
  });

  it("clamps negative values to zero before normalizing", () => {
    const result = normalizeEffort([-5, 10, 10]);
    // -5 becomes 0, so we have [0, 10, 10] → [0, 50, 50]
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(50);
    expect(result[2]).toBe(50);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("distributes equally when all values are negative", () => {
    const result = normalizeEffort([-3, -7, -1]);
    const sum = Math.round(result.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(100);
  });

  it("handles two values", () => {
    const result = normalizeEffort([30, 70]);
    expect(result).toEqual([30, 70]);
  });

  it("handles rounding correctly for non-trivial splits", () => {
    const result = normalizeEffort([1, 1, 1]);
    const sum = Math.round(result.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(100);
  });
});
