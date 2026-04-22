import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateDependencyRefs } from "../dependency-graph.js";
import type { AnalyzedTask } from "../../types/index.js";

/**
 * Property 3: Dependency references are valid
 *
 * For any analyzed task list, every task ID referenced in any task's
 * `dependsOn` array must correspond to an existing task ID within the same
 * task list.
 *
 * Feature: ai-daily-task-planner, Property 3: Dependency references are valid
 * Validates: Requirements 2.5
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

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a unique list of task IDs. */
const taskIdsArb = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 })
  .filter((ids) => ids.length >= 1);

/**
 * Generates a task list where every dependency reference points to a valid
 * task ID within the list (all refs are valid).
 */
const validTaskListArb = taskIdsArb.chain((ids) => {
  const taskArbs = ids.map((id) => {
    // Each task can depend on any other task in the list (not itself, but
    // self-refs are technically valid IDs — the validator only checks existence)
    const depsArb = fc.subarray(ids, { maxLength: Math.min(ids.length, 5) });
    return depsArb.map((deps) => makeTask(id, deps));
  });
  return fc.tuple(...taskArbs);
});

/**
 * Generates a task list where at least one dependency reference points to
 * an ID that does NOT exist in the task list (at least one invalid ref).
 */
const invalidTaskListArb = taskIdsArb.chain((ids) => {
  // Generate some IDs that are guaranteed to NOT be in the task list
  const invalidIdArb = fc.uuid().filter((id) => !ids.includes(id));
  const invalidIdsArb = fc.array(invalidIdArb, {
    minLength: 1,
    maxLength: 5,
  });

  return invalidIdsArb.chain((invalidIds) => {
    // Pick a random task index to inject at least one invalid ref
    return fc.integer({ min: 0, max: ids.length - 1 }).chain((targetIdx) => {
      const taskArbs = ids.map((id, idx) => {
        if (idx === targetIdx) {
          // This task gets at least one invalid dependency reference
          const validDepsArb = fc.subarray(ids, {
            maxLength: Math.min(ids.length, 3),
          });
          const injectedInvalidArb = fc.subarray(invalidIds, {
            minLength: 1,
            maxLength: invalidIds.length,
          });
          return fc
            .tuple(validDepsArb, injectedInvalidArb)
            .map(([validDeps, injected]) =>
              makeTask(id, [...validDeps, ...injected]),
            );
        }
        // Other tasks get only valid deps
        const depsArb = fc.subarray(ids, {
          maxLength: Math.min(ids.length, 3),
        });
        return depsArb.map((deps) => makeTask(id, deps));
      });
      return fc.tuple(...taskArbs).map((tasks) => ({
        tasks,
        invalidIds,
      }));
    });
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 3: Dependency references are valid", () => {
  it("returns no invalid refs when all dependencies reference existing task IDs", () => {
    fc.assert(
      fc.property(validTaskListArb, (tasks) => {
        const invalidRefs = validateDependencyRefs(tasks);
        expect(invalidRefs).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("catches every invalid dependency reference", () => {
    fc.assert(
      fc.property(invalidTaskListArb, ({ tasks, invalidIds }) => {
        const result = validateDependencyRefs(tasks);

        // The validator must return at least one invalid ref
        expect(result.length).toBeGreaterThan(0);

        // Every returned invalid ref must actually be invalid (not in the task list)
        const validIds = new Set(tasks.map((t) => t.id));
        for (const ref of result) {
          expect(validIds.has(ref)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("returned invalid refs are exactly the set of non-existent referenced IDs", () => {
    fc.assert(
      fc.property(invalidTaskListArb, ({ tasks }) => {
        const validIds = new Set(tasks.map((t) => t.id));

        // Compute expected invalid refs manually
        const expectedInvalid = new Set<string>();
        for (const task of tasks) {
          for (const depId of task.metrics.dependsOn) {
            if (!validIds.has(depId)) {
              expectedInvalid.add(depId);
            }
          }
        }

        const result = validateDependencyRefs(tasks);
        const resultSet = new Set(result);

        // Result should contain no duplicates
        expect(result.length).toBe(resultSet.size);

        // Result set should match expected set exactly
        expect(resultSet).toEqual(expectedInvalid);
      }),
      { numRuns: 200 },
    );
  });

  it("returns no invalid refs for tasks with no dependencies", () => {
    fc.assert(
      fc.property(taskIdsArb, (ids) => {
        const tasks = ids.map((id) => makeTask(id, []));
        const result = validateDependencyRefs(tasks);
        expect(result).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("returns no invalid refs for an empty task list", () => {
    const result = validateDependencyRefs([]);
    expect(result).toEqual([]);
  });

  it("self-references are treated as valid (ID exists in the list)", () => {
    fc.assert(
      fc.property(taskIdsArb, (ids) => {
        // Every task depends on itself
        const tasks = ids.map((id) => makeTask(id, [id]));
        const result = validateDependencyRefs(tasks);
        expect(result).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("returned invalid refs contain no duplicates", () => {
    // Generate tasks where the same invalid ID appears in multiple tasks
    const arb = taskIdsArb.chain((ids) => {
      const bogusIdArb = fc.uuid().filter((id) => !ids.includes(id));
      return bogusIdArb.map((bogusId) => {
        // Every task references the same bogus ID
        return ids.map((id) => makeTask(id, [bogusId]));
      });
    });

    fc.assert(
      fc.property(arb, (tasks) => {
        const result = validateDependencyRefs(tasks);
        const unique = new Set(result);
        expect(result.length).toBe(unique.size);
      }),
      { numRuns: 200 },
    );
  });
});
