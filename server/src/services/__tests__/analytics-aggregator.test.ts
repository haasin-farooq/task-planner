import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { AnalyticsAggregator } from "../analytics-aggregator.js";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureUser(db: Database.Database, userId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
}

function insertCompletion(
  db: Database.Database,
  overrides: {
    userId?: string;
    description?: string;
    category?: string;
    estimatedTime?: number;
    actualTime?: number;
    difficultyLevel?: number;
    completedAt?: string;
  } = {},
): void {
  const userId = overrides.userId ?? "user-1";
  ensureUser(db, userId);

  db.prepare(
    `INSERT INTO completion_history
       (id, user_id, task_description, category, estimated_time, actual_time, difficulty_level, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    userId,
    overrides.description ?? "task",
    overrides.category ?? "general",
    overrides.estimatedTime ?? 60,
    overrides.actualTime ?? 45,
    overrides.difficultyLevel ?? 3,
    overrides.completedAt ?? "2025-01-15T10:00:00Z",
  );
}

function createSession(
  db: Database.Database,
  userId: string,
  sessionId: string,
  createdAt: string,
): void {
  ensureUser(db, userId);
  db.prepare(
    "INSERT INTO task_sessions (id, user_id, raw_input, created_at) VALUES (?, ?, ?, ?)",
  ).run(sessionId, userId, "raw input", createdAt);
}

function createTask(
  db: Database.Database,
  sessionId: string,
  taskId: string,
  isCompleted: boolean,
): void {
  db.prepare(
    `INSERT INTO tasks (id, session_id, description, raw_text, is_completed, priority, difficulty_level, effort_percentage, estimated_time)
     VALUES (?, ?, ?, ?, ?, 3, 3, 25, 60)`,
  ).run(taskId, sessionId, "task desc", "raw", isCompleted ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalyticsAggregator", () => {
  let db: Database.Database;
  let aggregator: AnalyticsAggregator;

  beforeEach(() => {
    db = createDb(":memory:");
    aggregator = new AnalyticsAggregator(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- getSummary: empty state ---

  describe("getSummary", () => {
    it("should return empty summary for a user with no history", () => {
      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.dailyStats).toEqual([]);
      expect(summary.difficultyBreakdown).toEqual([]);
      expect(summary.performanceCategories).toEqual([]);
      expect(summary.insufficientData).toBe(true);
      expect(summary.dailyProgressPercent).toBe(0);
    });

    // --- insufficientData flag ---

    it("should set insufficientData to true when fewer than 5 tasks in range", () => {
      for (let i = 0; i < 4; i++) {
        insertCompletion(db, { completedAt: "2025-01-15T10:00:00Z" });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.insufficientData).toBe(true);
    });

    it("should set insufficientData to false when 5 or more tasks in range", () => {
      for (let i = 0; i < 5; i++) {
        insertCompletion(db, { completedAt: "2025-01-15T10:00:00Z" });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.insufficientData).toBe(false);
    });

    it("should only count tasks within the date range for insufficientData", () => {
      // 3 inside range
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, { completedAt: "2025-01-15T10:00:00Z" });
      }
      // 3 outside range
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, { completedAt: "2025-02-15T10:00:00Z" });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.insufficientData).toBe(true);
    });

    // --- dailyStats ---

    it("should compute daily stats correctly", () => {
      insertCompletion(db, {
        actualTime: 30,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        actualTime: 50,
        estimatedTime: 40,
        completedAt: "2025-01-15T14:00:00Z",
      });
      insertCompletion(db, {
        actualTime: 20,
        estimatedTime: 25,
        completedAt: "2025-01-16T09:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.dailyStats).toHaveLength(2);

      const day1 = summary.dailyStats.find((s) => s.date === "2025-01-15");
      expect(day1).toBeDefined();
      expect(day1!.tasksCompleted).toBe(2);
      expect(day1!.avgActualTime).toBeCloseTo(40, 4); // (30+50)/2
      expect(day1!.avgEstimatedTime).toBeCloseTo(50, 4); // (60+40)/2

      const day2 = summary.dailyStats.find((s) => s.date === "2025-01-16");
      expect(day2).toBeDefined();
      expect(day2!.tasksCompleted).toBe(1);
      expect(day2!.avgActualTime).toBeCloseTo(20, 4);
      expect(day2!.avgEstimatedTime).toBeCloseTo(25, 4);
    });

    it("should return daily stats ordered by date", () => {
      insertCompletion(db, { completedAt: "2025-01-20T10:00:00Z" });
      insertCompletion(db, { completedAt: "2025-01-10T10:00:00Z" });
      insertCompletion(db, { completedAt: "2025-01-15T10:00:00Z" });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      const dates = summary.dailyStats.map((s) => s.date);
      expect(dates).toEqual(["2025-01-10", "2025-01-15", "2025-01-20"]);
    });

    // --- difficultyBreakdown ---

    it("should compute difficulty breakdown correctly", () => {
      insertCompletion(db, {
        difficultyLevel: 1,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 1,
        completedAt: "2025-01-15T11:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 3,
        completedAt: "2025-01-15T12:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 5,
        completedAt: "2025-01-15T13:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.difficultyBreakdown).toHaveLength(3);

      const d1 = summary.difficultyBreakdown.find(
        (d) => d.difficultyLevel === 1,
      );
      const d3 = summary.difficultyBreakdown.find(
        (d) => d.difficultyLevel === 3,
      );
      const d5 = summary.difficultyBreakdown.find(
        (d) => d.difficultyLevel === 5,
      );

      expect(d1!.count).toBe(2);
      expect(d3!.count).toBe(1);
      expect(d5!.count).toBe(1);
    });

    it("should order difficulty breakdown by difficulty level", () => {
      insertCompletion(db, {
        difficultyLevel: 5,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 1,
        completedAt: "2025-01-15T11:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 3,
        completedAt: "2025-01-15T12:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      const levels = summary.difficultyBreakdown.map((d) => d.difficultyLevel);
      expect(levels).toEqual([1, 3, 5]);
    });

    // --- performanceCategories ---

    it("should label category as 'area-for-improvement' when actual > estimated", () => {
      insertCompletion(db, {
        category: "coding",
        actualTime: 90,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.performanceCategories).toHaveLength(1);
      expect(summary.performanceCategories[0].category).toBe("coding");
      expect(summary.performanceCategories[0].label).toBe(
        "area-for-improvement",
      );
      expect(summary.performanceCategories[0].avgActualTime).toBeCloseTo(90, 4);
      expect(summary.performanceCategories[0].avgEstimatedTime).toBeCloseTo(
        60,
        4,
      );
    });

    it("should label category as 'strength' when actual < estimated", () => {
      insertCompletion(db, {
        category: "writing",
        actualTime: 30,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.performanceCategories).toHaveLength(1);
      expect(summary.performanceCategories[0].category).toBe("writing");
      expect(summary.performanceCategories[0].label).toBe("strength");
    });

    it("should label category as 'strength' when actual equals estimated", () => {
      insertCompletion(db, {
        category: "design",
        actualTime: 60,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.performanceCategories).toHaveLength(1);
      expect(summary.performanceCategories[0].label).toBe("strength");
    });

    it("should compute averages per category across multiple records", () => {
      insertCompletion(db, {
        category: "coding",
        actualTime: 40,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        category: "coding",
        actualTime: 80,
        estimatedTime: 60,
        completedAt: "2025-01-15T11:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      const coding = summary.performanceCategories.find(
        (c) => c.category === "coding",
      );
      expect(coding).toBeDefined();
      // avg actual: (40+80)/2 = 60, avg estimated: (60+60)/2 = 60
      expect(coding!.avgActualTime).toBeCloseTo(60, 4);
      expect(coding!.avgEstimatedTime).toBeCloseTo(60, 4);
      expect(coding!.label).toBe("strength"); // equal → strength
    });

    // --- user isolation ---

    it("should only return data for the specified user", () => {
      insertCompletion(db, {
        userId: "user-1",
        actualTime: 30,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        userId: "user-2",
        actualTime: 90,
        estimatedTime: 60,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      expect(summary.dailyStats).toHaveLength(1);
      expect(summary.dailyStats[0].tasksCompleted).toBe(1);
      expect(summary.dailyStats[0].avgActualTime).toBeCloseTo(30, 4);
    });
  });

  // --- getDailyProgress ---

  describe("getDailyProgress", () => {
    it("should return 0 when no session exists for the date", () => {
      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBe(0);
    });

    it("should return 0 when session has no tasks", () => {
      createSession(db, "user-1", "session-1", "2025-01-15T08:00:00Z");

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBe(0);
    });

    it("should return correct percentage for partially completed session", () => {
      createSession(db, "user-1", "session-1", "2025-01-15T08:00:00Z");
      createTask(db, "session-1", "t1", true);
      createTask(db, "session-1", "t2", false);
      createTask(db, "session-1", "t3", false);
      createTask(db, "session-1", "t4", false);

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBeCloseTo(25, 4); // 1/4 * 100
    });

    it("should return 100 when all tasks are completed", () => {
      createSession(db, "user-1", "session-1", "2025-01-15T08:00:00Z");
      createTask(db, "session-1", "t1", true);
      createTask(db, "session-1", "t2", true);
      createTask(db, "session-1", "t3", true);

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBeCloseTo(100, 4);
    });

    it("should return 0 when no tasks are completed", () => {
      createSession(db, "user-1", "session-1", "2025-01-15T08:00:00Z");
      createTask(db, "session-1", "t1", false);
      createTask(db, "session-1", "t2", false);

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBe(0);
    });

    it("should use the most recent session when multiple exist on the same date", () => {
      createSession(db, "user-1", "session-1", "2025-01-15T08:00:00Z");
      createTask(db, "session-1", "t1", true);
      createTask(db, "session-1", "t2", true);

      createSession(db, "user-1", "session-2", "2025-01-15T14:00:00Z");
      createTask(db, "session-2", "t3", true);
      createTask(db, "session-2", "t4", false);
      createTask(db, "session-2", "t5", false);
      createTask(db, "session-2", "t6", false);

      // Should use session-2 (most recent): 1/4 = 25%
      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBeCloseTo(25, 4);
    });

    it("should not return progress from a different user's session", () => {
      createSession(db, "user-2", "session-1", "2025-01-15T08:00:00Z");
      createTask(db, "session-1", "t1", true);
      createTask(db, "session-1", "t2", true);

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBe(0);
    });

    it("should not return progress from a different date", () => {
      createSession(db, "user-1", "session-1", "2025-01-14T08:00:00Z");
      createTask(db, "session-1", "t1", true);
      createTask(db, "session-1", "t2", true);

      const progress = aggregator.getDailyProgress("user-1", "2025-01-15");
      expect(progress).toBe(0);
    });
  });
});
