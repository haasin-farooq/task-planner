/**
 * Property 13: Name Resolution After Rename
 *
 * For any category that has been renamed, both the AnalyticsAggregator and
 * the AdaptiveLearningEngine SHALL use the new name when computing category
 * performance statistics and behavioral adjustments, respectively. No results
 * SHALL reference the old name.
 *
 * Feature: dynamic-ai-categories, Property 13: Name Resolution After Rename
 *
 * **Validates: Requirements 13.1, 13.4**
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { CategoryRepository } from "../../db/category-repository.js";
import { AnalyticsAggregator } from "../analytics-aggregator.js";
import { AdaptiveLearningEngine } from "../adaptive-learning-engine.js";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureUser(db: Database.Database, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
}

function insertCompletionDirect(
  db: Database.Database,
  opts: {
    userId: string;
    description: string;
    categoryName: string;
    categoryId: number;
    estimatedTime: number;
    actualTime: number;
    difficultyLevel: number;
    completedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO completion_history
       (id, user_id, task_description, category, normalized_category, category_id,
        estimated_time, actual_time, difficulty_level, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    opts.userId,
    opts.description,
    opts.categoryName,
    opts.categoryName,
    opts.categoryId,
    opts.estimatedTime,
    opts.actualTime,
    opts.difficultyLevel,
    opts.completedAt,
  );
}
function insertBehavioralAdjustment(
  db: Database.Database,
  opts: {
    userId: string;
    category: string;
    categoryId: number;
    timeMultiplier: number;
    difficultyAdjustment: number;
    sampleSize: number;
  },
): void {
  db.prepare(
    `INSERT INTO behavioral_adjustments
       (user_id, category, category_id, time_multiplier, difficulty_adjustment, sample_size)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.userId,
    opts.category,
    opts.categoryId,
    opts.timeMultiplier,
    opts.difficultyAdjustment,
    opts.sampleSize,
  );
}

function ensureTaskSession(
  db: Database.Database,
  userId: string,
  sessionId: string,
  createdAt: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO task_sessions (id, user_id, created_at) VALUES (?, ?, ?)`,
  ).run(sessionId, userId, createdAt);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid category name: 1-3 title-case words. */
const categoryNameArb = fc
  .array(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
      minLength: 2,
      maxLength: 10,
    }),
    { minLength: 1, maxLength: 3 },
  )
  .map((words) =>
    words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
  );

/** Generates random completion record data. */
const completionDataArb = fc.record({
  estimatedTime: fc.integer({ min: 5, max: 300 }),
  actualTime: fc.integer({ min: 5, max: 600 }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  dayOffset: fc.integer({ min: 1, max: 28 }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 13: Name Resolution After Rename", () => {
  let db: Database.Database;
  let repo: CategoryRepository;
  let analytics: AnalyticsAggregator;
  let learningEngine: AdaptiveLearningEngine;

  beforeEach(() => {
    db = createDb(":memory:");
    repo = new CategoryRepository(db);
    analytics = new AnalyticsAggregator(db);
    learningEngine = new AdaptiveLearningEngine(db, repo);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 13.1, 13.4**
   *
   * Generate random categories with completion_history records, rename them,
   * then verify:
   * (a) AnalyticsAggregator uses the new name — no results reference old name
   * (b) AdaptiveLearningEngine uses the new name — no results reference old name
   */
  it("after rename, analytics and learning engine use new name, no results reference old name", () => {
    fc.assert(
      fc.property(
        categoryNameArb,
        categoryNameArb,
        fc.array(completionDataArb, { minLength: 1, maxLength: 8 }),
        (originalName, newName, completions) => {
          // Ensure original and new names are distinct (case-insensitive)
          if (
            originalName.trim().toLowerCase() === newName.trim().toLowerCase()
          ) {
            return; // skip — same name is not a meaningful rename
          }

          // Clean state for each iteration
          db.exec("DELETE FROM completion_history");
          db.exec("DELETE FROM behavioral_adjustments");
          db.exec("DELETE FROM categories");

          const userId = "user-rename-prop13";
          ensureUser(db, userId);

          // Create a category for the user
          const category = repo.create(originalName, userId, "llm");

          // Insert completion_history rows referencing this category
          for (const comp of completions) {
            insertCompletionDirect(db, {
              userId,
              description: `task for ${originalName}`,
              categoryName: originalName,
              categoryId: category.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert a behavioral adjustment row for this category
          insertBehavioralAdjustment(db, {
            userId,
            category: originalName,
            categoryId: category.id,
            timeMultiplier: 1.2,
            difficultyAdjustment: 0.2,
            sampleSize: completions.length,
          });

          // Perform the rename
          repo.rename(category.id, newName);

          // (a) Verify AnalyticsAggregator uses the new name
          const summary = analytics.getSummary(
            userId,
            "2025-01-01",
            "2025-01-31",
          );

          // Check performanceCategories — should use new name, not old
          for (const pc of summary.performanceCategories) {
            expect(pc.category).not.toBe(originalName);
          }
          if (summary.performanceCategories.length > 0) {
            const names = summary.performanceCategories.map(
              (pc) => pc.category,
            );
            expect(names).toContain(newName);
          }

          // Check categoryPerformance stats — should use new name, not old
          if (summary.categoryPerformance) {
            for (const stat of summary.categoryPerformance.stats) {
              expect(stat.category).not.toBe(originalName);
            }
            if (summary.categoryPerformance.stats.length > 0) {
              const catNames = summary.categoryPerformance.stats.map(
                (s) => s.category,
              );
              expect(catNames).toContain(newName);
            }
          }

          // (b) Verify AdaptiveLearningEngine uses the new name
          const model = learningEngine.getBehavioralModel(userId);
          for (const adj of model.adjustments) {
            expect(adj.category).not.toBe(originalName);
          }
          if (model.adjustments.length > 0) {
            const adjNames = model.adjustments.map((a) => a.category);
            expect(adjNames).toContain(newName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
