/**
 * Unit tests for REST API endpoints.
 *
 * Uses supertest to exercise each route handler with an in-memory SQLite
 * database. LLM-dependent services (parser, analyzer) are stubbed so
 * tests are deterministic and fast.
 *
 * Validates: Requirements 1.3, 2.6, 5.4, 8.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createDb } from "../db/connection.js";
import { createApp, type AppDependencies } from "../app.js";
import { TaskInputParser } from "../services/task-input-parser.js";
import { TaskAnalyzer } from "../services/task-analyzer.js";
import { AdaptiveLearningEngine } from "../services/adaptive-learning-engine.js";
import { AnalyticsAggregator } from "../services/analytics-aggregator.js";
import { PreferenceProfileStore } from "../services/preference-profile-store.js";
import type Database from "better-sqlite3";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let db: Database.Database;
let app: Express;
let learningEngine: AdaptiveLearningEngine;
let analytics: AnalyticsAggregator;
let preferenceStore: PreferenceProfileStore;

/**
 * Seed a user, session, and a set of tasks into the in-memory database.
 * Returns the sessionId and task IDs for further assertions.
 */
function seedSession(
  userId: string,
  sessionId: string,
  tasks: Array<{
    id: string;
    description: string;
    priority?: number;
    effortPercentage?: number;
    difficultyLevel?: number;
    estimatedTime?: number;
    dependsOn?: string[];
  }>,
) {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
  db.prepare(
    "INSERT INTO task_sessions (id, user_id, raw_input) VALUES (?, ?, ?)",
  ).run(sessionId, userId, "test input");

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, session_id, description, raw_text, is_ambiguous,
       priority, effort_percentage, difficulty_level, estimated_time)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  );
  const insertDep = db.prepare(
    "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
  );

  for (const t of tasks) {
    insertTask.run(
      t.id,
      sessionId,
      t.description,
      t.description,
      t.priority ?? 3,
      t.effortPercentage ?? 50,
      t.difficultyLevel ?? 3,
      t.estimatedTime ?? 30,
    );
    for (const depId of t.dependsOn ?? []) {
      insertDep.run(t.id, depId);
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  db = createDb(":memory:");
  learningEngine = new AdaptiveLearningEngine(db);
  analytics = new AnalyticsAggregator(db);
  preferenceStore = new PreferenceProfileStore(db);

  // Stub parser: returns a canned result. Empty input triggers the error path.
  const parser = {
    parse: async (rawText: string) => {
      if (!rawText || rawText.trim().length === 0) {
        return {
          tasks: [],
          ambiguousItems: [],
          errors: ["No tasks detected. Please enter at least one task."],
        };
      }
      return {
        tasks: [
          {
            id: "task-1",
            rawText,
            description: rawText.trim(),
            isAmbiguous: false,
          },
        ],
        ambiguousItems: [],
        errors: [],
      };
    },
  } as unknown as TaskInputParser;

  // Stub analyzer: returns tasks with default metrics
  const analyzer = {
    analyze: async (tasks: Array<{ id: string; description: string }>) => ({
      tasks: tasks.map((t, i) => ({
        ...t,
        rawText: t.description,
        isAmbiguous: false,
        metrics: {
          priority: 3,
          effortPercentage: tasks.length > 0 ? 100 / tasks.length : 100,
          difficultyLevel: 3,
          estimatedTime: 30,
          dependsOn: [],
        },
      })),
      circularDependencies: [],
    }),
  } as unknown as TaskAnalyzer;

  const deps: AppDependencies = {
    db,
    parser,
    analyzer,
    learningEngine,
    analytics,
    preferenceStore,
  };

  app = createApp(deps);
});

afterEach(() => {
  db.close();
});

// ===========================================================================
// POST /api/tasks/parse
// ===========================================================================

describe("POST /api/tasks/parse", () => {
  it("parses valid raw text and returns tasks", async () => {
    const res = await request(app)
      .post("/api/tasks/parse")
      .send({ rawText: "Buy groceries" });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].description).toBe("Buy groceries");
    expect(res.body.errors).toHaveLength(0);
  });

  /**
   * Req 1.3: Empty input returns error message "No tasks detected"
   */
  it("returns error for empty rawText (Req 1.3)", async () => {
    const res = await request(app)
      .post("/api/tasks/parse")
      .send({ rawText: "" });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
    expect(res.body.errors).toContain(
      "No tasks detected. Please enter at least one task.",
    );
  });

  it("returns error for whitespace-only rawText (Req 1.3)", async () => {
    const res = await request(app)
      .post("/api/tasks/parse")
      .send({ rawText: "   " });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
    expect(res.body.errors).toContain(
      "No tasks detected. Please enter at least one task.",
    );
  });

  it("returns 400 when rawText is missing", async () => {
    const res = await request(app).post("/api/tasks/parse").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rawText/i);
  });

  it("returns 400 when rawText is not a string", async () => {
    const res = await request(app)
      .post("/api/tasks/parse")
      .send({ rawText: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });
});

// ===========================================================================
// POST /api/tasks/analyze
// ===========================================================================

describe("POST /api/tasks/analyze", () => {
  it("analyzes tasks and returns a sessionId with metrics", async () => {
    const res = await request(app)
      .post("/api/tasks/analyze")
      .send({
        userId: "user-1",
        tasks: [
          {
            id: "t1",
            description: "Task one",
            rawText: "Task one",
            isAmbiguous: false,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].metrics).toBeDefined();
    expect(res.body.tasks[0].metrics.priority).toBe(3);
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app)
      .post("/api/tasks/analyze")
      .send({
        tasks: [{ id: "t1", description: "Task one" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userId/i);
  });

  it("returns 400 when tasks is empty", async () => {
    const res = await request(app)
      .post("/api/tasks/analyze")
      .send({ userId: "user-1", tasks: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tasks/i);
  });

  it("returns 400 when tasks is not an array", async () => {
    const res = await request(app)
      .post("/api/tasks/analyze")
      .send({ userId: "user-1", tasks: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tasks/i);
  });
});

// ===========================================================================
// GET /api/tasks/:sessionId
// ===========================================================================

describe("GET /api/tasks/:sessionId", () => {
  it("returns tasks for a valid session", async () => {
    seedSession("user-1", "session-1", [
      { id: "t1", description: "Task A" },
      { id: "t2", description: "Task B" },
    ]);

    const res = await request(app).get("/api/tasks/session-1");

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("session-1");
    expect(res.body.tasks).toHaveLength(2);
  });

  it("returns 404 for a non-existent session", async () => {
    const res = await request(app).get("/api/tasks/no-such-session");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("includes dependency information in returned tasks", async () => {
    seedSession("user-1", "session-dep", [
      { id: "t1", description: "Task A" },
      { id: "t2", description: "Task B", dependsOn: ["t1"] },
    ]);

    const res = await request(app).get("/api/tasks/session-dep");

    expect(res.status).toBe(200);
    const taskB = res.body.tasks.find((t: { id: string }) => t.id === "t2");
    expect(taskB.metrics.dependsOn).toContain("t1");
  });
});

// ===========================================================================
// PATCH /api/tasks/:taskId/complete
// ===========================================================================

describe("PATCH /api/tasks/:taskId/complete", () => {
  /**
   * Req 8.4: PATCH complete returns unblocked tasks
   */
  it("marks a task complete and returns unblocked tasks (Req 8.4)", async () => {
    // t2 depends on t1. Completing t1 should unblock t2.
    seedSession("user-1", "session-unblock", [
      { id: "t1", description: "Task A", estimatedTime: 20 },
      { id: "t2", description: "Task B", dependsOn: ["t1"], estimatedTime: 30 },
    ]);

    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: 15 });

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.taskId).toBe("t1");
    expect(res.body.actualTime).toBe(15);

    // t2 should now be unblocked
    const unblockedIds = res.body.unblockedTasks.map(
      (t: { id: string }) => t.id,
    );
    expect(unblockedIds).toContain("t2");
  });

  it("returns unblocked tasks that have no dependencies", async () => {
    // t1 has no deps, t2 depends on t1, t3 has no deps
    seedSession("user-1", "session-multi", [
      { id: "t1", description: "Task A" },
      { id: "t2", description: "Task B", dependsOn: ["t1"] },
      { id: "t3", description: "Task C" },
    ]);

    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: 10 });

    expect(res.status).toBe(200);
    // t2 is now unblocked, t3 was always unblocked (no deps, not completed)
    const unblockedIds = res.body.unblockedTasks.map(
      (t: { id: string }) => t.id,
    );
    expect(unblockedIds).toContain("t2");
    expect(unblockedIds).toContain("t3");
    // t1 is completed, so it should NOT be in the unblocked list
    expect(unblockedIds).not.toContain("t1");
  });

  it("returns 400 when actualTime is missing", async () => {
    seedSession("user-1", "session-err", [{ id: "t1", description: "Task A" }]);

    const res = await request(app).patch("/api/tasks/t1/complete").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/actualTime/i);
  });

  it("returns 400 when actualTime is not a positive number", async () => {
    seedSession("user-1", "session-neg", [{ id: "t1", description: "Task A" }]);

    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  it("returns 400 when actualTime is zero", async () => {
    seedSession("user-1", "session-zero", [
      { id: "t1", description: "Task A" },
    ]);

    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/i);
  });

  it("returns 404 for a non-existent task", async () => {
    const res = await request(app)
      .patch("/api/tasks/no-such-task/complete")
      .send({ actualTime: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 409 when task is already completed", async () => {
    seedSession("user-1", "session-dup", [{ id: "t1", description: "Task A" }]);

    // Complete once
    await request(app).patch("/api/tasks/t1/complete").send({ actualTime: 10 });

    // Try to complete again
    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: 10 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already completed/i);
  });

  it("does not include already-completed tasks in unblocked list", async () => {
    // t1 and t2 have no deps, t3 depends on t1
    seedSession("user-1", "session-filter", [
      { id: "t1", description: "Task A" },
      { id: "t2", description: "Task B" },
      { id: "t3", description: "Task C", dependsOn: ["t1"] },
    ]);

    // Complete t2 first
    await request(app).patch("/api/tasks/t2/complete").send({ actualTime: 10 });

    // Now complete t1 — t3 should be unblocked, t2 should NOT appear
    const res = await request(app)
      .patch("/api/tasks/t1/complete")
      .send({ actualTime: 15 });

    expect(res.status).toBe(200);
    const unblockedIds = res.body.unblockedTasks.map(
      (t: { id: string }) => t.id,
    );
    expect(unblockedIds).toContain("t3");
    expect(unblockedIds).not.toContain("t1");
    expect(unblockedIds).not.toContain("t2");
  });
});

// ===========================================================================
// GET /api/preferences/:userId
// ===========================================================================

describe("GET /api/preferences/:userId", () => {
  /**
   * Req 5.4: Default strategy is "highest-priority-first" when no profile exists
   */
  it("returns default strategy when no profile exists (Req 5.4)", async () => {
    const res = await request(app).get("/api/preferences/new-user");

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("new-user");
    expect(res.body.strategy).toBe("highest-priority-first");
  });

  it("returns saved strategy after PUT", async () => {
    await request(app)
      .put("/api/preferences/user-1")
      .send({ strategy: "hardest-first" });

    const res = await request(app).get("/api/preferences/user-1");

    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe("hardest-first");
  });
});

// ===========================================================================
// PUT /api/preferences/:userId
// ===========================================================================

describe("PUT /api/preferences/:userId", () => {
  it("saves a valid strategy", async () => {
    const res = await request(app)
      .put("/api/preferences/user-1")
      .send({ strategy: "least-effort-first" });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-1");
    expect(res.body.strategy).toBe("least-effort-first");
  });

  it("returns 400 when strategy is missing", async () => {
    const res = await request(app).put("/api/preferences/user-1").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/strategy/i);
  });

  it("returns 400 for an invalid strategy value", async () => {
    const res = await request(app)
      .put("/api/preferences/user-1")
      .send({ strategy: "invalid-strategy" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid strategy/i);
  });

  it("accepts all four valid strategies", async () => {
    const strategies = [
      "least-effort-first",
      "hardest-first",
      "highest-priority-first",
      "dependency-aware",
    ];

    for (const strategy of strategies) {
      const res = await request(app)
        .put("/api/preferences/user-1")
        .send({ strategy });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe(strategy);
    }
  });
});

// ===========================================================================
// GET /api/analytics/:userId
// ===========================================================================

describe("GET /api/analytics/:userId", () => {
  it("returns analytics summary for valid date range", async () => {
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run("user-1");

    const res = await request(app)
      .get("/api/analytics/user-1")
      .query({ startDate: "2024-01-01", endDate: "2024-12-31" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("dailyStats");
    expect(res.body).toHaveProperty("difficultyBreakdown");
    expect(res.body).toHaveProperty("performanceCategories");
    expect(res.body).toHaveProperty("insufficientData");
    // No data seeded, so insufficientData should be true
    expect(res.body.insufficientData).toBe(true);
  });

  it("returns 400 when startDate is missing", async () => {
    const res = await request(app)
      .get("/api/analytics/user-1")
      .query({ endDate: "2024-12-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate/i);
  });

  it("returns 400 when endDate is missing", async () => {
    const res = await request(app)
      .get("/api/analytics/user-1")
      .query({ startDate: "2024-01-01" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/endDate/i);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await request(app)
      .get("/api/analytics/user-1")
      .query({ startDate: "not-a-date", endDate: "2024-12-31" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/i);
  });
});

// ===========================================================================
// DELETE /api/learning/:userId
// ===========================================================================

describe("DELETE /api/learning/:userId", () => {
  it("resets the behavioral model and returns confirmation", async () => {
    const res = await request(app).delete("/api/learning/user-1");

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-1");
    expect(res.body.reset).toBe(true);
  });
});

// ===========================================================================
// GET /api/health
// ===========================================================================

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
