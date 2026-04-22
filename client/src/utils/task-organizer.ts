import type { AnalyzedTask, PrioritizationStrategy } from "../types/index.js";

/**
 * Orders tasks according to the given prioritization strategy.
 *
 * - "least-effort-first": ascending by effortPercentage, tiebreak by descending priority
 * - "hardest-first": descending by difficultyLevel, tiebreak by descending priority
 * - "highest-priority-first": descending by priority (stable sort preserves original order on ties)
 * - "dependency-aware": topological sort respecting dependency edges
 *
 * The input array is not mutated; a new sorted array is returned.
 */
export function orderTasks(
  tasks: AnalyzedTask[],
  strategy: PrioritizationStrategy,
): AnalyzedTask[] {
  switch (strategy) {
    case "least-effort-first":
      return sortByMetric(tasks, (t) => t.metrics.effortPercentage, "asc");
    case "hardest-first":
      return sortByMetric(tasks, (t) => t.metrics.difficultyLevel, "desc");
    case "highest-priority-first":
      return sortByMetric(tasks, (t) => t.metrics.priority, "desc");
    case "dependency-aware":
      return topologicalSort(tasks);
  }
}

/**
 * Sorts tasks by a primary metric with descending priority as tiebreaker.
 * Uses a stable comparison so equal elements preserve their relative order.
 */
function sortByMetric(
  tasks: AnalyzedTask[],
  accessor: (task: AnalyzedTask) => number,
  direction: "asc" | "desc",
): AnalyzedTask[] {
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    const valA = accessor(a);
    const valB = accessor(b);

    const primary = direction === "asc" ? valA - valB : valB - valA;
    if (primary !== 0) return primary;

    // Tiebreak: descending priority (higher priority first)
    return b.metrics.priority - a.metrics.priority;
  });
  return sorted;
}

/**
 * Produces a topological ordering of tasks based on their dependency edges.
 * Uses Kahn's algorithm (BFS-based) so that no task appears before any task
 * it depends on.
 *
 * - Only considers dependencies that reference valid task IDs in the list.
 * - Tasks with no dependencies (or whose dependencies are all invalid) are
 *   available immediately.
 * - Among tasks with zero in-degree at the same level, tasks are ordered by
 *   descending priority for a deterministic, useful default.
 * - Tasks involved in cycles (which can never reach zero in-degree) are
 *   appended at the end, sorted by descending priority.
 */
function topologicalSort(tasks: AnalyzedTask[]): AnalyzedTask[] {
  const taskMap = new Map<string, AnalyzedTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  const validIds = new Set(taskMap.keys());

  // Build in-degree counts considering only valid dependency references
  const inDegree = new Map<string, number>();
  // Reverse adjacency: for each task, which tasks depend on it?
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    const validDeps = task.metrics.dependsOn.filter((id) => validIds.has(id));
    inDegree.set(task.id, validDeps.length);
    for (const depId of validDeps) {
      dependents.get(depId)!.push(task.id);
    }
  }

  // Seed the queue with tasks that have zero in-degree, sorted by descending priority
  const queue: AnalyzedTask[] = tasks
    .filter((t) => inDegree.get(t.id) === 0)
    .sort((a, b) => b.metrics.priority - a.metrics.priority);

  const result: AnalyzedTask[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const task = queue.shift()!;
    if (visited.has(task.id)) continue;
    visited.add(task.id);
    result.push(task);

    // Collect newly unblocked dependents
    const newlyReady: AnalyzedTask[] = [];
    for (const depId of dependents.get(task.id)!) {
      const newDeg = inDegree.get(depId)! - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0 && !visited.has(depId)) {
        newlyReady.push(taskMap.get(depId)!);
      }
    }

    // Sort newly ready tasks by descending priority before adding to queue
    newlyReady.sort((a, b) => b.metrics.priority - a.metrics.priority);
    queue.push(...newlyReady);
  }

  // Append any remaining tasks (involved in cycles) sorted by descending priority
  if (result.length < tasks.length) {
    const remaining = tasks
      .filter((t) => !visited.has(t.id))
      .sort((a, b) => b.metrics.priority - a.metrics.priority);
    result.push(...remaining);
  }

  return result;
}
