import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { AdaptiveLearningEngine } from "../adaptive-learning-engine.js";
import type { CompletionRecord } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<CompletionRecord> = {},
): CompletionRecord {
  return {
    taskId: "task-1",
    userId: "user-1",
    description: "coding",
    estimatedTime: 60,
    actualTime: 45,
    difficultyLevel: 3,
    completedAt: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdaptiveLearningEngine", () => {
  let db: Database.Database;
  let engine: AdaptiveLearningEngine;

  beforeEach(() => {
    db = createDb(":memory:");
    engine = new AdaptiveLearningEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- getBehavioralModel: default / empty state ---

  it("should return an empty model for a user with no history", () => {
    const model = engine.getBehavioralModel("unknown-user");
    expect(model.userId).toBe("unknown-user");
    expect(model.totalCompletedTasks).toBe(0);
    expect(model.adjustments).toEqual([]);
  });

  // --- recordCompletion: basic persistence ---

  it("should record a completion and update the behavioral model", () => {
    engine.recordCompletion(makeRecord());

    const model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(1);
    expect(model.adjustments).toHaveLength(1);
    expect(model.adjustments[0].category).toBe("coding");
    expect(model.adjustments[0].sampleSize).toBe(1);
    // 45 / 60 = 0.75
    expect(model.adjustments[0].timeMultiplier).toBeCloseTo(0.75, 4);
    // 0.75 - 1.0 = -0.25
    expect(model.adjustments[0].difficultyAdjustment).toBeCloseTo(-0.25, 4);
  });

  // --- recordCompletion: rolling average ---

  it("should compute timeMultiplier as rolling average of actual/estimated", () => {
    // Record 1: 45/60 = 0.75
    engine.recordCompletion(
      makeRecord({ taskId: "t1", actualTime: 45, estimatedTime: 60 }),
    );
    // Record 2: 90/60 = 1.5
    engine.recordCompletion(
      makeRecord({ taskId: "t2", actualTime: 90, estimatedTime: 60 }),
    );

    const model = engine.getBehavioralModel("user-1");
    // Average: (0.75 + 1.5) / 2 = 1.125
    expect(model.adjustments[0].timeMultiplier).toBeCloseTo(1.125, 4);
    expect(model.adjustments[0].sampleSize).toBe(2);
  });

  // --- Multiple categories ---

  it("should track adjustments independently per category", () => {
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "coding",
        actualTime: 30,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        taskId: "t2",
        description: "writing",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );

    const model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(2);
    expect(model.adjustments).toHaveLength(2);

    const coding = model.adjustments.find((a) => a.category === "coding");
    const writing = model.adjustments.find((a) => a.category === "writing");

    expect(coding).toBeDefined();
    expect(writing).toBeDefined();
    // 30/60 = 0.5
    expect(coding!.timeMultiplier).toBeCloseTo(0.5, 4);
    // 90/60 = 1.5
    expect(writing!.timeMultiplier).toBeCloseTo(1.5, 4);
  });

  // --- Consistently faster → multiplier < 1 ---

  it("should produce timeMultiplier < 1 when user is consistently faster", () => {
    for (let i = 0; i < 12; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `t${i}`,
          actualTime: 30,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    const model = engine.getBehavioralModel("user-1");
    const adj = model.adjustments[0];
    expect(adj.sampleSize).toBe(12);
    expect(adj.timeMultiplier).toBeLessThan(1.0);
    expect(adj.difficultyAdjustment).toBeLessThan(0);
  });

  // --- Consistently slower → multiplier > 1 ---

  it("should produce timeMultiplier > 1 when user is consistently slower", () => {
    for (let i = 0; i < 12; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `t${i}`,
          actualTime: 90,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    const model = engine.getBehavioralModel("user-1");
    const adj = model.adjustments[0];
    expect(adj.sampleSize).toBe(12);
    expect(adj.timeMultiplier).toBeGreaterThan(1.0);
    expect(adj.difficultyAdjustment).toBeGreaterThan(0);
  });

  // --- resetModel ---

  it("should clear all adjustments and history on reset", () => {
    for (let i = 0; i < 5; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `t${i}`,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    // Verify data exists
    let model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(5);
    expect(model.adjustments).toHaveLength(1);

    // Reset
    engine.resetModel("user-1");

    // Verify everything is cleared
    model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(0);
    expect(model.adjustments).toEqual([]);
  });

  it("should not affect other users when resetting a model", () => {
    engine.recordCompletion(makeRecord({ userId: "user-1", taskId: "t1" }));
    engine.recordCompletion(makeRecord({ userId: "user-2", taskId: "t2" }));

    engine.resetModel("user-1");

    const model1 = engine.getBehavioralModel("user-1");
    const model2 = engine.getBehavioralModel("user-2");

    expect(model1.totalCompletedTasks).toBe(0);
    expect(model2.totalCompletedTasks).toBe(1);
  });

  it("should clear adjustments across multiple categories on reset", () => {
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "coding",
        actualTime: 30,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        taskId: "t2",
        description: "writing",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        taskId: "t3",
        description: "design",
        actualTime: 60,
        estimatedTime: 60,
      }),
    );

    // Verify data across all three categories
    let model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(3);
    expect(model.adjustments).toHaveLength(3);

    // Reset
    engine.resetModel("user-1");

    // Verify ALL categories are cleared and model returns to default state
    model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(0);
    expect(model.adjustments).toEqual([]);
  });

  it("should reflect only post-reset data after recording new completions", () => {
    // Record pre-reset completions (fast user)
    for (let i = 0; i < 5; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `pre-${i}`,
          description: "coding",
          actualTime: 30,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    engine.resetModel("user-1");

    // Record post-reset completions (slow user)
    for (let i = 0; i < 3; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `post-${i}`,
          description: "coding",
          actualTime: 90,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + (i + 10) * 1000),
        }),
      );
    }

    const model = engine.getBehavioralModel("user-1");
    // Only the 3 post-reset completions should exist
    expect(model.totalCompletedTasks).toBe(3);
    expect(model.adjustments).toHaveLength(1);
    expect(model.adjustments[0].sampleSize).toBe(3);
    // 90/60 = 1.5 — old 0.5 multiplier should NOT influence this
    expect(model.adjustments[0].timeMultiplier).toBeCloseTo(1.5, 4);
  });

  it("should be idempotent when called on a user with no data or called twice", () => {
    // Reset a user that has never recorded anything — should not throw
    expect(() => engine.resetModel("no-data-user")).not.toThrow();

    const model = engine.getBehavioralModel("no-data-user");
    expect(model.totalCompletedTasks).toBe(0);
    expect(model.adjustments).toEqual([]);

    // Record some data, then reset twice — second reset should be a no-op
    engine.recordCompletion(
      makeRecord({ userId: "double-reset", taskId: "t1" }),
    );
    engine.resetModel("double-reset");
    expect(() => engine.resetModel("double-reset")).not.toThrow();

    const model2 = engine.getBehavioralModel("double-reset");
    expect(model2.totalCompletedTasks).toBe(0);
    expect(model2.adjustments).toEqual([]);
  });

  it("should delete completion_history rows from the database on reset", () => {
    for (let i = 0; i < 3; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `t${i}`,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }

    // Verify rows exist in completion_history
    const before = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM completion_history WHERE user_id = ?",
      )
      .get("user-1") as { cnt: number };
    expect(before.cnt).toBe(3);

    engine.resetModel("user-1");

    // Verify rows are actually deleted from completion_history
    const after = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM completion_history WHERE user_id = ?",
      )
      .get("user-1") as { cnt: number };
    expect(after.cnt).toBe(0);

    // Also verify behavioral_adjustments rows are deleted
    const adjAfter = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE user_id = ?",
      )
      .get("user-1") as { cnt: number };
    expect(adjAfter.cnt).toBe(0);
  });

  // --- Multiple users ---

  it("should maintain independent models for different users", () => {
    engine.recordCompletion(
      makeRecord({
        userId: "user-a",
        taskId: "t1",
        actualTime: 30,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        userId: "user-b",
        taskId: "t2",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );

    const modelA = engine.getBehavioralModel("user-a");
    const modelB = engine.getBehavioralModel("user-b");

    expect(modelA.adjustments[0].timeMultiplier).toBeCloseTo(0.5, 4);
    expect(modelB.adjustments[0].timeMultiplier).toBeCloseTo(1.5, 4);
  });
});
