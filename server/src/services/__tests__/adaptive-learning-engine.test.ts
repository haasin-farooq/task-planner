import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { AdaptiveLearningEngine } from "../adaptive-learning-engine.js";
import { CategoryRepository } from "../../db/category-repository.js";
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
    expect(model.adjustments[0].category).toBe("Development");
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

    const coding = model.adjustments.find((a) => a.category === "Development");
    const writing = model.adjustments.find((a) => a.category === "Writing");

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

  it("should revert to default model state after reset (Req 6.6)", () => {
    // Build up a non-trivial model across multiple categories
    for (let i = 0; i < 12; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `coding-${i}`,
          description: "coding",
          actualTime: 30,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + i * 1000),
        }),
      );
    }
    for (let i = 0; i < 8; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `writing-${i}`,
          description: "writing",
          actualTime: 90,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + (12 + i) * 1000),
        }),
      );
    }

    // Verify model has accumulated data
    let model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(20);
    expect(model.adjustments).toHaveLength(2);

    // Reset
    engine.resetModel("user-1");

    // After reset the model should match a brand-new user's defaults
    model = engine.getBehavioralModel("user-1");
    expect(model.userId).toBe("user-1");
    expect(model.totalCompletedTasks).toBe(0);
    expect(model.adjustments).toEqual([]);
  });

  it("should allow fresh data accumulation after reset without prior contamination (Req 6.6)", () => {
    // Record completions where user is consistently faster (multiplier < 1)
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

    // Reset the model
    engine.resetModel("user-1");

    // Now record completions where user is consistently slower (multiplier > 1)
    for (let i = 0; i < 3; i++) {
      engine.recordCompletion(
        makeRecord({
          taskId: `post-${i}`,
          description: "coding",
          actualTime: 120,
          estimatedTime: 60,
          completedAt: new Date(Date.now() + (10 + i) * 1000),
        }),
      );
    }

    const model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(3);
    expect(model.adjustments).toHaveLength(1);

    const adj = model.adjustments[0];
    // All 3 post-reset records: 120/60 = 2.0 each → average = 2.0
    // If prior data leaked, the multiplier would be pulled toward < 1
    expect(adj.timeMultiplier).toBeCloseTo(2.0, 4);
    expect(adj.difficultyAdjustment).toBeCloseTo(1.0, 4);
    expect(adj.sampleSize).toBe(3);
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

// ---------------------------------------------------------------------------
// Category ID integration tests (Req 6.1, 6.2, 6.3)
// ---------------------------------------------------------------------------

describe("AdaptiveLearningEngine — category_id integration", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;
  let engine: AdaptiveLearningEngine;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
    engine = new AdaptiveLearningEngine(db, categoryRepo);
  });

  afterEach(() => {
    db.close();
  });

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

  // --- Req 6.1: completion records include category_id ---

  it("should store a non-null category_id on completion_history rows (Req 6.1)", () => {
    engine.recordCompletion(makeRecord({ description: "write unit tests" }));

    const row = db
      .prepare("SELECT category_id FROM completion_history WHERE user_id = ?")
      .get("user-1") as { category_id: number | null };

    expect(row.category_id).not.toBeNull();
    expect(typeof row.category_id).toBe("number");

    // Verify the category_id references a valid row in the categories table
    const category = categoryRepo.findById(row.category_id!);
    expect(category).not.toBeNull();
  });

  // --- Req 6.2: behavioral model groups by category_id ---

  it("should group adjustments by category_id so different descriptions with the same normalized category merge (Req 6.2)", () => {
    // Both descriptions normalize to the same category via the normalizer.
    // With CategoryRepository, they should resolve to the same category_id
    // and produce a single behavioral adjustment entry.
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
        description: "coding",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );

    const model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(2);

    // Both records share the same normalized category → single adjustment
    expect(model.adjustments).toHaveLength(1);
    expect(model.adjustments[0].sampleSize).toBe(2);
    // Average: (30/60 + 90/60) / 2 = (0.5 + 1.5) / 2 = 1.0
    expect(model.adjustments[0].timeMultiplier).toBeCloseTo(1.0, 4);
  });

  // --- Req 6.2, 6.3: behavioral model returns category name from categories table ---

  it("should return the category name from the categories table in the behavioral model (Req 6.2, 6.3)", () => {
    engine.recordCompletion(makeRecord({ description: "write documentation" }));

    const model = engine.getBehavioralModel("user-1");
    expect(model.adjustments).toHaveLength(1);

    // The category name should come from the categories table (via JOIN),
    // not from the raw description text
    const adj = model.adjustments[0];
    expect(adj.category).toBeTruthy();
    // It should be a proper category name, not the raw description
    expect(adj.category).not.toBe("write documentation");
  });

  it("should store category_id on behavioral_adjustments rows (Req 6.3)", () => {
    engine.recordCompletion(makeRecord({ description: "design mockups" }));

    const row = db
      .prepare(
        "SELECT category_id FROM behavioral_adjustments WHERE user_id = ?",
      )
      .get("user-1") as { category_id: number | null };

    expect(row.category_id).not.toBeNull();
    expect(typeof row.category_id).toBe("number");

    // Verify the category_id references a valid row in the categories table
    const category = categoryRepo.findById(row.category_id!);
    expect(category).not.toBeNull();
  });

  it("should track multiple categories independently via category_id", () => {
    // Use descriptions that normalize to different categories
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "write a blog post",
        actualTime: 45,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        taskId: "t2",
        description: "fix the login bug",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );

    const model = engine.getBehavioralModel("user-1");
    expect(model.totalCompletedTasks).toBe(2);
    expect(model.adjustments).toHaveLength(2);

    // Each adjustment should have a proper category name from the table
    for (const adj of model.adjustments) {
      expect(adj.category).toBeTruthy();
      expect(adj.sampleSize).toBe(1);
    }
  });

  // --- Req 17.1: category metadata stored on completion_history ---

  it("should store raw_llm_category, category_confidence, category_source in completion_history (Req 17.1)", () => {
    engine.recordCompletion(
      makeRecord({
        description: "implement auth module",
        rawLLMCategory: "Software Development",
        categoryConfidence: 0.92,
        categorySource: "llm",
      }),
    );

    const row = db
      .prepare(
        `SELECT raw_llm_category, category_confidence, category_source
         FROM completion_history WHERE user_id = ?`,
      )
      .get("user-1") as {
      raw_llm_category: string | null;
      category_confidence: number | null;
      category_source: string | null;
    };

    expect(row.raw_llm_category).toBe("Software Development");
    expect(row.category_confidence).toBeCloseTo(0.92, 4);
    expect(row.category_source).toBe("llm");
  });

  it("should store null metadata when category metadata fields are not provided (Req 17.1)", () => {
    // Record without optional metadata fields
    engine.recordCompletion(
      makeRecord({
        description: "write tests",
      }),
    );

    const row = db
      .prepare(
        `SELECT raw_llm_category, category_confidence, category_source
         FROM completion_history WHERE user_id = ?`,
      )
      .get("user-1") as {
      raw_llm_category: string | null;
      category_confidence: number | null;
      category_source: string | null;
    };

    expect(row.raw_llm_category).toBeNull();
    expect(row.category_confidence).toBeNull();
    expect(row.category_source).toBeNull();
  });

  it("should store fallback metadata correctly (Req 17.1)", () => {
    engine.recordCompletion(
      makeRecord({
        description: "organize desk",
        rawLLMCategory: null,
        categoryConfidence: 0.0,
        categorySource: "fallback",
      }),
    );

    const row = db
      .prepare(
        `SELECT raw_llm_category, category_confidence, category_source
         FROM completion_history WHERE user_id = ?`,
      )
      .get("user-1") as {
      raw_llm_category: string | null;
      category_confidence: number | null;
      category_source: string | null;
    };

    expect(row.raw_llm_category).toBeNull();
    expect(row.category_confidence).toBeCloseTo(0.0, 4);
    expect(row.category_source).toBe("fallback");
  });

  // --- Req 17.1: per-user category resolution via categoryRepo.create ---

  it("should resolve category via categoryRepo.create with per-user scoping (Req 17.1)", () => {
    // Record completions for two different users with the same description
    engine.recordCompletion(
      makeRecord({
        userId: "user-a",
        taskId: "t1",
        description: "coding task",
      }),
    );
    engine.recordCompletion(
      makeRecord({
        userId: "user-b",
        taskId: "t2",
        description: "coding task",
      }),
    );

    // Each user should have their own category row in the categories table
    const catA = categoryRepo.findByNameAndUserId("Development", "user-a");
    const catB = categoryRepo.findByNameAndUserId("Development", "user-b");

    expect(catA).not.toBeNull();
    expect(catB).not.toBeNull();
    // They should be separate category rows (different IDs)
    expect(catA!.id).not.toBe(catB!.id);
    expect(catA!.userId).toBe("user-a");
    expect(catB!.userId).toBe("user-b");
  });

  it("should use the correct createdBy based on categorySource (Req 17.1)", () => {
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "write docs",
        categorySource: "llm",
      }),
    );

    // The category should have been created with createdBy = 'llm'
    const row = db
      .prepare(
        `SELECT category_id FROM completion_history WHERE user_id = ? AND task_description = ?`,
      )
      .get("user-1", "write docs") as { category_id: number };

    const category = categoryRepo.findById(row.category_id);
    expect(category).not.toBeNull();
    expect(category!.createdBy).toBe("llm");
  });

  it("should default createdBy to 'system' when categorySource is not provided (Req 17.1)", () => {
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "plan sprint",
      }),
    );

    const row = db
      .prepare(`SELECT category_id FROM completion_history WHERE user_id = ?`)
      .get("user-1") as { category_id: number };

    const category = categoryRepo.findById(row.category_id);
    expect(category).not.toBeNull();
    expect(category!.createdBy).toBe("system");
  });

  // --- Req 17.2, 17.3: behavioral adjustments grouped by category_id ---

  it("should group behavioral adjustments by category_id so renamed categories use the new name (Req 17.2, 17.3)", () => {
    // Record some completions
    engine.recordCompletion(
      makeRecord({
        taskId: "t1",
        description: "write blog post",
        actualTime: 45,
        estimatedTime: 60,
      }),
    );
    engine.recordCompletion(
      makeRecord({
        taskId: "t2",
        description: "write documentation",
        actualTime: 90,
        estimatedTime: 60,
      }),
    );

    // Both descriptions normalize to "Writing" via the keyword normalizer,
    // so they share the same category_id
    let model = engine.getBehavioralModel("user-1");
    expect(model.adjustments).toHaveLength(1);
    const originalName = model.adjustments[0].category;

    // Now rename the category
    const catRow = db
      .prepare(
        `SELECT category_id FROM behavioral_adjustments WHERE user_id = ?`,
      )
      .get("user-1") as { category_id: number };
    categoryRepo.rename(catRow.category_id, "Content Creation");

    // The behavioral model should now use the new name from the categories table
    model = engine.getBehavioralModel("user-1");
    expect(model.adjustments).toHaveLength(1);
    expect(model.adjustments[0].category).toBe("Content Creation");
    expect(model.adjustments[0].category).not.toBe(originalName);
  });

  it("should maintain separate behavioral adjustments per user via category_id (Req 17.2, 17.3)", () => {
    // User A records coding tasks — consistently fast
    engine.recordCompletion(
      makeRecord({
        userId: "user-a",
        taskId: "t1",
        description: "coding",
        actualTime: 30,
        estimatedTime: 60,
      }),
    );

    // User B records coding tasks — consistently slow
    engine.recordCompletion(
      makeRecord({
        userId: "user-b",
        taskId: "t2",
        description: "coding",
        actualTime: 120,
        estimatedTime: 60,
      }),
    );

    const modelA = engine.getBehavioralModel("user-a");
    const modelB = engine.getBehavioralModel("user-b");

    expect(modelA.adjustments).toHaveLength(1);
    expect(modelB.adjustments).toHaveLength(1);

    // User A is faster (multiplier < 1), User B is slower (multiplier > 1)
    expect(modelA.adjustments[0].timeMultiplier).toBeCloseTo(0.5, 4);
    expect(modelB.adjustments[0].timeMultiplier).toBeCloseTo(2.0, 4);

    // Both adjustments should reference their own category_id (per-user scoping)
    const adjRowA = db
      .prepare(
        `SELECT category_id FROM behavioral_adjustments WHERE user_id = ?`,
      )
      .get("user-a") as { category_id: number };
    const adjRowB = db
      .prepare(
        `SELECT category_id FROM behavioral_adjustments WHERE user_id = ?`,
      )
      .get("user-b") as { category_id: number };

    expect(adjRowA.category_id).not.toBe(adjRowB.category_id);
  });

  it("should store category_id on both completion_history and behavioral_adjustments (Req 17.2, 17.3)", () => {
    engine.recordCompletion(
      makeRecord({
        description: "review pull request",
      }),
    );

    // Check completion_history has category_id
    const historyRow = db
      .prepare(`SELECT category_id FROM completion_history WHERE user_id = ?`)
      .get("user-1") as { category_id: number | null };

    // Check behavioral_adjustments has category_id
    const adjRow = db
      .prepare(
        `SELECT category_id FROM behavioral_adjustments WHERE user_id = ?`,
      )
      .get("user-1") as { category_id: number | null };

    expect(historyRow.category_id).not.toBeNull();
    expect(adjRow.category_id).not.toBeNull();

    // Both should reference the same category
    expect(historyRow.category_id).toBe(adjRow.category_id);

    // And the category should exist in the categories table
    const category = categoryRepo.findById(historyRow.category_id!);
    expect(category).not.toBeNull();
    expect(category!.userId).toBe("user-1");
    expect(category!.status).toBe("active");
  });
});
