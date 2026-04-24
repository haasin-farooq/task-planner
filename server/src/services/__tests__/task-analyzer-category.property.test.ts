/**
 * Property 8: Task analysis assigns a category to every task
 *
 * For any non-empty list of parsed tasks, after analysis by the TaskAnalyzer,
 * every returned AnalyzedTask SHALL include a category string that is a valid
 * category name present in the categories table.
 *
 * Feature: ai-category-assignment, Property 8: Task analysis assigns a category to every task
 *
 * Validates: Requirements 5.1, 5.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/schema.js";
import { CategoryRepository } from "../../db/category-repository.js";
import { AICategoryAssigner } from "../ai-category-assigner.js";
import { TaskAnalyzer } from "../task-analyzer.js";
import type { ParsedTask, BehavioralModel } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock AdaptiveLearningEngine with a minimal BehavioralModel.
 */
function createMockLearningEngine() {
  const defaultModel: BehavioralModel = {
    userId: "user-1",
    totalCompletedTasks: 0,
    adjustments: [],
  };

  return {
    getBehavioralModel: vi.fn().mockReturnValue(defaultModel),
    recordCompletion: vi.fn(),
    resetModel: vi.fn(),
  } as any;
}

/**
 * Build a mock OpenAI client for the TaskAnalyzer that returns valid
 * task metrics JSON for any set of task IDs.
 */
function createTaskAnalyzerMockClient(taskIds: string[]) {
  const tasks = taskIds.map((id, i) => ({
    id,
    priority: 3,
    effortPercentage: taskIds.length > 0 ? 100 / taskIds.length : 100,
    difficultyLevel: 2,
    estimatedTime: 30,
    dependsOn: [],
  }));

  const create = vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({ tasks }),
        },
      },
    ],
  });

  return { chat: { completions: { create } } } as any;
}

/**
 * Build a mock OpenAI client for the AICategoryAssigner that returns
 * a controlled category from the seeded categories list.
 */
function createCategoryAssignerMockClient() {
  const create = vi.fn().mockImplementation(async () => {
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "Development",
              isExisting: true,
              confidence: 0.9,
            }),
          },
        },
      ],
    };
  });

  return { chat: { completions: { create } } } as any;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Arbitrary for a non-empty task description string.
 */
const taskDescriptionArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/**
 * Arbitrary for a single ParsedTask with a unique ID and random description.
 */
const parsedTaskArb = (index: number): fc.Arbitrary<ParsedTask> =>
  taskDescriptionArb.map((desc) => ({
    id: `task-${index}`,
    rawText: desc,
    description: desc,
    isAmbiguous: false,
  }));

/**
 * Arbitrary for a non-empty list of ParsedTasks (1–5 tasks).
 */
const parsedTaskListArb = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.tuple(...Array.from({ length: count }, (_, i) => parsedTaskArb(i))),
  )
  .map((tasks) => tasks as ParsedTask[]);

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("Property 8: Task analysis assigns a category to every task", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("every analyzed task has a non-empty category string that exists in the categories table and a positive integer categoryId", async () => {
    await fc.assert(
      fc.asyncProperty(parsedTaskListArb, async (tasks) => {
        // Fresh DB for each run to avoid cross-contamination
        const testDb = new Database(":memory:");
        runMigrations(testDb);
        // Insert test user for per-user category operations
        testDb
          .prepare("INSERT OR IGNORE INTO users (id) VALUES ('user-1')")
          .run();

        try {
          const categoryRepo = new CategoryRepository(testDb);
          const categoryAssignerClient = createCategoryAssignerMockClient();
          const categoryAssigner = new AICategoryAssigner(
            categoryAssignerClient,
          );

          const taskIds = tasks.map((t) => t.id);
          const taskAnalyzerClient = createTaskAnalyzerMockClient(taskIds);
          const learningEngine = createMockLearningEngine();

          const analyzer = new TaskAnalyzer(
            learningEngine,
            taskAnalyzerClient,
            "gpt-4o-mini",
            categoryAssigner,
            categoryRepo,
          );

          const result = await analyzer.analyze(tasks, "user-1");

          // Every task in the input should appear in the output
          expect(result.tasks).toHaveLength(tasks.length);

          for (const analyzedTask of result.tasks) {
            // **Validates: Requirement 5.3** — category string is present and non-empty
            expect(analyzedTask.category).toBeDefined();
            expect(typeof analyzedTask.category).toBe("string");
            expect(analyzedTask.category!.trim().length).toBeGreaterThan(0);

            // **Validates: Requirement 5.1** — categoryId is a positive integer
            expect(analyzedTask.categoryId).toBeDefined();
            expect(typeof analyzedTask.categoryId).toBe("number");
            expect(Number.isInteger(analyzedTask.categoryId)).toBe(true);
            expect(analyzedTask.categoryId!).toBeGreaterThan(0);

            // The category name must exist in the categories table
            const entity = categoryRepo.findByName(analyzedTask.category!);
            expect(entity).not.toBeNull();
            expect(entity!.id).toBe(analyzedTask.categoryId);
          }
        } finally {
          testDb.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});
