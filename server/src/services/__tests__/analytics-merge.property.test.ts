/**
 * Property 14: Analytics Follows Merge Pointers
 *
 * For any category with status = 'merged', the AnalyticsAggregator SHALL
 * follow the merged_into_category_id pointer and roll up all historical
 * completion data under the target category. The merged category SHALL NOT
 * appear as a separate entry in analytics results.
 *
 * Feature: dynamic-ai-categories, Property 14: Analytics Follows Merge Pointers
 *
 * **Validates: Requirements 13.2**
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { CategoryRepository } from "../../db/category-repository.js";
import { AnalyticsAggregator } from "../analytics-aggregator.js";
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

/** Generates a pair of distinct category names (case-insensitive). */
const distinctCategoryPairArb = fc
  .tuple(categoryNameArb, categoryNameArb)
  .filter(([a, b]) => a.trim().toLowerCase() !== b.trim().toLowerCase());

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

describe("Property 14: Analytics Follows Merge Pointers", () => {
  let db: Database.Database;
  let repo: CategoryRepository;
  let analytics: AnalyticsAggregator;

  beforeEach(() => {
    db = createDb(":memory:");
    repo = new CategoryRepository(db);
    analytics = new AnalyticsAggregator(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * **Validates: Requirements 13.2**
   *
   * Generate random source and target categories with completion_history records,
   * merge source into target, then verify:
   * (a) AnalyticsAggregator rolls up source data under the target category
   * (b) The merged (source) category does NOT appear as a separate entry
   */
  it("after merge, analytics rolls up source data under target and merged category does not appear separately", () => {
    fc.assert(
      fc.property(
        distinctCategoryPairArb,
        fc.array(completionDataArb, { minLength: 1, maxLength: 5 }),
        fc.array(completionDataArb, { minLength: 1, maxLength: 5 }),
        ([sourceName, targetName], sourceCompletions, targetCompletions) => {
          // Clean state for each iteration
          db.exec("DELETE FROM completion_history");
          db.exec("DELETE FROM behavioral_adjustments");
          db.exec("DELETE FROM categories");

          const userId = "user-merge-prop14";
          ensureUser(db, userId);

          // Create source and target categories
          const sourceCategory = repo.create(sourceName, userId, "llm");
          const targetCategory = repo.create(targetName, userId, "llm");

          // Insert completion_history rows for the source category
          for (const comp of sourceCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: `task for ${sourceName}`,
              categoryName: sourceName,
              categoryId: sourceCategory.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T10:00:00Z`,
            });
          }

          // Insert completion_history rows for the target category
          for (const comp of targetCompletions) {
            insertCompletionDirect(db, {
              userId,
              description: `task for ${targetName}`,
              categoryName: targetName,
              categoryId: targetCategory.id,
              estimatedTime: comp.estimatedTime,
              actualTime: comp.actualTime,
              difficultyLevel: comp.difficultyLevel,
              completedAt: `2025-01-${String(comp.dayOffset).padStart(2, "0")}T11:00:00Z`,
            });
          }

          const totalCompletions =
            sourceCompletions.length + targetCompletions.length;

          // Perform the merge: source → target
          repo.merge(sourceCategory.id, targetCategory.id);

          // Get analytics summary
          const summary = analytics.getSummary(
            userId,
            "2025-01-01",
            "2025-01-31",
          );

          // (a) Verify merged source data appears under target category name
          // Check performanceCategories
          const perfCategoryNames = summary.performanceCategories.map(
            (pc) => pc.category,
          );

          // Source category name must NOT appear as a separate entry
          expect(perfCategoryNames).not.toContain(sourceName);

          // Target category name should appear (it has all the data now)
          if (perfCategoryNames.length > 0) {
            expect(perfCategoryNames).toContain(targetName);
          }

          // (b) Check categoryPerformance stats
          if (summary.categoryPerformance) {
            const catPerfNames = summary.categoryPerformance.stats.map(
              (s) => s.category,
            );

            // Source category must NOT appear as a separate entry
            expect(catPerfNames).not.toContain(sourceName);

            // Target category should appear with rolled-up data
            if (catPerfNames.length > 0) {
              expect(catPerfNames).toContain(targetName);
            }

            // The target category's sample size should reflect all completions
            const targetStat = summary.categoryPerformance.stats.find(
              (s) => s.category === targetName,
            );
            if (targetStat) {
              expect(targetStat.sampleSize).toBe(totalCompletions);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
