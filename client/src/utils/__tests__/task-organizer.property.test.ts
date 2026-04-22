/**
 * Property 5: Strategy-based sorting correctness
 *
 * For any list of analyzed tasks and any prioritization strategy in
 * {least-effort-first, hardest-first, highest-priority-first}, the Task
 * Organizer must produce an output where consecutive tasks are ordered
 * according to the strategy's metric (ascending for least-effort-first,
 * descending for hardest-first and highest-priority-first), and when two
 * tasks have equal values for the primary metric, they must be ordered by
 * descending priority.
 *
 * Feature: ai-daily-task-planner, Property 5: Strategy-based sorting correctness
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { orderTasks } from "../task-organizer.js";
import type {
  AnalyzedTask,
  PrioritizationStrategy,
} from "../../types/index.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid TaskMetrics object with no dependencies (for simple strategy tests). */
const taskMetricsArb = fc.record({
  priority: fc.integer({ min: 1, max: 5 }),
  effortPercentage: fc.double({ min: 0, max: 100, noNaN: true }),
  difficultyLevel: fc.integer({ min: 1, max: 5 }),
  estimatedTime: fc.integer({ min: 1, max: 480 }),
  dependsOn: fc.constant([] as string[]),
});

/** Generates a single AnalyzedTask with a unique id. */
function analyzedTaskArb(index: number): fc.Arbitrary<AnalyzedTask> {
  return taskMetricsArb.map((metrics) => ({
    id: `task-${index}`,
    rawText: `Raw task ${index}`,
    description: `Task ${index}`,
    isAmbiguous: false,
    metrics,
  }));
}

/** Generates a non-empty array of AnalyzedTasks (1 to 30 tasks). */
const taskListArb: fc.Arbitrary<AnalyzedTask[]> = fc
  .integer({ min: 1, max: 30 })
  .chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => analyzedTaskArb(i))),
  )
  .map((tuple) => [...tuple]);

/** The three simple (non-dependency-aware) strategies. */
const simpleStrategyArb: fc.Arbitrary<PrioritizationStrategy> = fc.constantFrom(
  "least-effort-first" as const,
  "hardest-first" as const,
  "highest-priority-first" as const,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the primary metric value for a task given a strategy. */
function primaryMetric(
  task: AnalyzedTask,
  strategy: PrioritizationStrategy,
): number {
  switch (strategy) {
    case "least-effort-first":
      return task.metrics.effortPercentage;
    case "hardest-first":
      return task.metrics.difficultyLevel;
    case "highest-priority-first":
      return task.metrics.priority;
    default:
      throw new Error(`Unexpected strategy: ${strategy}`);
  }
}

/** Whether the strategy sorts ascending (true) or descending (false). */
function isAscending(strategy: PrioritizationStrategy): boolean {
  return strategy === "least-effort-first";
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 5: Strategy-based sorting correctness", () => {
  it("output is correctly ordered by the strategy metric with priority tiebreaker", () => {
    fc.assert(
      fc.property(taskListArb, simpleStrategyArb, (tasks, strategy) => {
        const sorted = orderTasks(tasks, strategy);

        // The output must contain the same tasks (same length, same set of IDs)
        expect(sorted).toHaveLength(tasks.length);
        const inputIds = new Set(tasks.map((t) => t.id));
        const outputIds = new Set(sorted.map((t) => t.id));
        expect(outputIds).toEqual(inputIds);

        // Check ordering: for every consecutive pair, the ordering invariant holds
        const asc = isAscending(strategy);
        for (let i = 0; i < sorted.length - 1; i++) {
          const curr = sorted[i];
          const next = sorted[i + 1];
          const currVal = primaryMetric(curr, strategy);
          const nextVal = primaryMetric(next, strategy);

          if (asc) {
            // Ascending: current value <= next value
            expect(currVal).toBeLessThanOrEqual(nextVal);
          } else {
            // Descending: current value >= next value
            expect(currVal).toBeGreaterThanOrEqual(nextVal);
          }

          // When primary metric values are equal, tiebreak by descending priority
          if (currVal === nextVal) {
            expect(curr.metrics.priority).toBeGreaterThanOrEqual(
              next.metrics.priority,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("output is a permutation of the input (no tasks added or lost)", () => {
    fc.assert(
      fc.property(taskListArb, simpleStrategyArb, (tasks, strategy) => {
        const sorted = orderTasks(tasks, strategy);

        expect(sorted).toHaveLength(tasks.length);

        // Every input task must appear exactly once in the output
        const sortedIds = sorted.map((t) => t.id).sort();
        const inputIds = tasks.map((t) => t.id).sort();
        expect(sortedIds).toEqual(inputIds);
      }),
      { numRuns: 100 },
    );
  });

  it("does not mutate the original input array", () => {
    fc.assert(
      fc.property(taskListArb, simpleStrategyArb, (tasks, strategy) => {
        const originalIds = tasks.map((t) => t.id);
        orderTasks(tasks, strategy);
        const afterIds = tasks.map((t) => t.id);

        expect(afterIds).toEqual(originalIds);
      }),
      { numRuns: 100 },
    );
  });

  it("sorting a single task returns that task unchanged", () => {
    fc.assert(
      fc.property(analyzedTaskArb(0), simpleStrategyArb, (task, strategy) => {
        const sorted = orderTasks([task], strategy);

        expect(sorted).toHaveLength(1);
        expect(sorted[0].id).toBe(task.id);
        expect(sorted[0].metrics).toEqual(task.metrics);
      }),
      { numRuns: 100 },
    );
  });

  it("sorting is idempotent — sorting an already-sorted list produces the same order", () => {
    fc.assert(
      fc.property(taskListArb, simpleStrategyArb, (tasks, strategy) => {
        const sorted1 = orderTasks(tasks, strategy);
        const sorted2 = orderTasks(sorted1, strategy);

        const ids1 = sorted1.map((t) => t.id);
        const ids2 = sorted2.map((t) => t.id);
        expect(ids2).toEqual(ids1);
      }),
      { numRuns: 100 },
    );
  });

  it("least-effort-first orders by ascending effortPercentage", () => {
    fc.assert(
      fc.property(taskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "least-effort-first");

        for (let i = 0; i < sorted.length - 1; i++) {
          const currEffort = sorted[i].metrics.effortPercentage;
          const nextEffort = sorted[i + 1].metrics.effortPercentage;
          expect(currEffort).toBeLessThanOrEqual(nextEffort);

          if (currEffort === nextEffort) {
            expect(sorted[i].metrics.priority).toBeGreaterThanOrEqual(
              sorted[i + 1].metrics.priority,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("hardest-first orders by descending difficultyLevel", () => {
    fc.assert(
      fc.property(taskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "hardest-first");

        for (let i = 0; i < sorted.length - 1; i++) {
          const currDiff = sorted[i].metrics.difficultyLevel;
          const nextDiff = sorted[i + 1].metrics.difficultyLevel;
          expect(currDiff).toBeGreaterThanOrEqual(nextDiff);

          if (currDiff === nextDiff) {
            expect(sorted[i].metrics.priority).toBeGreaterThanOrEqual(
              sorted[i + 1].metrics.priority,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("highest-priority-first orders by descending priority", () => {
    fc.assert(
      fc.property(taskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "highest-priority-first");

        for (let i = 0; i < sorted.length - 1; i++) {
          expect(sorted[i].metrics.priority).toBeGreaterThanOrEqual(
            sorted[i + 1].metrics.priority,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
