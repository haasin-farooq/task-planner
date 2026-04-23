import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "../../db/connection.js";
import { AnalyticsAggregator } from "../analytics-aggregator.js";
import {
  detectUnderestimation,
  detectSpeedImprovements,
  detectAccuracyImprovements,
  generateInsights,
} from "../analytics-aggregator.js";
import { v4 as uuidv4 } from "uuid";
import type {
  CategoryPerformanceStat,
  WeeklyTrendPoint,
} from "../../types/index.js";

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
    normalizedCategory?: string;
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
       (id, user_id, task_description, category, normalized_category, estimated_time, actual_time, difficulty_level, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuidv4(),
    userId,
    overrides.description ?? "task",
    overrides.category ?? "general",
    overrides.normalizedCategory ?? null,
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

/**
 * Helper to generate a date string offset by a number of days from a base date.
 */
function dateOffset(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
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

  // =========================================================================
  // Extended Analytics Tests (Task 6.3)
  // =========================================================================

  // --- KPI computation (Req 2.1–2.7) ---

  describe("KPI computation", () => {
    it("should compute totalCompleted from records in the date range", () => {
      for (let i = 0; i < 6; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          completedAt: "2025-01-15T10:00:00Z",
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.kpis).toBeDefined();
      expect(summary.kpis!.totalCompleted).toBe(6);
    });

    it("should compute avgEstimatedTime and avgActualTime", () => {
      insertCompletion(db, {
        estimatedTime: 60,
        actualTime: 40,
        normalizedCategory: "Development",
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        estimatedTime: 80,
        actualTime: 100,
        normalizedCategory: "Development",
        completedAt: "2025-01-16T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.kpis!.avgEstimatedTime).toBeCloseTo(70, 4); // (60+80)/2
      expect(summary.kpis!.avgActualTime).toBeCloseTo(70, 4); // (40+100)/2
    });

    it("should compute estimationAccuracy as percentage", () => {
      // Task 1: est=100, actual=100 → accuracy = 1 - |0|/100 = 1.0
      insertCompletion(db, {
        estimatedTime: 100,
        actualTime: 100,
        normalizedCategory: "Development",
        completedAt: "2025-01-15T10:00:00Z",
      });
      // Task 2: est=100, actual=50 → accuracy = 1 - 50/100 = 0.5
      insertCompletion(db, {
        estimatedTime: 100,
        actualTime: 50,
        normalizedCategory: "Development",
        completedAt: "2025-01-16T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      // Average accuracy: (1.0 + 0.5) / 2 = 0.75 → 75%
      expect(summary.kpis!.estimationAccuracy).toBeCloseTo(75, 0);
    });

    it("should compute completionRate based on planned tasks in sessions", () => {
      // Create a session with 4 tasks, complete 2 of them
      createSession(db, "user-1", "session-kpi", "2025-01-15T08:00:00Z");
      createTask(db, "session-kpi", "t-kpi-1", true);
      createTask(db, "session-kpi", "t-kpi-2", true);
      createTask(db, "session-kpi", "t-kpi-3", false);
      createTask(db, "session-kpi", "t-kpi-4", false);

      // Insert 2 completion records (matching the 2 completed tasks)
      insertCompletion(db, {
        normalizedCategory: "Development",
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Development",
        completedAt: "2025-01-15T11:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      // completionRate = 2 completed / 4 planned * 100 = 50%
      expect(summary.kpis!.completionRate).toBeCloseTo(50, 0);
    });

    it("should return null for mostDelayedCategory when no overruns exist", () => {
      insertCompletion(db, {
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 30,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.kpis!.mostDelayedCategory).toBeNull();
    });

    it("should identify mostDelayedCategory as the one with highest avg overrun", () => {
      // Writing: overrun = 90 - 60 = 30
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Writing",
          category: "writing",
          estimatedTime: 60,
          actualTime: 90,
          completedAt: `2025-01-${15 + i}T10:00:00Z`,
        });
      }
      // Development: overrun = 70 - 60 = 10
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          category: "coding",
          estimatedTime: 60,
          actualTime: 70,
          completedAt: `2025-01-${15 + i}T11:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.kpis!.mostDelayedCategory).toBe("Writing");
    });
  });

  // --- Weekly trend aggregation (Req 3.1–3.3) ---

  describe("Weekly trend aggregation", () => {
    it("should group completions into correct week buckets", () => {
      // Insert tasks across 3 different weeks leading up to endDate
      // Week of 2025-01-06 (Mon) to 2025-01-12 (Sun)
      insertCompletion(db, {
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 50,
        completedAt: "2025-01-07T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 70,
        completedAt: "2025-01-08T10:00:00Z",
      });

      // Week of 2025-01-13 (Mon) to 2025-01-19 (Sun)
      insertCompletion(db, {
        normalizedCategory: "Writing",
        estimatedTime: 30,
        actualTime: 25,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-20",
        "2025-01-19",
      );
      expect(summary.weeklyTrends).toBeDefined();
      expect(summary.weeklyTrends!.length).toBeGreaterThanOrEqual(2);

      // Find the week starting 2025-01-06
      const week1 = summary.weeklyTrends!.find(
        (w) => w.weekStart === "2025-01-06",
      );
      expect(week1).toBeDefined();
      expect(week1!.tasksCompleted).toBe(2);
      expect(week1!.weekEnd).toBe("2025-01-12");

      // Find the week starting 2025-01-13
      const week2 = summary.weeklyTrends!.find(
        (w) => w.weekStart === "2025-01-13",
      );
      expect(week2).toBeDefined();
      expect(week2!.tasksCompleted).toBe(1);
    });

    it("should compute avgActualTime and avgEstimatedTime per week", () => {
      // Two tasks in the same week
      insertCompletion(db, {
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 40,
        completedAt: "2025-01-07T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Development",
        estimatedTime: 80,
        actualTime: 100,
        completedAt: "2025-01-08T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-20",
        "2025-01-12",
      );
      const week = summary.weeklyTrends!.find(
        (w) => w.weekStart === "2025-01-06",
      );
      expect(week).toBeDefined();
      expect(week!.avgActualTime).toBeCloseTo(70, 4); // (40+100)/2
      expect(week!.avgEstimatedTime).toBeCloseTo(70, 4); // (60+80)/2
      expect(week!.totalActualTime).toBeCloseTo(140, 4); // 40+100
    });

    it("should return weekly trends sorted by weekStart", () => {
      // Insert in reverse chronological order
      insertCompletion(db, {
        normalizedCategory: "Development",
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Development",
        completedAt: "2025-01-07T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-20",
        "2025-01-19",
      );
      const weekStarts = summary.weeklyTrends!.map((w) => w.weekStart);
      const sorted = [...weekStarts].sort();
      expect(weekStarts).toEqual(sorted);
    });

    it("should return empty weeklyTrends when no data in 8-week window", () => {
      // Insert data outside the 8-week window
      insertCompletion(db, {
        normalizedCategory: "Development",
        completedAt: "2024-01-01T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.weeklyTrends).toBeDefined();
      expect(summary.weeklyTrends!.length).toBe(0);
    });
  });

  // --- Category performance uses normalized_category (Req 4.1–4.5) ---

  describe("Category performance", () => {
    it("should group by normalized_category, not raw category", () => {
      // Two different raw categories that map to the same normalized category
      insertCompletion(db, {
        category: "coding",
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 50,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        category: "programming",
        normalizedCategory: "Development",
        estimatedTime: 60,
        actualTime: 70,
        completedAt: "2025-01-16T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.categoryPerformance).toBeDefined();

      // Should be grouped as one "Development" category
      const devStat = summary.categoryPerformance!.stats.find(
        (s) => s.category === "Development",
      );
      expect(devStat).toBeDefined();
      expect(devStat!.sampleSize).toBe(2);
      expect(devStat!.avgActualTime).toBeCloseTo(60, 4); // (50+70)/2
      expect(devStat!.avgEstimatedTime).toBeCloseTo(60, 4);
    });

    it("should compute avgTimeOverrun per category", () => {
      // 3 tasks in Writing: overrun = actual - estimated
      insertCompletion(db, {
        normalizedCategory: "Writing",
        estimatedTime: 60,
        actualTime: 80,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Writing",
        estimatedTime: 60,
        actualTime: 90,
        completedAt: "2025-01-16T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Writing",
        estimatedTime: 60,
        actualTime: 70,
        completedAt: "2025-01-17T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      const writing = summary.categoryPerformance!.stats.find(
        (s) => s.category === "Writing",
      );
      expect(writing).toBeDefined();
      // avg overrun: (20 + 30 + 10) / 3 = 20
      expect(writing!.avgTimeOverrun).toBeCloseTo(20, 4);
    });

    it("should identify consistentlyFaster categories (≥3 tasks, ≥10% faster)", () => {
      // 3 tasks where actual is significantly less than estimated
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Admin",
          estimatedTime: 100,
          actualTime: 70, // 30% faster
          completedAt: `2025-01-${15 + i}T10:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.categoryPerformance!.consistentlyFaster).toContain(
        "Admin",
      );
      expect(summary.categoryPerformance!.consistentlySlower).not.toContain(
        "Admin",
      );
    });

    it("should identify consistentlySlower categories (≥3 tasks, ≥10% slower)", () => {
      // 3 tasks where actual is significantly more than estimated
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Research",
          estimatedTime: 100,
          actualTime: 130, // 30% slower
          completedAt: `2025-01-${15 + i}T10:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.categoryPerformance!.consistentlySlower).toContain(
        "Research",
      );
      expect(summary.categoryPerformance!.consistentlyFaster).not.toContain(
        "Research",
      );
    });

    it("should not include categories with fewer than 3 tasks in faster/slower lists", () => {
      // Only 2 tasks — should not appear in either list
      insertCompletion(db, {
        normalizedCategory: "Design",
        estimatedTime: 100,
        actualTime: 50,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Design",
        estimatedTime: 100,
        actualTime: 50,
        completedAt: "2025-01-16T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.categoryPerformance!.consistentlyFaster).not.toContain(
        "Design",
      );
      expect(summary.categoryPerformance!.consistentlySlower).not.toContain(
        "Design",
      );
    });

    it("should exclude records with null normalized_category from category performance", () => {
      insertCompletion(db, {
        category: "unknown",
        normalizedCategory: undefined,
        estimatedTime: 60,
        actualTime: 90,
        completedAt: "2025-01-15T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      // No category stats since normalized_category is null
      expect(summary.categoryPerformance!.stats.length).toBe(0);
    });
  });

  // --- Insight generation (Req 5.1–5.6) ---

  describe("Insight generation", () => {
    it("should detect underestimation for categories with >15% overrun and ≥5 tasks", () => {
      const stats: CategoryPerformanceStat[] = [
        {
          category: "Writing",
          avgEstimatedTime: 60,
          avgActualTime: 80, // overrun = 20/60 = 33%
          avgTimeOverrun: 20,
          sampleSize: 6,
        },
      ];

      const insights = detectUnderestimation(stats);
      expect(insights.length).toBe(1);
      expect(insights[0].type).toBe("underestimation");
      expect(insights[0].category).toBe("Writing");
      expect(insights[0].text).toContain("Writing");
      expect(insights[0].text).toContain("33%");
    });

    it("should not produce underestimation insight for categories with <5 tasks", () => {
      const stats: CategoryPerformanceStat[] = [
        {
          category: "Writing",
          avgEstimatedTime: 60,
          avgActualTime: 80,
          avgTimeOverrun: 20,
          sampleSize: 4, // below threshold
        },
      ];

      const insights = detectUnderestimation(stats);
      expect(insights.length).toBe(0);
    });

    it("should not produce underestimation insight when overrun is ≤15%", () => {
      const stats: CategoryPerformanceStat[] = [
        {
          category: "Writing",
          avgEstimatedTime: 100,
          avgActualTime: 110, // overrun = 10/100 = 10%
          avgTimeOverrun: 10,
          sampleSize: 10,
        },
      ];

      const insights = detectUnderestimation(stats);
      expect(insights.length).toBe(0);
    });

    it("should detect speed improvements from decreasing avg actual time", () => {
      // Create weekly data with decreasing actual times
      const weeklyByCategory = new Map<string, WeeklyTrendPoint[]>();
      weeklyByCategory.set("Development", [
        makeWeeklyPoint("2025-01-06", 100, 60),
        makeWeeklyPoint("2025-01-13", 90, 60),
        makeWeeklyPoint("2025-01-20", 80, 60),
        makeWeeklyPoint("2025-01-27", 70, 60),
      ]);

      const insights = detectSpeedImprovements(weeklyByCategory);
      expect(insights.length).toBe(1);
      expect(insights[0].type).toBe("speed-improvement");
      expect(insights[0].category).toBe("Development");
      expect(insights[0].text).toContain("Development");
      expect(insights[0].text).toContain("faster");
    });

    it("should detect accuracy improvements from increasing estimation accuracy", () => {
      const weeklyByCategory = new Map<string, WeeklyTrendPoint[]>();
      weeklyByCategory.set("Writing", [
        makeWeeklyPoint("2025-01-06", 60, 60, 0.5),
        makeWeeklyPoint("2025-01-13", 60, 60, 0.6),
        makeWeeklyPoint("2025-01-20", 60, 60, 0.7),
        makeWeeklyPoint("2025-01-27", 60, 60, 0.8),
      ]);

      const insights = detectAccuracyImprovements(weeklyByCategory);
      expect(insights.length).toBe(1);
      expect(insights[0].type).toBe("accuracy-improvement");
      expect(insights[0].category).toBe("Writing");
      expect(insights[0].text).toContain("Writing");
    });

    it("should combine and rank insights, returning at most 5", () => {
      // Create stats with multiple underestimation patterns
      const stats: CategoryPerformanceStat[] = [];
      const categories = [
        "Writing",
        "Development",
        "Design",
        "Research",
        "Admin",
        "Communication",
      ];
      for (const cat of categories) {
        stats.push({
          category: cat,
          avgEstimatedTime: 60,
          avgActualTime: 80,
          avgTimeOverrun: 20,
          sampleSize: 10,
        });
      }

      const weeklyByCategory = new Map<string, WeeklyTrendPoint[]>();
      const allInsights = generateInsights(stats, weeklyByCategory);
      expect(allInsights.length).toBeLessThanOrEqual(5);
    });

    it("should produce insights via getSummary when sufficient data exists", () => {
      // Insert enough data for underestimation detection:
      // 6 tasks in Writing with significant overrun, spread across 8 weeks
      for (let week = 0; week < 8; week++) {
        insertCompletion(db, {
          normalizedCategory: "Writing",
          category: "writing",
          estimatedTime: 60,
          actualTime: 90, // 50% overrun
          completedAt: dateOffset("2025-01-06T10:00:00Z", week * 7),
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-03-31",
      );
      expect(summary.insights).toBeDefined();
      // Should have at least one insight about Writing underestimation
      const writingInsight = summary.insights!.find(
        (i) => i.category === "Writing" && i.type === "underestimation",
      );
      expect(writingInsight).toBeDefined();
      expect(writingInsight!.text).toContain("Writing");
    });
  });

  // --- Estimation accuracy trend label classification (Req 6.1–6.4) ---

  describe("Estimation accuracy trend", () => {
    it("should classify trend as Improving when accuracy increases over weeks", () => {
      // Insert tasks with improving accuracy over 8 weeks
      for (let week = 0; week < 8; week++) {
        // Accuracy improves: early weeks have large errors, later weeks are more accurate
        const error = Math.max(5, 40 - week * 5); // decreasing error
        insertCompletion(db, {
          normalizedCategory: "Development",
          estimatedTime: 100,
          actualTime: 100 + error, // overrun decreases over time
          completedAt: dateOffset("2024-12-02T10:00:00Z", week * 7),
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-01",
        "2025-02-28",
      );
      expect(summary.estimationAccuracyTrend).toBeDefined();
      expect(summary.estimationAccuracyTrend!.trendLabel).toBe("Improving");
    });

    it("should classify trend as Declining when accuracy decreases over weeks", () => {
      // Insert tasks with declining accuracy over 8 weeks
      for (let week = 0; week < 8; week++) {
        const error = 5 + week * 10; // increasing error
        insertCompletion(db, {
          normalizedCategory: "Development",
          estimatedTime: 100,
          actualTime: 100 + error,
          completedAt: dateOffset("2024-12-02T10:00:00Z", week * 7),
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-01",
        "2025-02-28",
      );
      expect(summary.estimationAccuracyTrend).toBeDefined();
      expect(summary.estimationAccuracyTrend!.trendLabel).toBe("Declining");
    });

    it("should classify trend as Stable when accuracy is consistent", () => {
      // Insert tasks with consistent accuracy over 8 weeks
      for (let week = 0; week < 8; week++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          estimatedTime: 100,
          actualTime: 105, // consistent small error
          completedAt: dateOffset("2024-12-02T10:00:00Z", week * 7),
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2024-11-01",
        "2025-02-28",
      );
      expect(summary.estimationAccuracyTrend).toBeDefined();
      expect(summary.estimationAccuracyTrend!.trendLabel).toBe("Stable");
    });

    it("should include weeklyAccuracy data in the trend", () => {
      // Insert data within 8 weeks of the endDate (2025-01-31)
      for (let week = 0; week < 4; week++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          estimatedTime: 100,
          actualTime: 110,
          completedAt: dateOffset("2025-01-06T10:00:00Z", week * 7),
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.estimationAccuracyTrend!.weeklyAccuracy).toBeDefined();
      expect(
        summary.estimationAccuracyTrend!.weeklyAccuracy.length,
      ).toBeGreaterThan(0);
    });
  });

  // --- Difficulty calibration stats (Req 7.1–7.4) ---

  describe("Difficulty calibration", () => {
    it("should compute per-difficulty-level stats", () => {
      // Difficulty 1: 2 tasks
      insertCompletion(db, {
        difficultyLevel: 1,
        normalizedCategory: "Development",
        estimatedTime: 30,
        actualTime: 25,
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 1,
        normalizedCategory: "Development",
        estimatedTime: 30,
        actualTime: 35,
        completedAt: "2025-01-16T10:00:00Z",
      });

      // Difficulty 3: 1 task
      insertCompletion(db, {
        difficultyLevel: 3,
        normalizedCategory: "Writing",
        estimatedTime: 60,
        actualTime: 80,
        completedAt: "2025-01-17T10:00:00Z",
      });

      // Difficulty 5: 1 task
      insertCompletion(db, {
        difficultyLevel: 5,
        normalizedCategory: "Research",
        estimatedTime: 120,
        actualTime: 150,
        completedAt: "2025-01-18T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.difficultyCalibration).toBeDefined();
      expect(summary.difficultyCalibration!.length).toBe(3);

      // Difficulty 1
      const d1 = summary.difficultyCalibration!.find(
        (d) => d.difficultyLevel === 1,
      );
      expect(d1).toBeDefined();
      expect(d1!.taskCount).toBe(2);
      expect(d1!.avgEstimatedTime).toBeCloseTo(30, 4);
      expect(d1!.avgActualTime).toBeCloseTo(30, 4); // (25+35)/2
      expect(d1!.avgTimeOverrun).toBeCloseTo(0, 4); // (−5+5)/2

      // Difficulty 3
      const d3 = summary.difficultyCalibration!.find(
        (d) => d.difficultyLevel === 3,
      );
      expect(d3).toBeDefined();
      expect(d3!.taskCount).toBe(1);
      expect(d3!.avgTimeOverrun).toBeCloseTo(20, 4); // 80-60

      // Difficulty 5
      const d5 = summary.difficultyCalibration!.find(
        (d) => d.difficultyLevel === 5,
      );
      expect(d5).toBeDefined();
      expect(d5!.taskCount).toBe(1);
      expect(d5!.avgTimeOverrun).toBeCloseTo(30, 4); // 150-120
    });

    it("should order difficulty calibration by difficulty level", () => {
      insertCompletion(db, {
        difficultyLevel: 5,
        normalizedCategory: "Development",
        completedAt: "2025-01-15T10:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 1,
        normalizedCategory: "Development",
        completedAt: "2025-01-16T10:00:00Z",
      });
      insertCompletion(db, {
        difficultyLevel: 3,
        normalizedCategory: "Development",
        completedAt: "2025-01-17T10:00:00Z",
      });

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      const levels = summary.difficultyCalibration!.map(
        (d) => d.difficultyLevel,
      );
      expect(levels).toEqual([1, 3, 5]);
    });

    it("should return empty array when no data exists", () => {
      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.difficultyCalibration).toBeDefined();
      expect(summary.difficultyCalibration!.length).toBe(0);
    });
  });

  // --- Recent changes detection (Req 8.1–8.5) ---

  describe("Recent changes detection", () => {
    it("should detect faster categories (lower avg actual time in last 2 weeks vs preceding 4 weeks)", () => {
      const endDate = "2025-02-15";
      // Preceding 4 weeks (2025-01-04 to 2025-02-01): slower
      for (let i = 0; i < 4; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          category: "coding",
          estimatedTime: 60,
          actualTime: 100,
          completedAt: dateOffset("2025-01-10T10:00:00Z", i * 7),
        });
      }
      // Last 2 weeks (2025-02-01 to 2025-02-15): faster
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          category: "coding",
          estimatedTime: 60,
          actualTime: 60,
          completedAt: dateOffset("2025-02-03T10:00:00Z", i * 3),
        });
      }

      const summary = aggregator.getSummary("user-1", "2025-01-01", endDate);
      expect(summary.recentChanges).toBeDefined();
      const devFaster = summary.recentChanges!.fasterCategories.find(
        (c) => c.category === "Development",
      );
      expect(devFaster).toBeDefined();
      expect(devFaster!.percentageChange).toBeLessThan(0); // negative = faster
    });

    it("should detect slower categories (higher avg actual time in last 2 weeks)", () => {
      const endDate = "2025-02-15";
      // Preceding 4 weeks: faster
      for (let i = 0; i < 4; i++) {
        insertCompletion(db, {
          normalizedCategory: "Writing",
          category: "writing",
          estimatedTime: 60,
          actualTime: 50,
          completedAt: dateOffset("2025-01-10T10:00:00Z", i * 7),
        });
      }
      // Last 2 weeks: slower
      for (let i = 0; i < 3; i++) {
        insertCompletion(db, {
          normalizedCategory: "Writing",
          category: "writing",
          estimatedTime: 60,
          actualTime: 100,
          completedAt: dateOffset("2025-02-03T10:00:00Z", i * 3),
        });
      }

      const summary = aggregator.getSummary("user-1", "2025-01-01", endDate);
      const writingSlower = summary.recentChanges!.slowerCategories.find(
        (c) => c.category === "Writing",
      );
      expect(writingSlower).toBeDefined();
      expect(writingSlower!.percentageChange).toBeGreaterThan(0); // positive = slower
    });

    it("should include largest overruns from last 2 weeks", () => {
      const endDate = "2025-02-15";
      // Insert tasks with overruns in last 2 weeks
      insertCompletion(db, {
        normalizedCategory: "Development",
        description: "Big overrun task",
        estimatedTime: 30,
        actualTime: 120,
        completedAt: "2025-02-10T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Writing",
        description: "Small overrun task",
        estimatedTime: 60,
        actualTime: 70,
        completedAt: "2025-02-11T10:00:00Z",
      });

      const summary = aggregator.getSummary("user-1", "2025-01-01", endDate);
      expect(
        summary.recentChanges!.largestOverruns.length,
      ).toBeGreaterThanOrEqual(1);
      // The biggest overrun should be first
      expect(summary.recentChanges!.largestOverruns[0].overrunMinutes).toBe(90); // 120-30
      expect(summary.recentChanges!.largestOverruns[0].description).toBe(
        "Big overrun task",
      );
    });

    it("should identify limited data categories (< 3 tasks in last 4+2 weeks)", () => {
      const endDate = "2025-02-15";
      // Only 2 tasks for "Design" in the 6-week window
      insertCompletion(db, {
        normalizedCategory: "Design",
        category: "design",
        estimatedTime: 60,
        actualTime: 50,
        completedAt: "2025-01-20T10:00:00Z",
      });
      insertCompletion(db, {
        normalizedCategory: "Design",
        category: "design",
        estimatedTime: 60,
        actualTime: 55,
        completedAt: "2025-02-05T10:00:00Z",
      });

      const summary = aggregator.getSummary("user-1", "2025-01-01", endDate);
      expect(summary.recentChanges!.limitedDataCategories).toContain("Design");
    });

    it("should return empty recent changes when no data exists", () => {
      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.recentChanges).toBeDefined();
      expect(summary.recentChanges!.fasterCategories).toEqual([]);
      expect(summary.recentChanges!.slowerCategories).toEqual([]);
      expect(summary.recentChanges!.largestOverruns).toEqual([]);
    });
  });

  // --- Backward compatibility (Req 10.7) ---

  describe("Backward compatibility", () => {
    it("should preserve all existing AnalyticsSummary fields in ExtendedAnalyticsSummary", () => {
      // Insert some data so we get non-empty results
      for (let i = 0; i < 5; i++) {
        insertCompletion(db, {
          category: "coding",
          normalizedCategory: "Development",
          difficultyLevel: 2,
          estimatedTime: 60,
          actualTime: 50,
          completedAt: `2025-01-${15 + i}T10:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      // Original AnalyticsSummary fields must be present
      expect(summary).toHaveProperty("dailyStats");
      expect(summary).toHaveProperty("difficultyBreakdown");
      expect(summary).toHaveProperty("performanceCategories");
      expect(summary).toHaveProperty("dailyProgressPercent");
      expect(summary).toHaveProperty("insufficientData");

      // Verify types
      expect(Array.isArray(summary.dailyStats)).toBe(true);
      expect(Array.isArray(summary.difficultyBreakdown)).toBe(true);
      expect(Array.isArray(summary.performanceCategories)).toBe(true);
      expect(typeof summary.dailyProgressPercent).toBe("number");
      expect(typeof summary.insufficientData).toBe("boolean");

      // Verify original fields have correct values
      expect(summary.dailyStats.length).toBeGreaterThan(0);
      expect(summary.difficultyBreakdown.length).toBeGreaterThan(0);
      expect(summary.insufficientData).toBe(false); // 5 tasks ≥ threshold
    });

    it("should include all new extended fields alongside existing ones", () => {
      for (let i = 0; i < 5; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          completedAt: `2025-01-${15 + i}T10:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      // New extended fields must be present
      expect(summary).toHaveProperty("kpis");
      expect(summary).toHaveProperty("weeklyTrends");
      expect(summary).toHaveProperty("categoryPerformance");
      expect(summary).toHaveProperty("insights");
      expect(summary).toHaveProperty("estimationAccuracyTrend");
      expect(summary).toHaveProperty("difficultyCalibration");
      expect(summary).toHaveProperty("recentChanges");
      expect(summary).toHaveProperty("dataStatus");
    });

    it("should compute dataStatus with correct totalCompletedTasks", () => {
      for (let i = 0; i < 7; i++) {
        insertCompletion(db, {
          normalizedCategory: "Development",
          completedAt: `2025-01-${10 + i}T10:00:00Z`,
        });
      }

      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );
      expect(summary.dataStatus).toBeDefined();
      expect(summary.dataStatus!.totalCompletedTasks).toBe(7);
      expect(summary.dataStatus!.daysOfData).toBeGreaterThanOrEqual(7);
      expect(summary.dataStatus!.weeksOfData).toBeGreaterThanOrEqual(1);
    });

    it("should return empty extended fields for user with no history", () => {
      const summary = aggregator.getSummary(
        "user-1",
        "2025-01-01",
        "2025-01-31",
      );

      // Original fields
      expect(summary.dailyStats).toEqual([]);
      expect(summary.insufficientData).toBe(true);

      // Extended fields should still be present but empty/zero
      expect(summary.kpis!.totalCompleted).toBe(0);
      expect(summary.weeklyTrends).toEqual([]);
      expect(summary.categoryPerformance!.stats).toEqual([]);
      expect(summary.insights).toEqual([]);
      expect(summary.difficultyCalibration).toEqual([]);
      expect(summary.dataStatus!.totalCompletedTasks).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper to create WeeklyTrendPoint for insight tests
// ---------------------------------------------------------------------------

function makeWeeklyPoint(
  weekStart: string,
  avgActualTime: number,
  avgEstimatedTime: number,
  estimationAccuracy?: number,
): WeeklyTrendPoint {
  const startDate = new Date(weekStart);
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);

  return {
    weekStart,
    weekEnd: endDate.toISOString().split("T")[0],
    tasksCompleted: 5,
    totalActualTime: avgActualTime * 5,
    avgActualTime,
    avgEstimatedTime,
    estimationAccuracy:
      estimationAccuracy ??
      Math.max(
        0,
        Math.min(
          1,
          1 - Math.abs(avgActualTime - avgEstimatedTime) / avgEstimatedTime,
        ),
      ),
    avgAbsolutePercentError:
      (Math.abs(avgActualTime - avgEstimatedTime) / avgEstimatedTime) * 100,
  };
}
