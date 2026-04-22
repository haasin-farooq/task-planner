/**
 * AnalyticsAggregator — queries completion history and computes dashboard
 * metrics for the Analytics Dashboard.
 *
 * Provides two main operations:
 * - `getSummary(userId, startDate, endDate)` — aggregates daily stats,
 *   difficulty breakdown, performance categories, and the insufficient-data
 *   flag for a date range.
 * - `getDailyProgress(userId, date)` — returns (completed / total) × 100
 *   for the most recent task session on the given date.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import type Database from "better-sqlite3";
import type {
  AnalyticsSummary,
  DailyCompletionStat,
  DifficultyBreakdown,
  PerformanceCategory,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Row types for SQLite query results
// ---------------------------------------------------------------------------

interface DailyStatRow {
  date: string;
  tasks_completed: number;
  avg_actual_time: number;
  avg_estimated_time: number;
}

interface DifficultyRow {
  difficulty_level: number;
  count: number;
}

interface CategoryRow {
  category: string;
  avg_actual_time: number;
  avg_estimated_time: number;
}

interface CountRow {
  cnt: number;
}

interface SessionRow {
  id: string;
}

interface TaskProgressRow {
  total: number;
  completed: number;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

const INSUFFICIENT_DATA_THRESHOLD = 5;

export class AnalyticsAggregator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // -----------------------------------------------------------------------
  // getSummary
  // -----------------------------------------------------------------------

  /**
   * Compute an analytics summary for the given user and date range.
   *
   * - `dailyStats`: per-day task count, average actual time, average
   *   estimated time (Req 7.1, 7.2).
   * - `difficultyBreakdown`: count of completed tasks grouped by difficulty
   *   level (Req 7.3).
   * - `performanceCategories`: per-category comparison of actual vs estimated
   *   time, labelled "strength" or "area-for-improvement" (Req 7.4, 7.5).
   * - `insufficientData`: true when fewer than 5 completed tasks exist in the
   *   range (Req 7.7).
   * - `dailyProgressPercent`: progress for today's session (Req 7.6).
   *
   * Dates are inclusive and expected in ISO format (YYYY-MM-DD).
   */
  getSummary(
    userId: string,
    startDate: string,
    endDate: string,
  ): AnalyticsSummary {
    const dailyStats = this.getDailyStats(userId, startDate, endDate);
    const difficultyBreakdown = this.getDifficultyBreakdown(
      userId,
      startDate,
      endDate,
    );
    const performanceCategories = this.getPerformanceCategories(
      userId,
      startDate,
      endDate,
    );
    const totalCompleted = this.getTotalCompletedInRange(
      userId,
      startDate,
      endDate,
    );
    const insufficientData = totalCompleted < INSUFFICIENT_DATA_THRESHOLD;

    // Daily progress for today (use endDate as the reference day)
    const dailyProgressPercent = this.getDailyProgress(userId, endDate);

    return {
      dailyStats,
      difficultyBreakdown,
      performanceCategories,
      dailyProgressPercent,
      insufficientData,
    };
  }

  // -----------------------------------------------------------------------
  // getDailyProgress
  // -----------------------------------------------------------------------

  /**
   * Return the completion percentage for the most recent task session on the
   * given date.
   *
   * Progress = (completed / total) × 100.
   * Returns 0 when no session exists or total tasks is 0.
   */
  getDailyProgress(userId: string, date: string): number {
    // Find the most recent session for this user on the given date
    const session = this.db
      .prepare(
        `SELECT id FROM task_sessions
         WHERE user_id = ? AND DATE(created_at) = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(userId, date) as SessionRow | undefined;

    if (!session) {
      return 0;
    }

    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
         FROM tasks
         WHERE session_id = ?`,
      )
      .get(session.id) as TaskProgressRow | undefined;

    if (!row || row.total === 0) {
      return 0;
    }

    return (row.completed / row.total) * 100;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Per-day aggregation of completed tasks within the date range.
   * Req 7.1, 7.2
   */
  private getDailyStats(
    userId: string,
    startDate: string,
    endDate: string,
  ): DailyCompletionStat[] {
    const rows = this.db
      .prepare(
        `SELECT
           DATE(completed_at) as date,
           COUNT(*) as tasks_completed,
           AVG(actual_time) as avg_actual_time,
           AVG(estimated_time) as avg_estimated_time
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) >= ?
           AND DATE(completed_at) <= ?
         GROUP BY DATE(completed_at)
         ORDER BY DATE(completed_at)`,
      )
      .all(userId, startDate, endDate) as DailyStatRow[];

    return rows.map((r) => ({
      date: r.date,
      tasksCompleted: r.tasks_completed,
      avgActualTime: r.avg_actual_time,
      avgEstimatedTime: r.avg_estimated_time,
    }));
  }

  /**
   * Count of completed tasks grouped by difficulty level.
   * Req 7.3
   */
  private getDifficultyBreakdown(
    userId: string,
    startDate: string,
    endDate: string,
  ): DifficultyBreakdown[] {
    const rows = this.db
      .prepare(
        `SELECT
           difficulty_level,
           COUNT(*) as count
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) >= ?
           AND DATE(completed_at) <= ?
         GROUP BY difficulty_level
         ORDER BY difficulty_level`,
      )
      .all(userId, startDate, endDate) as DifficultyRow[];

    return rows.map((r) => ({
      difficultyLevel: r.difficulty_level,
      count: r.count,
    }));
  }

  /**
   * Per-category comparison of actual vs estimated time, labelled as
   * "strength" or "area-for-improvement".
   *
   * - "area-for-improvement": avgActualTime > avgEstimatedTime
   * - "strength": avgActualTime <= avgEstimatedTime
   *
   * Req 7.4, 7.5
   */
  private getPerformanceCategories(
    userId: string,
    startDate: string,
    endDate: string,
  ): PerformanceCategory[] {
    const rows = this.db
      .prepare(
        `SELECT
           category,
           AVG(actual_time) as avg_actual_time,
           AVG(estimated_time) as avg_estimated_time
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) >= ?
           AND DATE(completed_at) <= ?
           AND category IS NOT NULL
         GROUP BY category
         ORDER BY category`,
      )
      .all(userId, startDate, endDate) as CategoryRow[];

    return rows.map((r) => ({
      category: r.category,
      avgActualTime: r.avg_actual_time,
      avgEstimatedTime: r.avg_estimated_time,
      label:
        r.avg_actual_time > r.avg_estimated_time
          ? "area-for-improvement"
          : "strength",
    }));
  }

  /**
   * Total number of completed tasks in the date range.
   * Used to determine the `insufficientData` flag (Req 7.7).
   */
  private getTotalCompletedInRange(
    userId: string,
    startDate: string,
    endDate: string,
  ): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) >= ?
           AND DATE(completed_at) <= ?`,
      )
      .get(userId, startDate, endDate) as CountRow | undefined;

    return row?.cnt ?? 0;
  }
}
