/**
 * Unit tests for TaskAnalyzer.
 *
 * Uses a mock OpenAI client and a mock AdaptiveLearningEngine to test
 * metric clamping, effort normalization, dependency validation, circular
 * dependency detection, behavioral model integration, and fallback behavior.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { describe, it, expect, vi } from "vitest";
import { TaskAnalyzer } from "../task-analyzer.js";
import type { ParsedTask, BehavioralModel } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock OpenAI client that satisfies the shape used by
 * TaskAnalyzer (only `chat.completions.create` is called).
 */
function createMockClient(
  ...responses: Array<{ content: string | null } | Error>
) {
  let callIndex = 0;

  const create = vi.fn().mockImplementation(async () => {
    const res = responses[callIndex++];
    if (!res) {
      throw new Error("No more mock responses configured");
    }
    if (res instanceof Error) {
      throw res;
    }
    return {
      choices: [{ message: { content: res.content } }],
    };
  });

  return {
    client: { chat: { completions: { create } } } as any,
    create,
  };
}

/**
 * Build a mock AdaptiveLearningEngine with a configurable BehavioralModel.
 */
function createMockLearningEngine(model?: Partial<BehavioralModel>) {
  const defaultModel: BehavioralModel = {
    userId: "user-1",
    totalCompletedTasks: 0,
    adjustments: [],
    ...model,
  };

  return {
    getBehavioralModel: vi.fn().mockReturnValue(defaultModel),
    recordCompletion: vi.fn(),
    resetModel: vi.fn(),
  } as any;
}

/**
 * Convenience: wrap an LLM task metrics array in the JSON string the LLM
 * would return.
 */
function llmJson(
  tasks: Array<{
    id: string;
    priority: number;
    effortPercentage: number;
    difficultyLevel: number;
    estimatedTime: number;
    dependsOn: string[];
  }>,
): string {
  return JSON.stringify({ tasks });
}

/** Helper to build a simple ParsedTask. */
function task(id: string, description = `Task ${id}`): ParsedTask {
  return {
    id,
    rawText: description,
    description,
    isAmbiguous: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskAnalyzer", () => {
  // -----------------------------------------------------------------------
  // Req 2.1, 2.3, 2.4 — Metrics clamping
  // -----------------------------------------------------------------------

  describe("metrics clamping (Req 2.1, 2.3, 2.4)", () => {
    it("clamps out-of-range priority, difficulty, and estimatedTime", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 10, // > 5 → clamped to 5
            effortPercentage: 50,
            difficultyLevel: -2, // < 1 → clamped to 1
            estimatedTime: -10, // negative → clamped to 1
            dependsOn: [],
          },
          {
            id: "t2",
            priority: 0, // < 1 → clamped to 1
            effortPercentage: 50,
            difficultyLevel: 99, // > 5 → clamped to 5
            estimatedTime: 0, // 0 → clamped to 1
            dependsOn: [],
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze([task("t1"), task("t2")], "user-1");

      expect(result.tasks).toHaveLength(2);

      const t1 = result.tasks.find((t) => t.id === "t1")!;
      expect(t1.metrics.priority).toBe(5);
      expect(t1.metrics.difficultyLevel).toBe(1);
      expect(t1.metrics.estimatedTime).toBeGreaterThanOrEqual(1);

      const t2 = result.tasks.find((t) => t.id === "t2")!;
      expect(t2.metrics.priority).toBe(1);
      expect(t2.metrics.difficultyLevel).toBe(5);
      expect(t2.metrics.estimatedTime).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.2 — Effort normalization
  // -----------------------------------------------------------------------

  describe("effort normalization (Req 2.2)", () => {
    it("normalizes effort percentages to sum to 100", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 10,
            difficultyLevel: 2,
            estimatedTime: 30,
            dependsOn: [],
          },
          {
            id: "t2",
            priority: 4,
            effortPercentage: 30,
            difficultyLevel: 3,
            estimatedTime: 60,
            dependsOn: [],
          },
          {
            id: "t3",
            priority: 2,
            effortPercentage: 20,
            difficultyLevel: 1,
            estimatedTime: 15,
            dependsOn: [],
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze(
        [task("t1"), task("t2"), task("t3")],
        "user-1",
      );

      const totalEffort = result.tasks.reduce(
        (sum, t) => sum + t.metrics.effortPercentage,
        0,
      );
      expect(totalEffort).toBeCloseTo(100, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.5 — Invalid dependency stripping
  // -----------------------------------------------------------------------

  describe("invalid dependency stripping (Req 2.5)", () => {
    it("strips dependency IDs that do not exist in the task list", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["nonexistent-task", "also-fake"],
          },
          {
            id: "t2",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t1", "ghost"],
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze([task("t1"), task("t2")], "user-1");

      const t1 = result.tasks.find((t) => t.id === "t1")!;
      expect(t1.metrics.dependsOn).toEqual([]);

      const t2 = result.tasks.find((t) => t.id === "t2")!;
      expect(t2.metrics.dependsOn).toEqual(["t1"]);
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.5 — Self-dependency removal
  // -----------------------------------------------------------------------

  describe("self-dependency removal (Req 2.5)", () => {
    it("removes self-references from dependsOn", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t1"], // self-dependency
          },
          {
            id: "t2",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t2", "t1"], // self-dependency + valid
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze([task("t1"), task("t2")], "user-1");

      const t1 = result.tasks.find((t) => t.id === "t1")!;
      expect(t1.metrics.dependsOn).not.toContain("t1");

      const t2 = result.tasks.find((t) => t.id === "t2")!;
      expect(t2.metrics.dependsOn).not.toContain("t2");
      expect(t2.metrics.dependsOn).toContain("t1");
    });
  });

  // -----------------------------------------------------------------------
  // Req 2.6 — Circular dependency detection
  // -----------------------------------------------------------------------

  describe("circular dependency detection (Req 2.6)", () => {
    it("detects circular dependencies (A→B→A)", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t2"],
          },
          {
            id: "t2",
            priority: 3,
            effortPercentage: 50,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t1"],
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze([task("t1"), task("t2")], "user-1");

      expect(result.circularDependencies.length).toBeGreaterThan(0);

      // The cycle should involve both t1 and t2
      const allCycleIds = result.circularDependencies.flatMap((c) => c.cycle);
      expect(allCycleIds).toContain("t1");
      expect(allCycleIds).toContain("t2");
    });

    it("returns empty circularDependencies for a valid DAG", async () => {
      const { client } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 33,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: [],
          },
          {
            id: "t2",
            priority: 3,
            effortPercentage: 33,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t1"],
          },
          {
            id: "t3",
            priority: 3,
            effortPercentage: 34,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: ["t2"],
          },
        ]),
      });

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze(
        [task("t1"), task("t2"), task("t3")],
        "user-1",
      );

      expect(result.circularDependencies).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.3 — Behavioral model integration
  // -----------------------------------------------------------------------

  describe("behavioral model integration (Req 6.3)", () => {
    it("includes behavioral adjustment context in system prompt when user has 10+ tasks", async () => {
      const { client, create } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 100,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: [],
          },
        ]),
      });

      const engine = createMockLearningEngine({
        userId: "user-1",
        totalCompletedTasks: 15,
        adjustments: [
          {
            category: "coding",
            timeMultiplier: 0.8,
            difficultyAdjustment: -0.2,
            sampleSize: 12,
          },
        ],
      });

      const analyzer = new TaskAnalyzer(engine, client);
      await analyzer.analyze([task("t1")], "user-1");

      // The first call should use the system prompt (non-strict mode)
      expect(create).toHaveBeenCalledTimes(1);
      const callArgs = create.mock.calls[0][0];
      const systemMessage = callArgs.messages.find(
        (m: any) => m.role === "system",
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("behavioural factors");
      expect(systemMessage.content).toContain("coding");
      expect(systemMessage.content).toContain("timeMultiplier=0.80");
    });

    it("does not include behavioral context when user has fewer than 10 tasks", async () => {
      const { client, create } = createMockClient({
        content: llmJson([
          {
            id: "t1",
            priority: 3,
            effortPercentage: 100,
            difficultyLevel: 3,
            estimatedTime: 30,
            dependsOn: [],
          },
        ]),
      });

      const engine = createMockLearningEngine({
        userId: "user-1",
        totalCompletedTasks: 5,
        adjustments: [
          {
            category: "coding",
            timeMultiplier: 0.8,
            difficultyAdjustment: -0.2,
            sampleSize: 5,
          },
        ],
      });

      const analyzer = new TaskAnalyzer(engine, client);
      await analyzer.analyze([task("t1")], "user-1");

      expect(create).toHaveBeenCalledTimes(1);
      const callArgs = create.mock.calls[0][0];
      const systemMessage = callArgs.messages.find(
        (m: any) => m.role === "system",
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).not.toContain("behavioural factors");
    });
  });

  // -----------------------------------------------------------------------
  // Default metrics on LLM failure
  // -----------------------------------------------------------------------

  describe("default metrics on LLM failure", () => {
    it("returns default metrics when both LLM calls fail", async () => {
      const { client, create } = createMockClient(
        new Error("API error"),
        new Error("API error again"),
      );

      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze(
        [task("t1"), task("t2"), task("t3")],
        "user-1",
      );

      expect(create).toHaveBeenCalledTimes(2);
      expect(result.tasks).toHaveLength(3);
      expect(result.circularDependencies).toHaveLength(0);

      for (const t of result.tasks) {
        expect(t.metrics.priority).toBe(3);
        expect(t.metrics.difficultyLevel).toBe(3);
        expect(t.metrics.estimatedTime).toBe(30);
        expect(t.metrics.dependsOn).toEqual([]);
      }

      // Effort should still sum to 100
      const totalEffort = result.tasks.reduce(
        (sum, t) => sum + t.metrics.effortPercentage,
        0,
      );
      expect(totalEffort).toBeCloseTo(100, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Empty task list
  // -----------------------------------------------------------------------

  describe("empty task list", () => {
    it("returns empty result for empty input", async () => {
      const { client, create } = createMockClient();
      const engine = createMockLearningEngine();
      const analyzer = new TaskAnalyzer(engine, client);

      const result = await analyzer.analyze([], "user-1");

      expect(result.tasks).toHaveLength(0);
      expect(result.circularDependencies).toHaveLength(0);
      // Should not call the LLM at all
      expect(create).not.toHaveBeenCalled();
    });
  });
});
