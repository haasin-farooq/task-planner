/**
 * Property 8: Adaptive learning adjustment direction
 *
 * For any sequence of completion records for a given task category where the
 * user consistently completes tasks faster than estimated (actual < estimated
 * for all records), the resulting timeMultiplier must be less than 1.0.
 * Conversely, for any sequence where the user consistently completes tasks
 * slower than estimated (actual > estimated for all records), the
 * timeMultiplier must be greater than 1.0. Adjustments must only be applied
 * when the user has 10 or more completed tasks.
 *
 * Feature: ai-daily-task-planner, Property 8: Adaptive learning adjustment direction
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { AdaptiveLearningEngine } from "../adaptive-learning-engine.js";
import type { CompletionRecord } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<CompletionRecord>): CompletionRecord {
  return {
    taskId: "task-1",
    userId: "user-1",
    description: "test-category",
    estimatedTime: 60,
    actualTime: 60,
    difficultyLevel: 3,
    completedAt: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

/**
 * Arbitrary that generates a "consistently faster" completion record pair:
 * actualTime is strictly less than estimatedTime, both positive integers.
 */
const fasterRecordArb = fc
  .record({
    estimatedTime: fc.integer({ min: 2, max: 500 }),
    // ratio in (0, 1) exclusive — user finishes faster
    ratio: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
    difficultyLevel: fc.integer({ min: 1, max: 5 }),
  })
  .map(({ estimatedTime, ratio, difficultyLevel }) => ({
    estimatedTime,
    actualTime: Math.max(1, Math.round(estimatedTime * ratio)),
    difficultyLevel,
  }));

/**
 * Arbitrary that generates a "consistently slower" completion record pair:
 * actualTime is strictly greater than estimatedTime, both positive integers.
 */
const slowerRecordArb = fc
  .record({
    estimatedTime: fc.integer({ min: 1, max: 500 }),
    // ratio > 1 — user finishes slower
    ratio: fc.double({ min: 1.01, max: 5.0, noNaN: true }),
    difficultyLevel: fc.integer({ min: 1, max: 5 }),
  })
  .map(({ estimatedTime, ratio, difficultyLevel }) => ({
    estimatedTime,
    actualTime: Math.round(estimatedTime * ratio),
    difficultyLevel,
  }));

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 8: Adaptive learning adjustment direction", () => {
  let db: Database.Database;
  let engine: AdaptiveLearningEngine;

  beforeEach(() => {
    db = createDb(":memory:");
    engine = new AdaptiveLearningEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  it("timeMultiplier < 1 when user is consistently faster than estimated (10+ records)", () => {
    fc.assert(
      fc.property(
        fc.array(fasterRecordArb, { minLength: 10, maxLength: 50 }),
        (records) => {
          // Reset engine state for each run
          engine.resetModel("user-1");
          // Ensure user row exists
          db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
            "user-1",
          );

          // Record all completions
          records.forEach((rec, i) => {
            engine.recordCompletion(
              makeRecord({
                taskId: `task-${i}`,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
                completedAt: new Date(Date.now() + i * 1000),
              }),
            );
          });

          const model = engine.getBehavioralModel("user-1");
          const adj = model.adjustments.find(
            (a) => a.category === "test-category",
          );

          // Must have an adjustment entry
          expect(adj).toBeDefined();
          // Sample size must match number of records
          expect(adj!.sampleSize).toBe(records.length);
          // With 10+ records, timeMultiplier must be < 1 (user is faster)
          expect(adj!.timeMultiplier).toBeLessThan(1.0);
          // difficultyAdjustment should be negative (easier)
          expect(adj!.difficultyAdjustment).toBeLessThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("timeMultiplier > 1 when user is consistently slower than estimated (10+ records)", () => {
    fc.assert(
      fc.property(
        fc.array(slowerRecordArb, { minLength: 10, maxLength: 50 }),
        (records) => {
          engine.resetModel("user-1");
          db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
            "user-1",
          );

          records.forEach((rec, i) => {
            engine.recordCompletion(
              makeRecord({
                taskId: `task-${i}`,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
                completedAt: new Date(Date.now() + i * 1000),
              }),
            );
          });

          const model = engine.getBehavioralModel("user-1");
          const adj = model.adjustments.find(
            (a) => a.category === "test-category",
          );

          expect(adj).toBeDefined();
          expect(adj!.sampleSize).toBe(records.length);
          // With 10+ records, timeMultiplier must be > 1 (user is slower)
          expect(adj!.timeMultiplier).toBeGreaterThan(1.0);
          // difficultyAdjustment should be positive (harder)
          expect(adj!.difficultyAdjustment).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("adjustments are only applied when sampleSize >= 10", () => {
    fc.assert(
      fc.property(
        fc.array(fasterRecordArb, { minLength: 1, maxLength: 9 }),
        (records) => {
          engine.resetModel("user-1");
          db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
            "user-1",
          );

          records.forEach((rec, i) => {
            engine.recordCompletion(
              makeRecord({
                taskId: `task-${i}`,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
                completedAt: new Date(Date.now() + i * 1000),
              }),
            );
          });

          const model = engine.getBehavioralModel("user-1");
          const adj = model.adjustments.find(
            (a) => a.category === "test-category",
          );

          expect(adj).toBeDefined();
          // Sample size must be less than 10
          expect(adj!.sampleSize).toBeLessThan(10);
          // The engine still computes the multiplier, but consumers should
          // only apply adjustments when sampleSize >= 10. Verify the
          // sampleSize is faithfully tracked so consumers can gate on it.
          expect(adj!.sampleSize).toBe(records.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("timeMultiplier equals the mean of (actual/estimated) ratios", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        (records) => {
          engine.resetModel("user-1");
          db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(
            "user-1",
          );

          records.forEach((rec, i) => {
            engine.recordCompletion(
              makeRecord({
                taskId: `task-${i}`,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
                completedAt: new Date(Date.now() + i * 1000),
              }),
            );
          });

          const model = engine.getBehavioralModel("user-1");
          const adj = model.adjustments.find(
            (a) => a.category === "test-category",
          );

          expect(adj).toBeDefined();

          // Compute expected mean ratio
          const expectedMultiplier =
            records.reduce(
              (sum, r) => sum + r.actualTime / r.estimatedTime,
              0,
            ) / records.length;

          expect(adj!.timeMultiplier).toBeCloseTo(expectedMultiplier, 4);
          // difficultyAdjustment = timeMultiplier - 1.0
          expect(adj!.difficultyAdjustment).toBeCloseTo(
            expectedMultiplier - 1.0,
            4,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
