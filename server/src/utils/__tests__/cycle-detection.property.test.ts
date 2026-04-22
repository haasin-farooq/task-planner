import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectCycles } from "../dependency-graph.js";
import type { AnalyzedTask } from "../../types/index.js";

/**
 * Property 4: Circular dependency detection
 *
 * For any dependency graph among tasks, if a cycle exists, the circular
 * dependency detector must identify at least one cycle. If no cycle exists,
 * the detector must report no cycles.
 *
 * Feature: ai-daily-task-planner, Property 4: Circular dependency detection
 * Validates: Requirements 2.6
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
 * Reference cycle detector using DFS — used as an oracle to verify the
 * implementation under test. Returns true if the graph contains at least
 * one cycle.
 */
function hasCycleOracle(tasks: AnalyzedTask[]): boolean {
  const validIds = new Set(tasks.map((t) => t.id));
  const adj = new Map<string, string[]>();
  for (const task of tasks) {
    adj.set(
      task.id,
      task.metrics.dependsOn.filter((id) => validIds.has(id)),
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of validIds) color.set(id, WHITE);

  for (const id of validIds) {
    if (color.get(id) !== WHITE) continue;
    const stack: string[] = [id];
    color.set(id, GRAY);
    const neighborIdx = new Map<string, number>();
    neighborIdx.set(id, 0);

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = adj.get(current) ?? [];
      const idx = neighborIdx.get(current)!;

      if (idx < neighbors.length) {
        neighborIdx.set(current, idx + 1);
        const neighbor = neighbors[idx];
        const nc = color.get(neighbor);
        if (nc === GRAY) return true;
        if (nc === WHITE) {
          color.set(neighbor, GRAY);
          neighborIdx.set(neighbor, 0);
          stack.push(neighbor);
        }
      } else {
        color.set(current, BLACK);
        stack.pop();
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a unique list of task IDs (at least 1). */
const taskIdsArb = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 })
  .filter((ids) => ids.length >= 1);

/**
 * Generates a valid DAG (no cycles). We assign each task a topological
 * index and only allow edges from higher-index tasks to lower-index tasks,
 * guaranteeing acyclicity.
 */
const dagArb = taskIdsArb.chain((ids) => {
  // ids[i] can only depend on ids[j] where j < i
  const taskArbs = ids.map((id, i) => {
    if (i === 0) {
      // First task can't depend on anything
      return fc.constant(makeTask(id, []));
    }
    const possibleDeps = ids.slice(0, i);
    const depsArb = fc.subarray(possibleDeps, {
      maxLength: Math.min(possibleDeps.length, 5),
    });
    return depsArb.map((deps) => makeTask(id, deps));
  });
  return fc.tuple(...taskArbs);
});

/**
 * Generates a graph that is guaranteed to contain at least one cycle.
 * Strategy: start with a random graph and inject a cycle of length 2+.
 */
const cyclicGraphArb = fc
  .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 20 })
  .filter((ids) => ids.length >= 2)
  .chain((ids) => {
    // Pick a cycle length between 2 and min(ids.length, 6)
    const maxCycleLen = Math.min(ids.length, 6);
    return fc.integer({ min: 2, max: maxCycleLen }).chain((cycleLen) => {
      // Pick cycleLen distinct indices for the cycle
      return fc
        .shuffledSubarray(
          ids.map((_, i) => i),
          { minLength: cycleLen, maxLength: cycleLen },
        )
        .chain((cycleIndices) => {
          // Build the cycle: cycleIndices[0] → cycleIndices[1] → ... → cycleIndices[0]
          const cycleEdges = new Map<number, number[]>();
          for (let k = 0; k < cycleIndices.length; k++) {
            const from = cycleIndices[k];
            const to = cycleIndices[(k + 1) % cycleIndices.length];
            if (!cycleEdges.has(from)) cycleEdges.set(from, []);
            cycleEdges.get(from)!.push(to);
          }

          // For each task, generate random extra edges plus the forced cycle edges
          const taskArbs = ids.map((id, i) => {
            const forcedDeps = (cycleEdges.get(i) ?? []).map((j) => ids[j]);
            // Add some random extra edges (may or may not create more cycles)
            const otherIds = ids.filter((_, j) => j !== i);
            const extraDepsArb = fc.subarray(otherIds, {
              maxLength: Math.min(otherIds.length, 3),
            });
            return extraDepsArb.map((extraDeps) => {
              const allDeps = [...new Set([...forcedDeps, ...extraDeps])];
              return makeTask(id, allDeps);
            });
          });

          return fc.tuple(...taskArbs);
        });
    });
  });

/**
 * Generates a self-referencing task list — at least one task depends on itself.
 */
const selfDepArb = taskIdsArb.chain((ids) => {
  return fc.integer({ min: 0, max: ids.length - 1 }).chain((selfIdx) => {
    const taskArbs = ids.map((id, i) => {
      if (i === selfIdx) {
        return fc.constant(makeTask(id, [id]));
      }
      return fc.constant(makeTask(id, []));
    });
    return fc.tuple(...taskArbs);
  });
});

/**
 * Generates a completely random directed graph (may or may not have cycles).
 * Used to test agreement between the implementation and the oracle.
 */
const randomGraphArb = taskIdsArb.chain((ids) => {
  const taskArbs = ids.map((id) => {
    const otherIds = ids.filter((otherId) => otherId !== id);
    // Allow self-edges too
    const depsArb = fc.subarray(ids, {
      maxLength: Math.min(ids.length, 5),
    });
    return depsArb.map((deps) => makeTask(id, deps));
  });
  return fc.tuple(...taskArbs);
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 4: Circular dependency detection", () => {
  it("reports no cycles for valid DAGs", () => {
    fc.assert(
      fc.property(dagArb, (tasks) => {
        const cycles = detectCycles(tasks);
        expect(cycles).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("detects at least one cycle in graphs with injected cycles", () => {
    fc.assert(
      fc.property(cyclicGraphArb, (tasks) => {
        const cycles = detectCycles(tasks);
        expect(cycles.length).toBeGreaterThanOrEqual(1);

        // Each reported cycle must contain at least 2 task IDs (or 1 for self-dep)
        for (const c of cycles) {
          expect(c.cycle.length).toBeGreaterThanOrEqual(1);
          expect(c.message).toContain("Circular dependency");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("detects self-dependencies as cycles", () => {
    fc.assert(
      fc.property(selfDepArb, (tasks) => {
        const cycles = detectCycles(tasks);
        expect(cycles.length).toBeGreaterThanOrEqual(1);

        // At least one cycle should be a single-node self-loop
        const selfLoops = cycles.filter((c) => c.cycle.length === 1);
        expect(selfLoops.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("reported cycle IDs are all valid task IDs", () => {
    fc.assert(
      fc.property(cyclicGraphArb, (tasks) => {
        const validIds = new Set(tasks.map((t) => t.id));
        const cycles = detectCycles(tasks);

        for (const c of cycles) {
          for (const id of c.cycle) {
            expect(validIds.has(id)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("reported cycles actually form cycles in the dependency graph", () => {
    fc.assert(
      fc.property(cyclicGraphArb, (tasks) => {
        const validIds = new Set(tasks.map((t) => t.id));
        const adj = new Map<string, Set<string>>();
        for (const task of tasks) {
          adj.set(
            task.id,
            new Set(task.metrics.dependsOn.filter((id) => validIds.has(id))),
          );
        }

        const cycles = detectCycles(tasks);
        for (const c of cycles) {
          // Each consecutive pair in the cycle must have an edge
          for (let i = 0; i < c.cycle.length; i++) {
            const from = c.cycle[i];
            const to = c.cycle[(i + 1) % c.cycle.length];
            expect(adj.get(from)?.has(to)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("agrees with oracle on random graphs (cycle exists iff detected)", () => {
    fc.assert(
      fc.property(randomGraphArb, (tasks) => {
        const oracleHasCycle = hasCycleOracle(tasks);
        const cycles = detectCycles(tasks);

        if (oracleHasCycle) {
          expect(cycles.length).toBeGreaterThanOrEqual(1);
        } else {
          expect(cycles).toEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("each reported cycle has a descriptive message", () => {
    fc.assert(
      fc.property(cyclicGraphArb, (tasks) => {
        const cycles = detectCycles(tasks);
        for (const c of cycles) {
          expect(typeof c.message).toBe("string");
          expect(c.message.length).toBeGreaterThan(0);
          expect(c.message).toContain("Circular dependency");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("returns empty array for an empty task list", () => {
    expect(detectCycles([])).toEqual([]);
  });

  it("returns empty array for tasks with no dependencies", () => {
    fc.assert(
      fc.property(taskIdsArb, (ids) => {
        const tasks = ids.map((id) => makeTask(id, []));
        expect(detectCycles(tasks)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
