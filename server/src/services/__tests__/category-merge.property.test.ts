/**
 * Property 11: Merge transfers all references and deletes source
 *
 * For any two distinct category IDs (source and target) where both exist in
 * the categories table, after a merge operation: (a) no completion_history
 * rows SHALL reference the source category_id, (b) no behavioral_adjustments
 * rows SHALL reference the source category_id, and (c) the source category
 * SHALL no longer exist in the categories table.
 *
 * Feature: ai-category-assignment, Property 11: Merge transfers all references and deletes source
 *
 * Validates: Requirements 8.1, 8.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { CategoryRepository } from "../../db/category-repository.js";
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

/**
 * Execute the same merge transaction logic used in POST /api/categories/merge
 * (from app.ts), extracted here so we can test it without HTTP.
 */
function executeMerge(
  db: Database.Database,
  categoryRepo: CategoryRepository,
  sourceCategoryId: number,
  targetCategoryId: number,
): void {
  const mergeTransaction = db.transaction(() => {
    // 1. Update all completion_history rows from source to target
    db.prepare(
      "UPDATE completion_history SET category_id = ? WHERE category_id = ?",
    ).run(targetCategoryId, sourceCategoryId);

    // 2. Recompute behavioral_adjustments as weighted average
    const sourceAdjustments = db
      .prepare(
        "SELECT user_id, time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments WHERE category_id = ?",
      )
      .all(sourceCategoryId) as Array<{
      user_id: string;
      time_multiplier: number;
      difficulty_adjustment: number;
      sample_size: number;
    }>;

    for (const srcAdj of sourceAdjustments) {
      const targetAdj = db
        .prepare(
          "SELECT time_multiplier, difficulty_adjustment, sample_size FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
        )
        .get(srcAdj.user_id, targetCategoryId) as
        | {
            time_multiplier: number;
            difficulty_adjustment: number;
            sample_size: number;
          }
        | undefined;

      if (targetAdj) {
        const totalSamples = srcAdj.sample_size + targetAdj.sample_size;
        const mergedTimeMultiplier =
          totalSamples > 0
            ? (srcAdj.time_multiplier * srcAdj.sample_size +
                targetAdj.time_multiplier * targetAdj.sample_size) /
              totalSamples
            : targetAdj.time_multiplier;
        const mergedDifficultyAdj =
          totalSamples > 0
            ? (srcAdj.difficulty_adjustment * srcAdj.sample_size +
                targetAdj.difficulty_adjustment * targetAdj.sample_size) /
              totalSamples
            : targetAdj.difficulty_adjustment;

        db.prepare(
          "UPDATE behavioral_adjustments SET time_multiplier = ?, difficulty_adjustment = ?, sample_size = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND category_id = ?",
        ).run(
          mergedTimeMultiplier,
          mergedDifficultyAdj,
          totalSamples,
          srcAdj.user_id,
          targetCategoryId,
        );
      } else {
        db.prepare(
          "UPDATE behavioral_adjustments SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND category_id = ?",
        ).run(targetCategoryId, srcAdj.user_id, sourceCategoryId);
      }
    }

    // Delete any remaining source behavioral_adjustments rows
    db.prepare("DELETE FROM behavioral_adjustments WHERE category_id = ?").run(
      sourceCategoryId,
    );

    // 3. Delete the source category
    categoryRepo.delete(sourceCategoryId);
  });

  mergeTransaction();
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a random number of completion records (0 to maxCount). */
const completionCountArb = fc.integer({ min: 0, max: 8 });

/** Generates a random number of behavioral adjustment users (0 to maxCount). */
const adjustmentCountArb = fc.integer({ min: 0, max: 5 });

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

describe("Property 11: Merge transfers all references and deletes source", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * For any two distinct categories with random numbers of completion_history
   * and behavioral_adjustments rows referencing the source, after merge:
   * (a) no completion_history rows reference the source category_id
   * (b) no behavioral_adjustments rows reference the source category_id
   * (c) the source category no longer exists in the categories table
   * (d) all former source references now point to the target category_id
   */
  it("after merge, no rows reference source and source category is deleted", () => {
    fc.assert(
      fc.property(
        fc.array(completionDataArb, { minLength: 0, maxLength: 8 }),
        fc.array(completionDataArb, { minLength: 0, maxLength: 8 }),
        fc.array(adjustmentDataArb, { minLength: 0, maxLength: 5 }),
        (sourceCompletions, targetCompletions, sourceAdjustments) => {
          // Create two distinct categories
          const sourceCategory = categoryRepo.upsertByName("SourceCategory");
          const targetCategory = categoryRepo.upsertByName("TargetCategory");

          const userId = "user-merge-test";
          ensureUser(db, userId);

          // Track how many completion records reference source before merge
          const sourceCompletionCount = sourceCompletions.length;

          // Insert completion_history rows referencing the source category
          for (const comp of sourceCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: "source task",
              categoryId: sourceCategory.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert completion_history rows referencing the target category
          const targetCompletionCountBefore = targetCompletions.length;
          for (const comp of targetCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: "target task",
              categoryId: targetCategory.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T11:00:00Z`,
            });
          }

          // Insert behavioral_adjustments rows referencing the source category
          // Each adjustment is for a different user to avoid PK conflicts
          for (let i = 0; i < sourceAdjustments.length; i++) {
            const adjUserId = `user-adj-${i}`;
            ensureUser(db, adjUserId);
            insertBehavioralAdjustment(db, {
              userId: adjUserId,
              category: "SourceCategory",
              categoryId: sourceCategory.id,
              timeMultiplier: sourceAdjustments[i].timeMultiplier,
              difficultyAdjustment: sourceAdjustments[i].difficultyAdjustment,
              sampleSize: sourceAdjustments[i].sampleSize,
            });
          }

          // Execute the merge
          executeMerge(db, categoryRepo, sourceCategory.id, targetCategory.id);

          // (a) No completion_history rows reference the source category_id
          const sourceCompletionRows = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
            )
            .get(sourceCategory.id) as { cnt: number };
          expect(sourceCompletionRows.cnt).toBe(0);

          // (b) No behavioral_adjustments rows reference the source category_id
          const sourceAdjustmentRows = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
            )
            .get(sourceCategory.id) as { cnt: number };
          expect(sourceAdjustmentRows.cnt).toBe(0);

          // (c) The source category no longer exists in the categories table
          const sourceExists = categoryRepo.findById(sourceCategory.id);
          expect(sourceExists).toBeNull();

          // (d) All former source completion references now point to target
          const targetCompletionRows = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
            )
            .get(targetCategory.id) as { cnt: number };
          expect(targetCompletionRows.cnt).toBe(
            sourceCompletionCount + targetCompletionCountBefore,
          );

          // Clean up for next iteration
          db.prepare("DELETE FROM completion_history").run();
          db.prepare("DELETE FROM behavioral_adjustments").run();
          db.prepare("DELETE FROM categories WHERE name IN (?, ?)").run(
            "SourceCategory",
            "TargetCategory",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * When behavioral_adjustments exist for the same user under both source
   * and target categories, after merge: no rows reference the source, and
   * the target row absorbs the source data.
   */
  it("merge with overlapping behavioral adjustments removes all source references", () => {
    fc.assert(
      fc.property(
        adjustmentDataArb,
        adjustmentDataArb,
        (sourceAdj, targetAdj) => {
          const sourceCategory = categoryRepo.upsertByName("OverlapSource");
          const targetCategory = categoryRepo.upsertByName("OverlapTarget");

          const userId = "user-overlap";
          ensureUser(db, userId);

          // Insert behavioral_adjustments for the same user under both categories
          insertBehavioralAdjustment(db, {
            userId,
            category: "OverlapSource",
            categoryId: sourceCategory.id,
            timeMultiplier: sourceAdj.timeMultiplier,
            difficultyAdjustment: sourceAdj.difficultyAdjustment,
            sampleSize: sourceAdj.sampleSize,
          });

          insertBehavioralAdjustment(db, {
            userId,
            category: "OverlapTarget",
            categoryId: targetCategory.id,
            timeMultiplier: targetAdj.timeMultiplier,
            difficultyAdjustment: targetAdj.difficultyAdjustment,
            sampleSize: targetAdj.sampleSize,
          });

          // Execute the merge
          executeMerge(db, categoryRepo, sourceCategory.id, targetCategory.id);

          // (a) No behavioral_adjustments rows reference the source
          const sourceRows = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
            )
            .get(sourceCategory.id) as { cnt: number };
          expect(sourceRows.cnt).toBe(0);

          // (b) The source category no longer exists
          expect(categoryRepo.findById(sourceCategory.id)).toBeNull();

          // (c) The target category still exists
          expect(categoryRepo.findById(targetCategory.id)).not.toBeNull();

          // (d) There is exactly one behavioral_adjustments row for the user
          //     under the target category
          const targetRows = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
            )
            .get(userId, targetCategory.id) as { cnt: number };
          expect(targetRows.cnt).toBe(1);

          // Clean up for next iteration
          db.prepare("DELETE FROM behavioral_adjustments").run();
          db.prepare("DELETE FROM categories WHERE name IN (?, ?)").run(
            "OverlapSource",
            "OverlapTarget",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Merge recomputes behavioral adjustments as weighted average
// ---------------------------------------------------------------------------

/**
 * Property 12: Merge recomputes behavioral adjustments as weighted average
 *
 * For any two behavioral adjustment rows being merged (source with
 * time_multiplier_s, sample_size_s and target with time_multiplier_t,
 * sample_size_t), the resulting merged row's time_multiplier SHALL equal
 * (time_multiplier_s × sample_size_s + time_multiplier_t × sample_size_t)
 * / (sample_size_s + sample_size_t) and sample_size SHALL equal
 * sample_size_s + sample_size_t.
 *
 * Feature: ai-category-assignment, Property 12: Merge recomputes behavioral adjustments as weighted average
 *
 * Validates: Requirements 8.2
 */

describe("Property 12: Merge recomputes behavioral adjustments as weighted average", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * For any two behavioral adjustment rows for the same user under source
   * and target categories, after merge the resulting row's time_multiplier
   * equals the weighted average and sample_size equals the sum.
   */
  it("merged time_multiplier is weighted average and sample_size is sum", () => {
    fc.assert(
      fc.property(
        adjustmentDataArb,
        adjustmentDataArb,
        (sourceAdj, targetAdj) => {
          const sourceCategory = categoryRepo.upsertByName("WAvgSource");
          const targetCategory = categoryRepo.upsertByName("WAvgTarget");

          const userId = "user-wavg";
          ensureUser(db, userId);

          // Insert behavioral_adjustments for the same user under both categories
          insertBehavioralAdjustment(db, {
            userId,
            category: "WAvgSource",
            categoryId: sourceCategory.id,
            timeMultiplier: sourceAdj.timeMultiplier,
            difficultyAdjustment: sourceAdj.difficultyAdjustment,
            sampleSize: sourceAdj.sampleSize,
          });

          insertBehavioralAdjustment(db, {
            userId,
            category: "WAvgTarget",
            categoryId: targetCategory.id,
            timeMultiplier: targetAdj.timeMultiplier,
            difficultyAdjustment: targetAdj.difficultyAdjustment,
            sampleSize: targetAdj.sampleSize,
          });

          // Compute expected values before merge
          const expectedSampleSize =
            sourceAdj.sampleSize + targetAdj.sampleSize;
          const expectedTimeMultiplier =
            (sourceAdj.timeMultiplier * sourceAdj.sampleSize +
              targetAdj.timeMultiplier * targetAdj.sampleSize) /
            expectedSampleSize;

          // Execute the merge
          executeMerge(db, categoryRepo, sourceCategory.id, targetCategory.id);

          // Verify the merged behavioral_adjustments row
          const mergedRow = db
            .prepare(
              "SELECT time_multiplier, sample_size FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
            )
            .get(userId, targetCategory.id) as {
            time_multiplier: number;
            sample_size: number;
          };

          expect(mergedRow).toBeDefined();

          // sample_size SHALL equal the sum
          expect(mergedRow.sample_size).toBe(expectedSampleSize);

          // time_multiplier SHALL equal the weighted average
          // Use a small epsilon for floating-point comparison
          expect(mergedRow.time_multiplier).toBeCloseTo(
            expectedTimeMultiplier,
            10,
          );

          // Clean up for next iteration
          db.prepare("DELETE FROM behavioral_adjustments").run();
          db.prepare("DELETE FROM categories WHERE name IN (?, ?)").run(
            "WAvgSource",
            "WAvgTarget",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * When only the source category has a behavioral adjustment (no matching
   * target row for that user), the adjustment is transferred as-is to the
   * target category, preserving time_multiplier and sample_size exactly.
   */
  it("source-only adjustment is transferred unchanged to target", () => {
    fc.assert(
      fc.property(adjustmentDataArb, (sourceAdj) => {
        const sourceCategory = categoryRepo.upsertByName("TransferSource");
        const targetCategory = categoryRepo.upsertByName("TransferTarget");

        const userId = "user-transfer";
        ensureUser(db, userId);

        // Insert behavioral_adjustment only for the source category
        insertBehavioralAdjustment(db, {
          userId,
          category: "TransferSource",
          categoryId: sourceCategory.id,
          timeMultiplier: sourceAdj.timeMultiplier,
          difficultyAdjustment: sourceAdj.difficultyAdjustment,
          sampleSize: sourceAdj.sampleSize,
        });

        // Execute the merge
        executeMerge(db, categoryRepo, sourceCategory.id, targetCategory.id);

        // The adjustment should now be under the target category
        const mergedRow = db
          .prepare(
            "SELECT time_multiplier, sample_size FROM behavioral_adjustments WHERE user_id = ? AND category_id = ?",
          )
          .get(userId, targetCategory.id) as {
          time_multiplier: number;
          sample_size: number;
        };

        expect(mergedRow).toBeDefined();

        // Values should be preserved exactly (no weighted average needed)
        expect(mergedRow.sample_size).toBe(sourceAdj.sampleSize);
        expect(mergedRow.time_multiplier).toBeCloseTo(
          sourceAdj.timeMultiplier,
          10,
        );

        // Clean up for next iteration
        db.prepare("DELETE FROM behavioral_adjustments").run();
        db.prepare("DELETE FROM categories WHERE name IN (?, ?)").run(
          "TransferSource",
          "TransferTarget",
        );
      }),
      { numRuns: 100 },
    );
  });
});
