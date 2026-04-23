/**
 * Property 6: Completion records store both raw category and category_id
 *
 * For any completion record inserted via the AdaptiveLearningEngine, the
 * resulting completion_history row SHALL have a non-null category_id that
 * references a valid row in the categories table, and the category text
 * column SHALL also be populated.
 *
 * Feature: ai-category-assignment, Property 6: Completion records store both raw category and category_id
 *
 * Validates: Requirements 4.4, 6.1
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { CategoryRepository } from "../../db/category-repository.js";
import { AdaptiveLearningEngine } from "../adaptive-learning-engine.js";
import type { CompletionRecord } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<CompletionRecord>): CompletionRecord {
  return {
    taskId: "task-1",
    userId: "user-1",
    description: "test task",
    estimatedTime: 60,
    actualTime: 45,
    difficultyLevel: 3,
    completedAt: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

/**
 * Arbitrary that generates random completion data for property testing.
 * Produces task descriptions, estimated/actual times, and difficulty levels.
 */
const completionDataArb = fc.record({
  description: fc.string({ minLength: 1, maxLength: 50 }),
  estimatedTime: fc.integer({ min: 1, max: 500 }),
  actualTime: fc.integer({ min: 1, max: 1000 }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  completedAt: fc.date({
    min: new Date("2024-01-01T00:00:00Z"),
    max: new Date("2025-12-31T23:59:59Z"),
  }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 6: Completion records store both raw category and category_id", () => {
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

  /**
   * **Validates: Requirements 4.4, 6.1**
   *
   * For any randomly generated completion record, after recordCompletion()
   * is called, the completion_history row must have:
   * - a non-null category_id
   * - category_id references a valid row in the categories table
   * - the category text column is populated (non-null, non-empty)
   */
  it("completion_history row has non-null category_id referencing categories table and populated category text", () => {
    fc.assert(
      fc.property(completionDataArb, (data) => {
        // Reset state for each run
        engine.resetModel("user-1");

        // Record a completion with the generated data
        engine.recordCompletion(
          makeRecord({
            description: data.description,
            estimatedTime: data.estimatedTime,
            actualTime: data.actualTime,
            difficultyLevel: data.difficultyLevel,
            completedAt: data.completedAt,
          }),
        );

        // Query the completion_history table directly
        const rows = db
          .prepare(
            "SELECT category, category_id FROM completion_history WHERE user_id = ?",
          )
          .all("user-1") as {
          category: string | null;
          category_id: number | null;
        }[];

        expect(rows.length).toBeGreaterThan(0);

        for (const row of rows) {
          // category_id must be non-null
          expect(row.category_id).not.toBeNull();

          // category_id must reference a valid row in the categories table
          const categoryRow = db
            .prepare("SELECT id, name FROM categories WHERE id = ?")
            .get(row.category_id) as { id: number; name: string } | undefined;
          expect(categoryRow).toBeDefined();
          expect(categoryRow!.id).toBe(row.category_id);

          // category text column must be populated (non-null, non-empty)
          expect(row.category).not.toBeNull();
          expect(row.category!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.4, 6.1**
   *
   * For any sequence of completion records with different descriptions,
   * each completion_history row must independently have a valid category_id
   * and populated category text.
   */
  it("multiple completion records each have valid category_id and category text", () => {
    fc.assert(
      fc.property(
        fc.array(completionDataArb, { minLength: 1, maxLength: 10 }),
        (records) => {
          // Reset state for each run
          engine.resetModel("user-1");

          // Record all completions
          records.forEach((data, i) => {
            engine.recordCompletion(
              makeRecord({
                taskId: `task-${i}`,
                description: data.description,
                estimatedTime: data.estimatedTime,
                actualTime: data.actualTime,
                difficultyLevel: data.difficultyLevel,
                completedAt: data.completedAt,
              }),
            );
          });

          // Query all completion_history rows
          const rows = db
            .prepare(
              "SELECT category, category_id FROM completion_history WHERE user_id = ?",
            )
            .all("user-1") as {
            category: string | null;
            category_id: number | null;
          }[];

          // Should have exactly as many rows as records inserted
          expect(rows.length).toBe(records.length);

          for (const row of rows) {
            // category_id must be non-null
            expect(row.category_id).not.toBeNull();

            // category_id must reference a valid categories row
            const categoryRow = db
              .prepare("SELECT id FROM categories WHERE id = ?")
              .get(row.category_id) as { id: number } | undefined;
            expect(categoryRow).toBeDefined();

            // category text must be populated
            expect(row.category).not.toBeNull();
            expect(row.category!.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Behavioral adjustments group by category_id
// ---------------------------------------------------------------------------

/**
 * Property 9: Behavioral adjustments group by category_id
 *
 * For any set of completion records that share the same category_id but have
 * different raw category text values, the AdaptiveLearningEngine SHALL produce
 * a single behavioral adjustment entry keyed by that category_id, with
 * sample_size equal to the total number of those records.
 *
 * Feature: ai-category-assignment, Property 9: Behavioral adjustments group by category_id
 *
 * Validates: Requirements 6.2
 */

describe("Property 9: Behavioral adjustments group by category_id", () => {
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

  /**
   * Keyword groups: each entry is a list of description keywords that all
   * normalize to the same canonical category via the keyword normalizer.
   * We pick from these to generate descriptions that differ in raw text
   * but resolve to the same category_id.
   */
  const categoryKeywordGroups = [
    {
      category: "Writing",
      keywords: [
        "write a report",
        "blog post draft",
        "article content",
        "documentation update",
      ],
    },
    {
      category: "Development",
      keywords: [
        "code the feature",
        "develop module",
        "implement build",
        "debug the fix",
      ],
    },
    {
      category: "Design",
      keywords: [
        "design mockup",
        "ui wireframe",
        "ux prototype",
        "layout in figma",
      ],
    },
    {
      category: "Research",
      keywords: [
        "research topic",
        "investigate issue",
        "explore analysis",
        "study results",
      ],
    },
    {
      category: "Testing",
      keywords: [
        "test the feature",
        "qa validation",
        "verify quality",
        "testing check",
      ],
    },
    {
      category: "Planning",
      keywords: [
        "plan the sprint",
        "roadmap strategy",
        "prioritize backlog",
        "estimate effort",
      ],
    },
  ];

  /**
   * Arbitrary that picks a random category keyword group and generates
   * a random number of distinct descriptions from that group's keywords.
   */
  const sameCategoryRecordsArb = fc
    .integer({ min: 0, max: categoryKeywordGroups.length - 1 })
    .chain((groupIdx) => {
      const group = categoryKeywordGroups[groupIdx];
      // Generate 2-4 records, each picking a random keyword from the group
      return fc
        .array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: group.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 2, maxLength: 4 },
        )
        .map((records) => ({
          expectedCategory: group.category,
          records: records.map((r, i) => ({
            description: group.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            taskId: `task-p9-${i}`,
          })),
        }));
    });

  /**
   * **Validates: Requirements 6.2**
   *
   * For any set of completion records whose descriptions all normalize to
   * the same category, getBehavioralModel() must return a single adjustment
   * entry for that category with sample_size equal to the total record count.
   */
  it("produces a single adjustment entry per category_id with correct sample_size", () => {
    fc.assert(
      fc.property(sameCategoryRecordsArb, ({ expectedCategory, records }) => {
        // Reset state for each run
        engine.resetModel("user-1");

        // Record all completions — different raw descriptions, same category
        for (const rec of records) {
          engine.recordCompletion(
            makeRecord({
              taskId: rec.taskId,
              description: rec.description,
              estimatedTime: rec.estimatedTime,
              actualTime: rec.actualTime,
              difficultyLevel: rec.difficultyLevel,
            }),
          );
        }

        // Get the behavioral model
        const model = engine.getBehavioralModel("user-1");

        // Find adjustments matching the expected category
        const matchingAdjustments = model.adjustments.filter(
          (a) => a.category === expectedCategory,
        );

        // There must be exactly one adjustment entry for this category
        expect(matchingAdjustments).toHaveLength(1);

        // The sample_size must equal the total number of records
        expect(matchingAdjustments[0].sampleSize).toBe(records.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * For any two groups of completion records that normalize to different
   * categories, getBehavioralModel() must produce separate adjustment entries
   * for each category_id, each with the correct sample_size.
   */
  it("produces separate adjustment entries for different category_ids with correct sample_sizes", () => {
    // Pick two distinct category groups
    const twoGroupsArb = fc
      .tuple(
        fc.integer({ min: 0, max: categoryKeywordGroups.length - 1 }),
        fc.integer({ min: 0, max: categoryKeywordGroups.length - 1 }),
      )
      .filter(([a, b]) => a !== b)
      .chain(([groupIdxA, groupIdxB]) => {
        const groupA = categoryKeywordGroups[groupIdxA];
        const groupB = categoryKeywordGroups[groupIdxB];

        const recordsArbA = fc.array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: groupA.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 1, maxLength: 3 },
        );

        const recordsArbB = fc.array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: groupB.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
          }),
          { minLength: 1, maxLength: 3 },
        );

        return fc.tuple(recordsArbA, recordsArbB).map(([recsA, recsB]) => ({
          categoryA: groupA.category,
          categoryB: groupB.category,
          recordsA: recsA.map((r, i) => ({
            description: groupA.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            taskId: `task-a-${i}`,
          })),
          recordsB: recsB.map((r, i) => ({
            description: groupB.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            taskId: `task-b-${i}`,
          })),
        }));
      });

    fc.assert(
      fc.property(
        twoGroupsArb,
        ({ categoryA, categoryB, recordsA, recordsB }) => {
          // Reset state for each run
          engine.resetModel("user-1");

          // Record completions for category A
          for (const rec of recordsA) {
            engine.recordCompletion(
              makeRecord({
                taskId: rec.taskId,
                description: rec.description,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
              }),
            );
          }

          // Record completions for category B
          for (const rec of recordsB) {
            engine.recordCompletion(
              makeRecord({
                taskId: rec.taskId,
                description: rec.description,
                estimatedTime: rec.estimatedTime,
                actualTime: rec.actualTime,
                difficultyLevel: rec.difficultyLevel,
              }),
            );
          }

          // Get the behavioral model
          const model = engine.getBehavioralModel("user-1");

          // Find adjustments for each category
          const adjA = model.adjustments.filter(
            (a) => a.category === categoryA,
          );
          const adjB = model.adjustments.filter(
            (a) => a.category === categoryB,
          );

          // Each category must have exactly one adjustment entry
          expect(adjA).toHaveLength(1);
          expect(adjB).toHaveLength(1);

          // Sample sizes must match the number of records for each category
          expect(adjA[0].sampleSize).toBe(recordsA.length);
          expect(adjB[0].sampleSize).toBe(recordsB.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Analytics groups by category_id and returns display name
// ---------------------------------------------------------------------------

/**
 * Property 10: Analytics groups by category_id and returns display name
 *
 * For any set of completion records sharing the same category_id, the
 * AnalyticsAggregator SHALL group them together in category performance
 * statistics, and the returned category label SHALL equal the current name
 * from the categories table (reflecting any renames).
 *
 * Feature: ai-category-assignment, Property 10: Analytics groups by category_id and returns display name
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */

import { AnalyticsAggregator } from "../analytics-aggregator.js";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Helpers for Property 10
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
    normalizedCategory: string;
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
    opts.normalizedCategory,
    opts.categoryId,
    opts.estimatedTime,
    opts.actualTime,
    opts.difficultyLevel,
    opts.completedAt,
  );
}

// ---------------------------------------------------------------------------
// Property 10 tests
// ---------------------------------------------------------------------------

describe("Property 10: Analytics groups by category_id and returns display name", () => {
  let db: Database.Database;
  let categoryRepo: CategoryRepository;
  let aggregator: AnalyticsAggregator;

  beforeEach(() => {
    db = createDb(":memory:");
    categoryRepo = new CategoryRepository(db);
    aggregator = new AnalyticsAggregator(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Keyword groups mapping descriptions to canonical categories.
   * Used to generate completions that resolve to the same category_id.
   */
  const categoryKeywordGroups = [
    {
      category: "Writing",
      keywords: ["write a report", "blog post draft", "article content"],
    },
    {
      category: "Development",
      keywords: ["code the feature", "develop module", "implement build"],
    },
    {
      category: "Design",
      keywords: ["design mockup", "ui wireframe", "ux prototype"],
    },
    {
      category: "Research",
      keywords: ["research topic", "investigate issue", "explore analysis"],
    },
    {
      category: "Testing",
      keywords: ["test the feature", "qa validation", "verify quality"],
    },
    {
      category: "Planning",
      keywords: ["plan the sprint", "roadmap strategy", "prioritize backlog"],
    },
  ];

  /**
   * Arbitrary that generates a set of completion records all sharing the same
   * category_id, with random estimated/actual times and difficulty levels.
   */
  const sameCategoryCompletionsArb = fc
    .integer({ min: 0, max: categoryKeywordGroups.length - 1 })
    .chain((groupIdx) => {
      const group = categoryKeywordGroups[groupIdx];
      return fc
        .array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: group.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
            dayOffset: fc.integer({ min: 0, max: 29 }),
          }),
          { minLength: 1, maxLength: 5 },
        )
        .map((records) => ({
          expectedCategory: group.category,
          records: records.map((r, i) => ({
            description: group.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            dayOffset: r.dayOffset,
          })),
        }));
    });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any set of completion records sharing the same category_id,
   * the AnalyticsAggregator groups them together in category performance
   * statistics and the returned category label equals the current name
   * from the categories table.
   */
  it("groups records by category_id and returns the category table name as label", () => {
    fc.assert(
      fc.property(
        sameCategoryCompletionsArb,
        ({ expectedCategory, records }) => {
          // Reset state
          db.prepare("DELETE FROM completion_history WHERE user_id = ?").run(
            "user-p10",
          );

          ensureUser(db, "user-p10");

          // Resolve category_id from the categories table
          const catEntity = categoryRepo.findByName(expectedCategory);
          expect(catEntity).not.toBeNull();
          const categoryId = catEntity!.id;

          // Insert completion records directly with the resolved category_id
          for (const rec of records) {
            const completedAt = `2025-01-${String(1 + rec.dayOffset).padStart(2, "0")}T10:00:00Z`;
            insertCompletionDirect(db, {
              userId: "user-p10",
              description: rec.description,
              categoryId,
              normalizedCategory: expectedCategory,
              estimatedTime: rec.estimatedTime,
              actualTime: rec.actualTime,
              difficultyLevel: rec.difficultyLevel,
              completedAt,
            });
          }

          // Call getSummary which internally calls getPerformanceCategories and computeCategoryPerformance
          const summary = aggregator.getSummary(
            "user-p10",
            "2025-01-01",
            "2025-01-31",
          );

          // performanceCategories should group all records under the expected category name
          const perfCat = summary.performanceCategories.find(
            (pc) => pc.category === expectedCategory,
          );
          expect(perfCat).toBeDefined();
          expect(perfCat!.category).toBe(expectedCategory);

          // categoryPerformance.stats should also group them
          const catPerfStat = summary.categoryPerformance?.stats.find(
            (s) => s.category === expectedCategory,
          );
          expect(catPerfStat).toBeDefined();
          expect(catPerfStat!.sampleSize).toBe(records.length);
          expect(catPerfStat!.category).toBe(expectedCategory);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any two distinct category groups, the AnalyticsAggregator produces
   * separate entries in category performance statistics, each with the
   * correct sample size and category label from the categories table.
   */
  it("produces separate performance entries for different category_ids with correct labels", () => {
    const twoGroupsArb = fc
      .tuple(
        fc.integer({ min: 0, max: categoryKeywordGroups.length - 1 }),
        fc.integer({ min: 0, max: categoryKeywordGroups.length - 1 }),
      )
      .filter(([a, b]) => a !== b)
      .chain(([groupIdxA, groupIdxB]) => {
        const groupA = categoryKeywordGroups[groupIdxA];
        const groupB = categoryKeywordGroups[groupIdxB];

        const recordsArbA = fc.array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: groupA.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
            dayOffset: fc.integer({ min: 0, max: 29 }),
          }),
          { minLength: 1, maxLength: 3 },
        );

        const recordsArbB = fc.array(
          fc.record({
            keywordIdx: fc.integer({ min: 0, max: groupB.keywords.length - 1 }),
            estimatedTime: fc.integer({ min: 1, max: 500 }),
            actualTime: fc.integer({ min: 1, max: 1000 }),
            difficultyLevel: fc.integer({ min: 1, max: 5 }),
            dayOffset: fc.integer({ min: 0, max: 29 }),
          }),
          { minLength: 1, maxLength: 3 },
        );

        return fc.tuple(recordsArbA, recordsArbB).map(([recsA, recsB]) => ({
          categoryA: groupA.category,
          categoryB: groupB.category,
          recordsA: recsA.map((r) => ({
            description: groupA.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            dayOffset: r.dayOffset,
          })),
          recordsB: recsB.map((r) => ({
            description: groupB.keywords[r.keywordIdx],
            estimatedTime: r.estimatedTime,
            actualTime: r.actualTime,
            difficultyLevel: r.difficultyLevel,
            dayOffset: r.dayOffset,
          })),
        }));
      });

    fc.assert(
      fc.property(
        twoGroupsArb,
        ({ categoryA, categoryB, recordsA, recordsB }) => {
          // Reset state
          db.prepare("DELETE FROM completion_history WHERE user_id = ?").run(
            "user-p10b",
          );

          ensureUser(db, "user-p10b");

          const catEntityA = categoryRepo.findByName(categoryA);
          const catEntityB = categoryRepo.findByName(categoryB);
          expect(catEntityA).not.toBeNull();
          expect(catEntityB).not.toBeNull();

          // Insert records for category A
          for (const rec of recordsA) {
            const completedAt = `2025-01-${String(1 + rec.dayOffset).padStart(2, "0")}T10:00:00Z`;
            insertCompletionDirect(db, {
              userId: "user-p10b",
              description: rec.description,
              categoryId: catEntityA!.id,
              normalizedCategory: categoryA,
              estimatedTime: rec.estimatedTime,
              actualTime: rec.actualTime,
              difficultyLevel: rec.difficultyLevel,
              completedAt,
            });
          }

          // Insert records for category B
          for (const rec of recordsB) {
            const completedAt = `2025-01-${String(1 + rec.dayOffset).padStart(2, "0")}T11:00:00Z`;
            insertCompletionDirect(db, {
              userId: "user-p10b",
              description: rec.description,
              categoryId: catEntityB!.id,
              normalizedCategory: categoryB,
              estimatedTime: rec.estimatedTime,
              actualTime: rec.actualTime,
              difficultyLevel: rec.difficultyLevel,
              completedAt,
            });
          }

          const summary = aggregator.getSummary(
            "user-p10b",
            "2025-01-01",
            "2025-01-31",
          );

          // Both categories should appear in categoryPerformance stats
          const statA = summary.categoryPerformance?.stats.find(
            (s) => s.category === categoryA,
          );
          const statB = summary.categoryPerformance?.stats.find(
            (s) => s.category === categoryB,
          );

          expect(statA).toBeDefined();
          expect(statB).toBeDefined();
          expect(statA!.sampleSize).toBe(recordsA.length);
          expect(statB!.sampleSize).toBe(recordsB.length);
          expect(statA!.category).toBe(categoryA);
          expect(statB!.category).toBe(categoryB);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * After renaming a category, the analytics returns the new name as the
   * category label, reflecting the current state of the categories table.
   */
  it("returns the updated category name after a rename", () => {
    fc.assert(
      fc.property(
        fc.record({
          estimatedTime: fc.integer({ min: 1, max: 500 }),
          actualTime: fc.integer({ min: 1, max: 1000 }),
          difficultyLevel: fc.integer({ min: 1, max: 5 }),
        }),
        (data) => {
          // Reset state
          db.prepare("DELETE FROM completion_history WHERE user_id = ?").run(
            "user-p10c",
          );

          ensureUser(db, "user-p10c");

          // Create a custom category for this test
          const customCat = categoryRepo.upsertByName("CustomTestCategory");

          // Insert a completion record referencing this category
          insertCompletionDirect(db, {
            userId: "user-p10c",
            description: "some task",
            categoryId: customCat.id,
            normalizedCategory: "CustomTestCategory",
            estimatedTime: data.estimatedTime,
            actualTime: data.actualTime,
            difficultyLevel: data.difficultyLevel,
            completedAt: "2025-01-15T10:00:00Z",
          });

          // Verify analytics returns the original name
          let summary = aggregator.getSummary(
            "user-p10c",
            "2025-01-01",
            "2025-01-31",
          );
          let perfCat = summary.performanceCategories.find(
            (pc) => pc.category === "CustomTestCategory",
          );
          expect(perfCat).toBeDefined();

          // Rename the category
          categoryRepo.rename(customCat.id, "RenamedCategory");

          // Verify analytics now returns the new name
          summary = aggregator.getSummary(
            "user-p10c",
            "2025-01-01",
            "2025-01-31",
          );

          // The old name should no longer appear
          const oldCat = summary.performanceCategories.find(
            (pc) => pc.category === "CustomTestCategory",
          );
          expect(oldCat).toBeUndefined();

          // The new name should appear
          const newCat = summary.performanceCategories.find(
            (pc) => pc.category === "RenamedCategory",
          );
          expect(newCat).toBeDefined();
          expect(newCat!.category).toBe("RenamedCategory");

          // Clean up: rename back or delete to avoid polluting other runs
          categoryRepo.rename(customCat.id, "CustomTestCategory");
        },
      ),
      { numRuns: 50 },
    );
  });
});
