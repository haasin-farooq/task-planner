import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeEffort } from "../effort-normalization.js";

/**
 * Property 2: Effort percentages sum to 100
 *
 * For any set of analyzed tasks within a single session, the sum of all
 * `effortPercentage` values must equal 100 (within floating-point tolerance
 * of ±0.01).
 *
 * Feature: ai-daily-task-planner, Property 2: Effort percentages sum to 100
 * Validates: Requirements 2.2
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a non-empty array of positive numbers (typical task effort values). */
const positiveArrayArb = fc.array(
  fc.double({ min: 0.01, max: 10_000, noNaN: true, noDefaultInfinity: true }),
  { minLength: 1, maxLength: 50 },
);

/** Generates a non-empty array of non-negative numbers (may include zeros). */
const nonNegativeArrayArb = fc.array(
  fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }),
  { minLength: 1, maxLength: 50 },
);

/** Generates a non-empty array of arbitrary numbers (may include negatives). */
const mixedArrayArb = fc.array(
  fc.double({
    min: -1_000,
    max: 10_000,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  { minLength: 1, maxLength: 50 },
);

/** Generates a non-empty array of all zeros. */
const allZerosArb = fc
  .integer({ min: 1, max: 50 })
  .map((len) => Array.from({ length: len }, () => 0));

/** Generates a non-empty array of all negative numbers. */
const allNegativeArb = fc.array(
  fc.double({
    min: -10_000,
    max: -0.01,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  { minLength: 1, maxLength: 50 },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumWithTolerance(arr: number[]): number {
  return Math.round(arr.reduce((sum, v) => sum + v, 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 2: Effort percentages sum to 100", () => {
  it("normalized positive values always sum to 100 (±0.01)", () => {
    fc.assert(
      fc.property(positiveArrayArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
        const sum = sumWithTolerance(result);
        expect(sum).toBeCloseTo(100, 1);
      }),
      { numRuns: 200 },
    );
  });

  it("normalized non-negative values (with possible zeros) always sum to 100 (±0.01)", () => {
    fc.assert(
      fc.property(nonNegativeArrayArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
        const sum = sumWithTolerance(result);
        expect(sum).toBeCloseTo(100, 1);
      }),
      { numRuns: 200 },
    );
  });

  it("normalized mixed values (with negatives) always sum to 100 (±0.01)", () => {
    fc.assert(
      fc.property(mixedArrayArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
        const sum = sumWithTolerance(result);
        expect(sum).toBeCloseTo(100, 1);
      }),
      { numRuns: 200 },
    );
  });

  it("all-zero arrays sum to 100 (±0.01)", () => {
    fc.assert(
      fc.property(allZerosArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
        const sum = sumWithTolerance(result);
        expect(sum).toBeCloseTo(100, 1);
      }),
      { numRuns: 200 },
    );
  });

  it("all-negative arrays sum to 100 (±0.01)", () => {
    fc.assert(
      fc.property(allNegativeArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
        const sum = sumWithTolerance(result);
        expect(sum).toBeCloseTo(100, 1);
      }),
      { numRuns: 200 },
    );
  });

  it("output length always matches input length", () => {
    fc.assert(
      fc.property(mixedArrayArb, (values) => {
        const result = normalizeEffort(values);
        expect(result).toHaveLength(values.length);
      }),
      { numRuns: 200 },
    );
  });

  it("all output values are non-negative", () => {
    fc.assert(
      fc.property(mixedArrayArb, (values) => {
        const result = normalizeEffort(values);
        for (const v of result) {
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("single-element arrays always return [100]", () => {
    const singleValueArb = fc.double({
      min: -1_000,
      max: 10_000,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(singleValueArb, (value) => {
        const result = normalizeEffort([value]);
        expect(result).toEqual([100]);
      }),
      { numRuns: 200 },
    );
  });

  it("empty array returns empty array", () => {
    expect(normalizeEffort([])).toEqual([]);
  });

  it("each output value is bounded between 0 and 100", () => {
    fc.assert(
      fc.property(mixedArrayArb, (values) => {
        const result = normalizeEffort(values);
        for (const v of result) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 200 },
    );
  });
});
