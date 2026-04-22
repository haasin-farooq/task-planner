import type { AnalyzedTask, CircularDependencyError } from "../types/index.js";

/**
 * Validates that every dependency reference in the task list points to an
 * existing task ID. Returns an array of invalid dependency IDs (duplicates
 * removed).
 *
 * A dependency ID is invalid if no task in the list has that ID.
 */
export function validateDependencyRefs(tasks: AnalyzedTask[]): string[] {
  const validIds = new Set(tasks.map((t) => t.id));
  const invalidIds = new Set<string>();

  for (const task of tasks) {
    for (const depId of task.metrics.dependsOn) {
      if (!validIds.has(depId)) {
        invalidIds.add(depId);
      }
    }
  }

  return [...invalidIds];
}

/**
 * Detects circular dependencies in the task list using iterative DFS.
 *
 * Returns an array of CircularDependencyError objects, one per distinct
 * cycle found. If the dependency graph is a valid DAG, returns an empty
 * array.
 *
 * Self-dependencies (a task depending on itself) are treated as cycles.
 */
export function detectCycles(tasks: AnalyzedTask[]): CircularDependencyError[] {
  const validIds = new Set(tasks.map((t) => t.id));

  // Build adjacency list (only include edges to valid task IDs)
  const adj = new Map<string, string[]>();
  for (const task of tasks) {
    adj.set(
      task.id,
      task.metrics.dependsOn.filter((id) => validIds.has(id)),
    );
  }

  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const task of tasks) {
    color.set(task.id, WHITE);
  }

  // Track the parent (predecessor on the DFS path) so we can reconstruct cycles
  const parent = new Map<string, string | null>();

  const cycles: CircularDependencyError[] = [];
  // Keep track of cycles we've already reported (by sorted ID set) to avoid duplicates
  const reportedCycles = new Set<string>();

  for (const task of tasks) {
    if (color.get(task.id) !== WHITE) continue;

    // Iterative DFS using an explicit stack
    const stack: Array<{ id: string; neighborIdx: number }> = [];
    stack.push({ id: task.id, neighborIdx: 0 });
    color.set(task.id, GRAY);
    parent.set(task.id, null);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.id) ?? [];

      if (frame.neighborIdx < neighbors.length) {
        const neighborId = neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        const neighborColor = color.get(neighborId);

        if (neighborColor === GRAY) {
          // Found a cycle — reconstruct it
          const cycle = extractCycle(stack, frame.id, neighborId);
          const key = [...cycle].sort().join(",");
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            cycles.push({
              cycle,
              message: `Circular dependency detected: ${cycle.join(" → ")} → ${cycle[0]}`,
            });
          }
        } else if (neighborColor === WHITE) {
          color.set(neighborId, GRAY);
          parent.set(neighborId, frame.id);
          stack.push({ id: neighborId, neighborIdx: 0 });
        }
        // BLACK nodes are already fully processed — skip
      } else {
        // All neighbors processed — mark node as done
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }

  return cycles;
}

/**
 * Extracts the cycle path from the DFS stack.
 *
 * When we detect that `currentId` has a neighbor `backEdgeTarget` that is
 * already GRAY (on the current path), the cycle is:
 *   backEdgeTarget → ... → currentId → backEdgeTarget
 *
 * We walk the stack from the position of backEdgeTarget to currentId to
 * reconstruct the cycle.
 */
function extractCycle(
  stack: Array<{ id: string; neighborIdx: number }>,
  currentId: string,
  backEdgeTarget: string,
): string[] {
  const cycle: string[] = [];
  let collecting = false;

  for (const frame of stack) {
    if (frame.id === backEdgeTarget) {
      collecting = true;
    }
    if (collecting) {
      cycle.push(frame.id);
    }
    if (frame.id === currentId) {
      break;
    }
  }

  return cycle;
}

/**
 * Returns the tasks that are currently unblocked — i.e., tasks that are
 * not yet completed and whose every dependency is in the completed set.
 *
 * A task with no dependencies is always unblocked (unless already completed).
 * Only dependencies referencing valid task IDs are considered; invalid
 * dependency references are ignored.
 */
export function getUnblockedTasks(
  tasks: AnalyzedTask[],
  completedIds: Set<string>,
): AnalyzedTask[] {
  const validIds = new Set(tasks.map((t) => t.id));

  return tasks.filter((task) => {
    // Skip tasks that are already completed
    if (completedIds.has(task.id)) {
      return false;
    }

    // A task is unblocked when every valid dependency is completed
    const validDeps = task.metrics.dependsOn.filter((id) => validIds.has(id));
    return validDeps.every((depId) => completedIds.has(depId));
  });
}
