/**
 * Property 6: Dependency-aware ordering respects dependencies
 *
 * For any set of analyzed tasks forming a valid DAG, the "dependency-aware"
 * ordering must produce a sequence where no task appears before any task it
 * depends on (i.e., the output is a valid topological sort).
 *
 * Feature: ai-daily-task-planner, Property 6: Dependency-aware ordering respects dependencies
 *
 * Validates: Requirements 4.5
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { orderTasks } from "../task-organizer.js";
import type { AnalyzedTask } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a list of AnalyzedTasks forming a valid DAG.
 *
 * Strategy: tasks are created in index order 0..n-1. A task at index i can
 * only depend on tasks with index < i. This guarantees the dependency graph
 * is acyclic by construction.
 */
const dagTaskListArb: fc.Arbitrary<AnalyzedTask[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((n) => {
    // For each task, generate its metrics and a subset of earlier task indices as deps
    const taskArbs = Array.from({ length: n }, (_, i) => {
      const depsArb =
        i === 0
          ? fc.constant([] as number[])
          : fc.subarray(
              Array.from({ length: i }, (_, j) => j),
              { minLength: 0 },
            );

      return fc
        .tuple(
          fc.integer({ min: 1, max: 5 }), // priority
          fc.double({ min: 0.1, max: 100, noNaN: true }), // effortPercentage
          fc.integer({ min: 1, max: 5 }), // difficultyLevel
          fc.integer({ min: 1, max: 480 }), // estimatedTime
          depsArb,
        )
        .map(
          ([
            priority,
            effortPercentage,
            difficultyLevel,
            estimatedTime,
            depIndices,
          ]) => ({
            index: i,
            priority,
            effortPercentage,
            difficultyLevel,
            estimatedTime,
            depIndices,
          }),
        );
    });

    return fc.tuple(...taskArbs);
  })
  .map((tuples) => {
    const items = [...tuples];
    return items.map((item) => ({
      id: `task-${item.index}`,
      rawText: `Raw task ${item.index}`,
      description: `Task ${item.index}`,
      isAmbiguous: false,
      metrics: {
        priority: item.priority,
        effortPercentage: item.effortPercentage,
        difficultyLevel: item.difficultyLevel,
        estimatedTime: item.estimatedTime,
        dependsOn: item.depIndices.map((j: number) => `task-${j}`),
      },
    }));
  });

/**
 * Generates a list of AnalyzedTasks with NO dependencies (independent tasks).
 */
const independentTaskListArb: fc.Arbitrary<AnalyzedTask[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((n) => {
    const taskArbs = Array.from({ length: n }, (_, i) =>
      fc
        .tuple(
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0.1, max: 100, noNaN: true }),
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 480 }),
        )
        .map(
          ([priority, effortPercentage, difficultyLevel, estimatedTime]) => ({
            id: `task-${i}`,
            rawText: `Raw task ${i}`,
            description: `Task ${i}`,
            isAmbiguous: false,
            metrics: {
              priority,
              effortPercentage,
              difficultyLevel,
              estimatedTime,
              dependsOn: [] as string[],
            },
          }),
        ),
    );
    return fc.tuple(...taskArbs);
  })
  .map((tuple) => [...tuple]);

/**
 * Generates a linear chain DAG: task-0 <- task-1 <- task-2 <- ... <- task-(n-1)
 * Each task depends on the one before it.
 */
const linearChainArb: fc.Arbitrary<AnalyzedTask[]> = fc
  .integer({ min: 2, max: 15 })
  .chain((n) => {
    const taskArbs = Array.from({ length: n }, (_, i) =>
      fc
        .tuple(
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0.1, max: 100, noNaN: true }),
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 480 }),
        )
        .map(
          ([priority, effortPercentage, difficultyLevel, estimatedTime]) => ({
            id: `task-${i}`,
            rawText: `Raw task ${i}`,
            description: `Task ${i}`,
            isAmbiguous: false,
            metrics: {
              priority,
              effortPercentage,
              difficultyLevel,
              estimatedTime,
              dependsOn: i === 0 ? [] : [`task-${i - 1}`],
            },
          }),
        ),
    );
    return fc.tuple(...taskArbs);
  })
  .map((tuple) => [...tuple]);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 6: Dependency-aware ordering respects dependencies", () => {
  it("no task appears before any of its dependencies in the output", () => {
    fc.assert(
      fc.property(dagTaskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "dependency-aware");

        // Build a position map: task ID -> index in sorted output
        const position = new Map<string, number>();
        sorted.forEach((t, idx) => position.set(t.id, idx));

        // For every task, all of its dependencies must appear earlier
        for (const task of sorted) {
          for (const depId of task.metrics.dependsOn) {
            const depPos = position.get(depId);
            const taskPos = position.get(task.id);
            expect(depPos).toBeDefined();
            expect(taskPos).toBeDefined();
            expect(depPos!).toBeLessThan(taskPos!);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("output is a permutation of the input (no tasks added or lost)", () => {
    fc.assert(
      fc.property(dagTaskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "dependency-aware");

        expect(sorted).toHaveLength(tasks.length);

        const inputIds = tasks.map((t) => t.id).sort();
        const outputIds = sorted.map((t) => t.id).sort();
        expect(outputIds).toEqual(inputIds);
      }),
      { numRuns: 200 },
    );
  });

  it("does not mutate the original input array", () => {
    fc.assert(
      fc.property(dagTaskListArb, (tasks) => {
        const originalIds = tasks.map((t) => t.id);
        orderTasks(tasks, "dependency-aware");
        const afterIds = tasks.map((t) => t.id);

        expect(afterIds).toEqual(originalIds);
      }),
      { numRuns: 100 },
    );
  });

  it("a single task with no dependencies is returned as-is", () => {
    fc.assert(
      fc.property(
        fc.record({
          priority: fc.integer({ min: 1, max: 5 }),
          effortPercentage: fc.double({ min: 0.1, max: 100, noNaN: true }),
          difficultyLevel: fc.integer({ min: 1, max: 5 }),
          estimatedTime: fc.integer({ min: 1, max: 480 }),
        }),
        (metrics) => {
          const task: AnalyzedTask = {
            id: "task-0",
            rawText: "Raw task 0",
            description: "Task 0",
            isAmbiguous: false,
            metrics: { ...metrics, dependsOn: [] },
          };

          const sorted = orderTasks([task], "dependency-aware");
          expect(sorted).toHaveLength(1);
          expect(sorted[0].id).toBe("task-0");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("linear chain is sorted in dependency order", () => {
    fc.assert(
      fc.property(linearChainArb, (tasks) => {
        const sorted = orderTasks(tasks, "dependency-aware");

        // In a linear chain task-0 -> task-1 -> ... -> task-(n-1),
        // the only valid topological order is task-0, task-1, ..., task-(n-1)
        expect(sorted).toHaveLength(tasks.length);
        for (let i = 0; i < sorted.length; i++) {
          expect(sorted[i].id).toBe(`task-${i}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("independent tasks are all present in the output", () => {
    fc.assert(
      fc.property(independentTaskListArb, (tasks) => {
        const sorted = orderTasks(tasks, "dependency-aware");

        expect(sorted).toHaveLength(tasks.length);

        const inputIds = new Set(tasks.map((t) => t.id));
        const outputIds = new Set(sorted.map((t) => t.id));
        expect(outputIds).toEqual(inputIds);
      }),
      { numRuns: 100 },
    );
  });

  it("sorting is idempotent — sorting an already-sorted list produces the same order", () => {
    fc.assert(
      fc.property(dagTaskListArb, (tasks) => {
        const sorted1 = orderTasks(tasks, "dependency-aware");
        const sorted2 = orderTasks(sorted1, "dependency-aware");

        const ids1 = sorted1.map((t) => t.id);
        const ids2 = sorted2.map((t) => t.id);
        expect(ids2).toEqual(ids1);
      }),
      { numRuns: 100 },
    );
  });
});
