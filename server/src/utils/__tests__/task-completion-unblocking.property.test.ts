import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getUnblockedTasks } from "../dependency-graph.js";
import type { AnalyzedTask } from "../../types/index.js";

/**
 * Property 13: Task completion unblocks dependents
 *
 * For any DAG of tasks and any task marked as complete, the set of newly
 * unblocked tasks must be exactly those tasks whose every dependency is
 * now in the completed state.
 *
 * Feature: ai-daily-task-planner, Property 13: Task completion unblocks dependents
 * Validates: Requirements 8.4
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an AnalyzedTask with minimal boilerplate. */
function makeTask(id: string, dependsOn: string[] = []): AnalyzedTask {
  return {
    id,
    rawText: id,
    description: id,
    isAmbiguous: false,
    metrics: {
      priority: 3,
      effortPercentage: 25,
      difficultyLevel: 3,
      estimatedTime: 30,
      dependsOn,
    },
  };
}

/**
 * Reference oracle: computes the expected unblocked set.
 *
 * A task is unblocked iff:
 *   1. It is NOT in the completed set, AND
 *   2. Every valid dependency (referencing an existing task ID) is in the
 *      completed set.
 */
function expectedUnblocked(
  tasks: AnalyzedTask[],
  completedIds: Set<string>,
): Set<string> {
  const validIds = new Set(tasks.map((t) => t.id));
  const result = new Set<string>();

  for (const task of tasks) {
    if (completedIds.has(task.id)) continue;

    const validDeps = task.metrics.dependsOn.filter((id) => validIds.has(id));
    if (validDeps.every((depId) => completedIds.has(depId))) {
      result.add(task.id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a unique list of task IDs (at least 1). */
const taskIdsArb = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 })
  .filter((ids) => ids.length >= 1);

/**
 * Generates a valid DAG with a random subset of tasks marked as completed.
 * Tasks are assigned topological indices so edges only go from higher-index
 * to lower-index, guaranteeing acyclicity.
 */
const dagWithCompletedArb = taskIdsArb.chain((ids) => {
  // Build DAG: ids[i] can only depend on ids[j] where j < i
  const taskArbs = ids.map((id, i) => {
    if (i === 0) {
      return fc.constant(makeTask(id, []));
    }
    const possibleDeps = ids.slice(0, i);
    const depsArb = fc.subarray(possibleDeps, {
      maxLength: Math.min(possibleDeps.length, 5),
    });
    return depsArb.map((deps) => makeTask(id, deps));
  });

  // Pick a random subset of task IDs to mark as completed
  const completedArb = fc.subarray(ids);

  return fc
    .tuple(fc.tuple(...taskArbs), completedArb)
    .map(([tasks, completed]) => ({
      tasks,
      completedIds: new Set(completed),
    }));
});

/**
 * Generates a DAG where NO tasks are completed — all root tasks (no deps)
 * should be unblocked.
 */
const dagNoneCompletedArb = taskIdsArb.chain((ids) => {
  const taskArbs = ids.map((id, i) => {
    if (i === 0) {
      return fc.constant(makeTask(id, []));
    }
    const possibleDeps = ids.slice(0, i);
    const depsArb = fc.subarray(possibleDeps, {
      maxLength: Math.min(possibleDeps.length, 5),
    });
    return depsArb.map((deps) => makeTask(id, deps));
  });

  return fc.tuple(...taskArbs).map((tasks) => ({
    tasks,
    completedIds: new Set<string>(),
  }));
});

/**
 * Generates a DAG where ALL tasks are completed — unblocked set should be
 * empty.
 */
const dagAllCompletedArb = taskIdsArb.chain((ids) => {
  const taskArbs = ids.map((id, i) => {
    if (i === 0) {
      return fc.constant(makeTask(id, []));
    }
    const possibleDeps = ids.slice(0, i);
    const depsArb = fc.subarray(possibleDeps, {
      maxLength: Math.min(possibleDeps.length, 5),
    });
    return depsArb.map((deps) => makeTask(id, deps));
  });

  return fc.tuple(...taskArbs).map((tasks) => ({
    tasks,
    completedIds: new Set(ids),
  }));
});

/**
 * Generates a flat task list (no dependencies) with a random completed subset.
 * Every non-completed task should be unblocked.
 */
const flatTasksArb = taskIdsArb.chain((ids) => {
  const tasks = ids.map((id) => makeTask(id, []));
  const completedArb = fc.subarray(ids);
  return completedArb.map((completed) => ({
    tasks,
    completedIds: new Set(completed),
  }));
});

/**
 * Generates a linear chain: task 0 → task 1 → task 2 → ... with a random
 * prefix of tasks completed. Only the first non-completed task should be
 * unblocked.
 */
const linearChainArb = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 15 })
  .filter((ids) => ids.length >= 2)
  .chain((ids) => {
    // Build a linear chain: each task depends on the previous one
    const tasks = ids.map((id, i) =>
      i === 0 ? makeTask(id, []) : makeTask(id, [ids[i - 1]]),
    );

    // Complete a random prefix of the chain (0 to ids.length tasks)
    return fc.integer({ min: 0, max: ids.length }).map((prefixLen) => ({
      tasks,
      completedIds: new Set(ids.slice(0, prefixLen)),
    }));
  });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 13: Task completion unblocks dependents", () => {
  it("unblocked set matches oracle for random DAGs with random completions", () => {
    fc.assert(
      fc.property(dagWithCompletedArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        const resultIds = new Set(result.map((t) => t.id));
        const expected = expectedUnblocked(tasks, completedIds);

        expect(resultIds).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("when no tasks are completed, only root tasks (no deps) are unblocked", () => {
    fc.assert(
      fc.property(dagNoneCompletedArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        const resultIds = new Set(result.map((t) => t.id));
        const expected = expectedUnblocked(tasks, completedIds);

        expect(resultIds).toEqual(expected);

        // Every unblocked task must have no valid dependencies
        const validIds = new Set(tasks.map((t) => t.id));
        for (const task of result) {
          const validDeps = task.metrics.dependsOn.filter((id) =>
            validIds.has(id),
          );
          expect(validDeps).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("when all tasks are completed, unblocked set is empty", () => {
    fc.assert(
      fc.property(dagAllCompletedArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        expect(result).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("completed tasks never appear in the unblocked set", () => {
    fc.assert(
      fc.property(dagWithCompletedArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        for (const task of result) {
          expect(completedIds.has(task.id)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("tasks with no dependencies are unblocked when not completed", () => {
    fc.assert(
      fc.property(flatTasksArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        const resultIds = new Set(result.map((t) => t.id));

        // Every non-completed task should be unblocked (no deps)
        for (const task of tasks) {
          if (!completedIds.has(task.id)) {
            expect(resultIds.has(task.id)).toBe(true);
          } else {
            expect(resultIds.has(task.id)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("in a linear chain, only the first non-completed task is unblocked", () => {
    fc.assert(
      fc.property(linearChainArb, ({ tasks, completedIds }) => {
        const result = getUnblockedTasks(tasks, completedIds);
        const resultIds = new Set(result.map((t) => t.id));

        if (completedIds.size === tasks.length) {
          // All completed — nothing unblocked
          expect(result).toEqual([]);
        } else {
          // Exactly one task should be unblocked: the first non-completed one
          expect(result.length).toBe(1);
          const firstNonCompleted = tasks.find((t) => !completedIds.has(t.id));
          expect(resultIds.has(firstNonCompleted!.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("completing a task's last remaining dependency unblocks it", () => {
    fc.assert(
      fc.property(dagWithCompletedArb, ({ tasks, completedIds }) => {
        // Find a task that is currently blocked (not completed, has at least
        // one incomplete valid dependency)
        const validIds = new Set(tasks.map((t) => t.id));
        const blockedTasks = tasks.filter((t) => {
          if (completedIds.has(t.id)) return false;
          const validDeps = t.metrics.dependsOn.filter((id) =>
            validIds.has(id),
          );
          return validDeps.some((depId) => !completedIds.has(depId));
        });

        if (blockedTasks.length === 0) return; // nothing to test

        // Pick the first blocked task and complete all its remaining deps
        const target = blockedTasks[0];
        const newCompleted = new Set(completedIds);
        const validDeps = target.metrics.dependsOn.filter((id) =>
          validIds.has(id),
        );
        for (const depId of validDeps) {
          newCompleted.add(depId);
        }

        const result = getUnblockedTasks(tasks, newCompleted);
        const resultIds = new Set(result.map((t) => t.id));

        // The target task should now be unblocked (unless it was also
        // added to newCompleted as a side effect of being a dependency)
        if (!newCompleted.has(target.id)) {
          expect(resultIds.has(target.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("returns empty array for an empty task list", () => {
    const result = getUnblockedTasks([], new Set());
    expect(result).toEqual([]);
  });

  it("returns empty array for an empty task list with arbitrary completed IDs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 10 }),
        (ids) => {
          const result = getUnblockedTasks([], new Set(ids));
          expect(result).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
