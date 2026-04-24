/**
 * Property 16: Rename Preserves Reference Counts
 *
 * For any category with N completion_history references and M
 * behavioral_adjustment references, after renaming the category, the count
 * of completion_history rows referencing that category_id SHALL still be N,
 * and the count of behavioral_adjustment rows SHALL still be M.
 *
 * Feature: dynamic-ai-categories, Property 16: Rename Preserves Reference Counts
 *
 * **Validates: Requirements 8.4**
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../connection.js";
import { CategoryRepository } from "../category-repository.js";
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
    opts.description,
    opts.description,
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates random completion record data. */
const completionDataArb = fc.record({
  estimatedTime: fc.integer({ min: 1, max: 500 }),
  actualTime: fc.integer({ min: 1, max: 1000 }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  dayOffset: fc.integer({ min: 1, max: 28 }),
});

/** Generates random behavioral adjustment data. */
const adjustmentDataArb = fc.record({
  timeMultiplier: fc.double({ min: 0.1, max: 3.0, noNaN: true }),
  difficultyAdjustment: fc.double({ min: -2.0, max: 2.0, noNaN: true }),
  sampleSize: fc.integer({ min: 1, max: 100 }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 16: Rename Preserves Reference Counts", () => {
  let db: Database.Database;
  let repo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    repo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 8.4**
   *
   * For any category with N randomly generated completion_history rows and
   * M randomly generated behavioral_adjustment rows, after renaming the
   * category:
   * (a) the count of completion_history rows referencing that category_id is still N
   * (b) the count of behavioral_adjustment rows referencing that category_id is still M
   */
  it("rename preserves completion_history and behavioral_adjustment reference counts", () => {
    fc.assert(
      fc.property(
        fc.array(completionDataArb, { minLength: 0, maxLength: 8 }),
        fc.array(adjustmentDataArb, { minLength: 0, maxLength: 6 }),
        (completions, adjustments) => {
          // Clean state for each iteration
          db.exec("DELETE FROM completion_history");
          db.exec("DELETE FROM behavioral_adjustments");
          db.exec("DELETE FROM categories");

          const userId = "user-rename-prop16";
          ensureUser(db, userId);

          // Create a category for the user
          const category = repo.create("OriginalName", userId, "llm");

          // Insert N completion_history rows referencing this category
          for (const comp of completions) {
            insertCompletionDirect(db, {
              userId,
              description: "rename ref test task",
              categoryId: category.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert M behavioral_adjustment rows referencing this category
          // Each adjustment uses a different user to avoid PK conflicts
          for (let i = 0; i < adjustments.length; i++) {
            const adjUserId = `adj-rename-${i}`;
            ensureUser(db, adjUserId);
            insertBehavioralAdjustment(db, {
              userId: adjUserId,
              category: "OriginalName",
              categoryId: category.id,
              timeMultiplier: adjustments[i].timeMultiplier,
              difficultyAdjustment: adjustments[i].difficultyAdjustment,
              sampleSize: adjustments[i].sampleSize,
            });
          }

          // Record expected counts (N and M)
          const expectedCompletionCount = completions.length;
          const expectedAdjustmentCount = adjustments.length;

          // Perform the rename
          repo.rename(category.id, "RenamedCategory");

          // (a) completion_history rows referencing category_id is still N
          const completionCountAfter = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
              )
              .get(category.id) as { cnt: number }
          ).cnt;
          expect(completionCountAfter).toBe(expectedCompletionCount);

          // (b) behavioral_adjustment rows referencing category_id is still M
          const adjustmentCountAfter = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
              )
              .get(category.id) as { cnt: number }
          ).cnt;
          expect(adjustmentCountAfter).toBe(expectedAdjustmentCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
