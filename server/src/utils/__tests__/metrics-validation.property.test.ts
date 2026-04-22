import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateTaskMetrics, clampMetrics } from "../validation.js";
import type { TaskMetrics } from "../../types/index.js";

/**
 * Property 1: Task metrics are in valid ranges
 *
 * For any analyzed task returned by the Task Analyzer, the `priority` must be
 * an integer in [1, 5], the `difficultyLevel` must be an integer in [1, 5],
 * and the `estimatedTime` must be a positive integer.
 *
 * Feature: ai-daily-task-planner, Property 1: Task metrics are in valid ranges
 * Validates: Requirements 2.1, 2.3, 2.4
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a TaskMetrics object with all fields in valid ranges. */
const validMetricsArb: fc.Arbitrary<TaskMetrics> = fc.record({
  priority: fc.integer({ min: 1, max: 5 }),
  effortPercentage: fc.double({ min: 0, max: 100, noNaN: true }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  estimatedTime: fc.integer({ min: 1, max: 10_000 }),
  dependsOn: fc.array(fc.uuid(), { maxLength: 5 }),
});

/** Generates a TaskMetrics object where at least one validated field is out of range. */
const invalidMetricsArb: fc.Arbitrary<TaskMetrics> = fc
  .record({
    // priority can be out of [1,5] or non-integer
    priority: fc.oneof(
      fc.integer({ min: -100, max: 0 }),
      fc.integer({ min: 6, max: 100 }),
      fc
        .double({ min: 1.01, max: 4.99, noNaN: true })
        .filter((n) => !Number.isInteger(n)),
    ),
    // difficultyLevel can be out of [1,5] or non-integer
    difficultyLevel: fc.oneof(
      fc.integer({ min: -100, max: 0 }),
      fc.integer({ min: 6, max: 100 }),
      fc
        .double({ min: 1.01, max: 4.99, noNaN: true })
        .filter((n) => !Number.isInteger(n)),
    ),
    // estimatedTime can be zero, negative, or non-numeric
    estimatedTime: fc.oneof(
      fc.constant(0),
      fc.integer({ min: -10_000, max: -1 }),
      fc.double({ min: -10_000, max: 0, noNaN: true }),
    ),
    effortPercentage: fc.double({ min: 0, max: 100, noNaN: true }),
    dependsOn: fc.array(fc.uuid(), { maxLength: 5 }),
  })
  .chain((base) => {
    // Pick at least one field to make invalid; the others can be valid.
    // We randomly choose which fields to corrupt (1–3 of them).
    return fc
      .subarray(["priority", "difficultyLevel", "estimatedTime"] as const, {
        minLength: 1,
        maxLength: 3,
      })
      .map((fieldsToCorrupt) => {
        const result: TaskMetrics = {
          priority: fieldsToCorrupt.includes("priority")
            ? base.priority
            : fc.sample(fc.integer({ min: 1, max: 5 }), 1)[0],
          difficultyLevel: fieldsToCorrupt.includes("difficultyLevel")
            ? base.difficultyLevel
            : fc.sample(fc.integer({ min: 1, max: 5 }), 1)[0],
          estimatedTime: fieldsToCorrupt.includes("estimatedTime")
            ? base.estimatedTime
            : fc.sample(fc.integer({ min: 1, max: 10_000 }), 1)[0],
          effortPercentage: base.effortPercentage,
          dependsOn: base.dependsOn,
        };
        return result;
      });
  });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 1: Task metrics are in valid ranges", () => {
  it("validateTaskMetrics accepts all metrics within valid ranges", () => {
    fc.assert(
      fc.property(validMetricsArb, (metrics) => {
        expect(validateTaskMetrics(metrics)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("validateTaskMetrics rejects metrics with at least one field out of range", () => {
    fc.assert(
      fc.property(invalidMetricsArb, (metrics) => {
        expect(validateTaskMetrics(metrics)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("clampMetrics always produces metrics that pass validation", () => {
    // Generate completely arbitrary numeric metrics (possibly out of range)
    const arbitraryMetrics: fc.Arbitrary<TaskMetrics> = fc.record({
      priority: fc.double({ min: -100, max: 100, noNaN: true }),
      effortPercentage: fc.double({ min: -100, max: 200, noNaN: true }),
      difficultyLevel: fc.double({ min: -100, max: 100, noNaN: true }),
      estimatedTime: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
      dependsOn: fc.array(fc.uuid(), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(arbitraryMetrics, (metrics) => {
        const clamped = clampMetrics(metrics);
        expect(validateTaskMetrics(clamped)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("clampMetrics preserves already-valid metrics", () => {
    fc.assert(
      fc.property(validMetricsArb, (metrics) => {
        const clamped = clampMetrics(metrics);
        expect(clamped.priority).toBe(metrics.priority);
        expect(clamped.difficultyLevel).toBe(metrics.difficultyLevel);
        expect(clamped.estimatedTime).toBe(metrics.estimatedTime);
      }),
      { numRuns: 200 },
    );
  });

  it("clamped priority is always an integer in [1, 5]", () => {
    const anyPriority = fc.double({ min: -1000, max: 1000, noNaN: true });

    fc.assert(
      fc.property(anyPriority, (p) => {
        const clamped = clampMetrics({
          priority: p,
          effortPercentage: 50,
          difficultyLevel: 3,
          estimatedTime: 30,
          dependsOn: [],
        });
        expect(Number.isInteger(clamped.priority)).toBe(true);
        expect(clamped.priority).toBeGreaterThanOrEqual(1);
        expect(clamped.priority).toBeLessThanOrEqual(5);
      }),
      { numRuns: 200 },
    );
  });

  it("clamped difficultyLevel is always an integer in [1, 5]", () => {
    const anyDifficulty = fc.double({ min: -1000, max: 1000, noNaN: true });

    fc.assert(
      fc.property(anyDifficulty, (d) => {
        const clamped = clampMetrics({
          priority: 3,
          effortPercentage: 50,
          difficultyLevel: d,
          estimatedTime: 30,
          dependsOn: [],
        });
        expect(Number.isInteger(clamped.difficultyLevel)).toBe(true);
        expect(clamped.difficultyLevel).toBeGreaterThanOrEqual(1);
        expect(clamped.difficultyLevel).toBeLessThanOrEqual(5);
      }),
      { numRuns: 200 },
    );
  });

  it("clamped estimatedTime is always a positive integer", () => {
    const anyTime = fc.double({ min: -10_000, max: 10_000, noNaN: true });

    fc.assert(
      fc.property(anyTime, (t) => {
        const clamped = clampMetrics({
          priority: 3,
          effortPercentage: 50,
          difficultyLevel: 3,
          estimatedTime: t,
          dependsOn: [],
        });
        expect(Number.isInteger(clamped.estimatedTime)).toBe(true);
        expect(clamped.estimatedTime).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });
});
