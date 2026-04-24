/**
 * Property 4: Merge Preserves Source Row and Updates All References
 *
 * For any two active categories (source, target) belonging to the same user,
 * after merging source into target:
 * (a) the source row SHALL still exist with `status = 'merged'` and
 *     `merged_into_category_id = target.id`
 * (b) all `completion_history` rows that previously referenced `source.id`
 *     SHALL now reference `target.id`
 * (c) all `behavioral_adjustments` rows for the source SHALL be merged into
 *     the target using weighted averages
 * (d) the total count of completion_history rows SHALL remain unchanged
 *
 * Feature: dynamic-ai-categories, Property 4: Merge Preserves Source Row and Updates All References
 *
 * **Validates: Requirements 3.5, 8.3, 14.2**
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

describe("Property 4: Merge Preserves Source Row and Updates All References", () => {
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
   * **Validates: Requirements 3.5, 8.3, 14.2**
   *
   * For any two active categories with random completion_history and
   * behavioral_adjustment rows, after merge via CategoryRepository.merge():
   * (a) source row still exists with status='merged' and merged_into_category_id=target.id
   * (b) all completion_history rows that referenced source now reference target
   * (c) behavioral_adjustments are merged with weighted averages
   * (d) total completion_history row count is unchanged
   */
  it("merge preserves source row, updates all references, and maintains row counts", () => {
    fc.assert(
      fc.property(
        fc.array(completionDataArb, { minLength: 0, maxLength: 6 }),
        fc.array(completionDataArb, { minLength: 0, maxLength: 6 }),
        fc.array(adjustmentDataArb, { minLength: 0, maxLength: 4 }),
        fc.array(adjustmentDataArb, { minLength: 0, maxLength: 4 }),
        (
          sourceCompletions,
          targetCompletions,
          sourceAdjustments,
          targetAdjustments,
        ) => {
          // Clean state for each iteration
          db.exec("DELETE FROM completion_history");
          db.exec("DELETE FROM behavioral_adjustments");
          db.exec("DELETE FROM categories");

          const userId = "user-merge-prop4";
          ensureUser(db, userId);

          // Create two distinct active categories for the same user
          const source = repo.create("SourceCat", userId, "llm");
          const target = repo.create("TargetCat", userId, "llm");

          // Insert completion_history rows referencing source
          for (const comp of sourceCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: "source task",
              categoryId: source.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert completion_history rows referencing target
          for (const comp of targetCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: "target task",
              categoryId: target.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T11:00:00Z`,
            });
          }

          // Insert behavioral_adjustments for source (each for a different user)
          for (let i = 0; i < sourceAdjustments.length; i++) {
            const adjUserId = `adj-src-${i}`;
            ensureUser(db, adjUserId);
            insertBehavioralAdjustment(db, {
              userId: adjUserId,
              category: "SourceCat",
              categoryId: source.id,
              timeMultiplier: sourceAdjustments[i].timeMultiplier,
              difficultyAdjustment: sourceAdjustments[i].difficultyAdjustment,
              sampleSize: sourceAdjustments[i].sampleSize,
            });
          }

          // Insert behavioral_adjustments for target (same user IDs to test overlap)
          for (let i = 0; i < targetAdjustments.length; i++) {
            const adjUserId = `adj-src-${i}`;
            ensureUser(db, adjUserId);
            insertBehavioralAdjustment(db, {
              userId: adjUserId,
              category: "TargetCat",
              categoryId: target.id,
              timeMultiplier: targetAdjustments[i].timeMultiplier,
              difficultyAdjustment: targetAdjustments[i].difficultyAdjustment,
              sampleSize: targetAdjustments[i].sampleSize,
            });
          }

          // Record total completion_history count before merge
          const totalBefore = (
            db
              .prepare("SELECT COUNT(*) as cnt FROM completion_history")
              .get() as { cnt: number }
          ).cnt;

          // Execute the merge via CategoryRepository
          repo.merge(source.id, target.id);

          // (a) Source row still exists with status='merged' and merged_into_category_id=target.id
          const sourceAfter = repo.findById(source.id);
          expect(sourceAfter).not.toBeNull();
          expect(sourceAfter!.status).toBe("merged");
          expect(sourceAfter!.mergedIntoCategoryId).toBe(target.id);

          // (b) All completion_history rows that referenced source now reference target
          const sourceCompletionCount = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
              )
              .get(source.id) as { cnt: number }
          ).cnt;
          expect(sourceCompletionCount).toBe(0);

          const targetCompletionCount = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM completion_history WHERE category_id = ?",
              )
              .get(target.id) as { cnt: number }
          ).cnt;
          expect(targetCompletionCount).toBe(
            sourceCompletions.length + targetCompletions.length,
          );

          // (c) No behavioral_adjustments rows reference the source category
          const sourceAdjCount = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
              )
              .get(source.id) as { cnt: number }
          ).cnt;
          expect(sourceAdjCount).toBe(0);

          // (d) Total completion_history row count is unchanged
          const totalAfter = (
            db
              .prepare("SELECT COUNT(*) as cnt FROM completion_history")
              .get() as { cnt: number }
          ).cnt;
          expect(totalAfter).toBe(totalBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5, 8.3, 14.2**
   *
   * When behavioral_adjustments exist for the same user under both source
   * and target categories, the merge produces correct weighted averages.
   */
  it("merge computes correct weighted averages for overlapping behavioral adjustments", () => {
    fc.assert(
      fc.property(
        adjustmentDataArb,
        adjustmentDataArb,
        (sourceAdj, targetAdj) => {
          db.exec("DELETE FROM completion_history");
          db.exec("DELETE FROM behavioral_adjustments");
          db.exec("DELETE FROM categories");

          const userId = "user-wavg-prop4";
          ensureUser(db, userId);

          const source = repo.create("WAvgSource", userId, "llm");
          const target = repo.create("WAvgTarget", userId, "llm");

          const adjUserId = "adj-overlap-user";
          ensureUser(db, adjUserId);

          // Insert behavioral_adjustments for the same user under both categories
          insertBehavioralAdjustment(db, {
            userId: adjUserId,
            category: "WAvgSource",
            categoryId: source.id,
            timeMultiplier: sourceAdj.timeMultiplier,
            difficultyAdjustment: sourceAdj.difficultyAdjustment,
            sampleSize: sourceAdj.sampleSize,
          });

          insertBehavioralAdjustment(db, {
            userId: adjUserId,
            category: "WAvgTarget",
            categoryId: target.id,
            timeMultiplier: targetAdj.timeMultiplier,
            difficultyAdjustment: targetAdj.difficultyAdjustment,
            sampleSize: targetAdj.sampleSize,
          });

          // Compute expected weighted averages
          const expectedSampleSize =
            sourceAdj.sampleSize + targetAdj.sampleSize;
          const expectedTimeMultiplier =
            (sourceAdj.timeMultiplier * sourceAdj.sampleSize +
              targetAdj.timeMultiplier * targetAdj.sampleSize) /
            expectedSampleSize;
          const expectedDifficultyAdj =
            (sourceAdj.difficultyAdjustment * sourceAdj.sampleSize +
              targetAdj.difficultyAdjustment * targetAdj.sampleSize) /
            expectedSampleSize;

          // Execute the merge
          repo.merge(source.id, target.id);

          // Source row preserved with merged status
          const sourceAfter = repo.findById(source.id);
          expect(sourceAfter).not.toBeNull();
          expect(sourceAfter!.status).toBe("merged");
          expect(sourceAfter!.mergedIntoCategoryId).toBe(target.id);

          // No behavioral_adjustments reference source
          const srcAdjCount = (
            db
              .prepare(
                "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
              )
              .get(source.id) as { cnt: number }
          ).cnt;
          expect(srcAdjCount).toBe(0);

          // Target row has correct weighted averages
          const mergedRow = db
            .prepare(
              `SELECT time_multiplier, difficulty_adjustment, sample_size
               FROM behavioral_adjustments
               WHERE user_id = ? AND category_id = ?`,
            )
            .get(adjUserId, target.id) as {
            time_multiplier: number;
            difficulty_adjustment: number;
            sample_size: number;
          };

          expect(mergedRow).toBeDefined();
          expect(mergedRow.sample_size).toBe(expectedSampleSize);
          expect(mergedRow.time_multiplier).toBeCloseTo(
            expectedTimeMultiplier,
            10,
          );
          expect(mergedRow.difficulty_adjustment).toBeCloseTo(
            expectedDifficultyAdj,
            10,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5, 8.3, 14.2**
   *
   * When only the source category has behavioral_adjustments (no matching
   * target row for that user), the adjustment is transferred to the target
   * category, preserving values exactly.
   */
  it("source-only behavioral adjustments are transferred to target unchanged", () => {
    fc.assert(
      fc.property(adjustmentDataArb, (sourceAdj) => {
        db.exec("DELETE FROM completion_history");
        db.exec("DELETE FROM behavioral_adjustments");
        db.exec("DELETE FROM categories");

        const userId = "user-transfer-prop4";
        ensureUser(db, userId);

        const source = repo.create("TransferSrc", userId, "llm");
        const target = repo.create("TransferTgt", userId, "llm");

        const adjUserId = "adj-transfer-user";
        ensureUser(db, adjUserId);

        // Insert behavioral_adjustment only for the source category
        insertBehavioralAdjustment(db, {
          userId: adjUserId,
          category: "TransferSrc",
          categoryId: source.id,
          timeMultiplier: sourceAdj.timeMultiplier,
          difficultyAdjustment: sourceAdj.difficultyAdjustment,
          sampleSize: sourceAdj.sampleSize,
        });

        // Execute the merge
        repo.merge(source.id, target.id);

        // Source row preserved
        const sourceAfter = repo.findById(source.id);
        expect(sourceAfter).not.toBeNull();
        expect(sourceAfter!.status).toBe("merged");

        // The adjustment should now be under the target category
        const mergedRow = db
          .prepare(
            `SELECT time_multiplier, difficulty_adjustment, sample_size
             FROM behavioral_adjustments
             WHERE user_id = ? AND category_id = ?`,
          )
          .get(adjUserId, target.id) as {
          time_multiplier: number;
          difficulty_adjustment: number;
          sample_size: number;
        };

        expect(mergedRow).toBeDefined();
        expect(mergedRow.sample_size).toBe(sourceAdj.sampleSize);
        expect(mergedRow.time_multiplier).toBeCloseTo(
          sourceAdj.timeMultiplier,
          10,
        );
        expect(mergedRow.difficulty_adjustment).toBeCloseTo(
          sourceAdj.difficultyAdjustment,
          10,
        );

        // No rows reference source
        const srcAdjCount = (
          db
            .prepare(
              "SELECT COUNT(*) as cnt FROM behavioral_adjustments WHERE category_id = ?",
            )
            .get(source.id) as { cnt: number }
        ).cnt;
        expect(srcAdjCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
