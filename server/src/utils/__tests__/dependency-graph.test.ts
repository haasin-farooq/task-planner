import { describe, it, expect } from "vitest";
import {
  validateDependencyRefs,
  detectCycles,
  getUnblockedTasks,
} from "../dependency-graph.js";
import type { AnalyzedTask } from "../../types/index.js";

/** Helper to create an AnalyzedTask with minimal boilerplate. */
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
// validateDependencyRefs
// ---------------------------------------------------------------------------

describe("validateDependencyRefs", () => {
  it("returns empty array when all refs are valid", () => {
    const tasks = [makeTask("a", ["b"]), makeTask("b")];
    expect(validateDependencyRefs(tasks)).toEqual([]);
  });

  it("returns invalid IDs that don't exist in the task list", () => {
    const tasks = [makeTask("a", ["b", "c"]), makeTask("b")];
    expect(validateDependencyRefs(tasks)).toEqual(["c"]);
  });

  it("deduplicates invalid IDs", () => {
    const tasks = [makeTask("a", ["missing"]), makeTask("b", ["missing"])];
    expect(validateDependencyRefs(tasks)).toEqual(["missing"]);
  });

  it("returns empty array when no tasks have dependencies", () => {
    const tasks = [makeTask("a"), makeTask("b")];
    expect(validateDependencyRefs(tasks)).toEqual([]);
  });

  it("returns empty array for an empty task list", () => {
    expect(validateDependencyRefs([])).toEqual([]);
  });

  it("detects self-reference as valid (ID exists in list)", () => {
    const tasks = [makeTask("a", ["a"])];
    // "a" exists in the task list, so it's a valid ref (cycle detection is separate)
    expect(validateDependencyRefs(tasks)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------

describe("detectCycles", () => {
  it("returns empty array for a valid DAG", () => {
    const tasks = [makeTask("a", ["b"]), makeTask("b", ["c"]), makeTask("c")];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it("detects a simple two-node cycle", () => {
    const tasks = [makeTask("a", ["b"]), makeTask("b", ["a"])];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycle).toContain("a");
    expect(cycles[0].cycle).toContain("b");
    expect(cycles[0].message).toContain("Circular dependency");
  });

  it("detects a self-dependency", () => {
    const tasks = [makeTask("a", ["a"])];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycle).toEqual(["a"]);
  });

  it("detects a three-node cycle", () => {
    const tasks = [
      makeTask("a", ["b"]),
      makeTask("b", ["c"]),
      makeTask("c", ["a"]),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycle.length).toBe(3);
  });

  it("returns empty array for an empty task list", () => {
    expect(detectCycles([])).toEqual([]);
  });

  it("returns empty array for tasks with no dependencies", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it("ignores dependency refs to non-existent tasks", () => {
    // "missing" is not in the task list, so the edge is ignored
    const tasks = [makeTask("a", ["missing"])];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it("detects cycle even when some tasks are acyclic", () => {
    const tasks = [
      makeTask("a"),
      makeTask("b", ["c"]),
      makeTask("c", ["b"]),
      makeTask("d", ["a"]),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycle).toContain("b");
    expect(cycles[0].cycle).toContain("c");
  });
});

// ---------------------------------------------------------------------------
// getUnblockedTasks
// ---------------------------------------------------------------------------

describe("getUnblockedTasks", () => {
  it("returns tasks with no dependencies when nothing is completed", () => {
    const tasks = [makeTask("a"), makeTask("b", ["a"]), makeTask("c", ["a"])];
    const unblocked = getUnblockedTasks(tasks, new Set());
    expect(unblocked.map((t) => t.id)).toEqual(["a"]);
  });

  it("unblocks dependents when their dependency is completed", () => {
    const tasks = [makeTask("a"), makeTask("b", ["a"]), makeTask("c", ["a"])];
    const unblocked = getUnblockedTasks(tasks, new Set(["a"]));
    expect(unblocked.map((t) => t.id).sort()).toEqual(["b", "c"]);
  });

  it("does not include already-completed tasks", () => {
    const tasks = [makeTask("a"), makeTask("b")];
    const unblocked = getUnblockedTasks(tasks, new Set(["a"]));
    expect(unblocked.map((t) => t.id)).toEqual(["b"]);
  });

  it("requires all dependencies to be completed", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c", ["a", "b"])];
    // Only "a" is completed — "c" still blocked by "b"
    const unblocked = getUnblockedTasks(tasks, new Set(["a"]));
    expect(unblocked.map((t) => t.id)).toEqual(["b"]);
  });

  it("returns all tasks when none have dependencies and none are completed", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const unblocked = getUnblockedTasks(tasks, new Set());
    expect(unblocked.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when all tasks are completed", () => {
    const tasks = [makeTask("a"), makeTask("b")];
    const unblocked = getUnblockedTasks(tasks, new Set(["a", "b"]));
    expect(unblocked).toEqual([]);
  });

  it("returns empty array for an empty task list", () => {
    expect(getUnblockedTasks([], new Set())).toEqual([]);
  });

  it("ignores invalid dependency refs when determining unblocked status", () => {
    // "missing" doesn't exist in the task list, so it's ignored
    const tasks = [makeTask("a", ["missing"])];
    const unblocked = getUnblockedTasks(tasks, new Set());
    expect(unblocked.map((t) => t.id)).toEqual(["a"]);
  });
});
