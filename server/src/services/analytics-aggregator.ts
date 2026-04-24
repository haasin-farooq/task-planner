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
  AnomalyEntry,
  BehavioralInsight,
  CategoryChange,
  CategoryLearningStatus,
  CategoryPerformanceStat,
  CategorySpeedInsight,
  DailyCompletionStat,
  DayOfWeekPattern,
  DifficultyBreakdown,
  DifficultyCalibrationStat,
  EstimationErrorStats,
  ExtendedAnalyticsSummary,
  OverrunTask,
  PeriodComparison,
  PerformanceCategory,
  ProductivityConsistency,
  Recommendation,
  TimeAllocationEntry,
  WeeklyTrendPoint,
} from "../types/index.js";
import {
  classifyTrend,
  estimationAccuracy as computeEstimationAccuracy,
  linearRegressionSlope,
} from "../utils/trend-analysis.js";

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

interface CategoryIdRow {
  category_name: string;
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

// Row types for extended analytics queries

interface CompletionRow {
  estimated_time: number;
  actual_time: number;
  completed_at: string;
  normalized_category: string | null;
  category_name: string | null;
  task_description: string;
  difficulty_level: number;
}

interface WeeklyAggRow {
  week_start: string;
  tasks_completed: number;
  total_actual_time: number;
  avg_actual_time: number;
  avg_estimated_time: number;
}

interface CategoryAggRow {
  normalized_category: string;
  avg_estimated_time: number;
  avg_actual_time: number;
  avg_time_overrun: number;
  sample_size: number;
}

interface CategoryIdAggRow {
  category_name: string;
  avg_estimated_time: number;
  avg_actual_time: number;
  avg_time_overrun: number;
  sample_size: number;
}

interface DifficultyAggRow {
  difficulty_level: number;
  avg_estimated_time: number;
  avg_actual_time: number;
  avg_time_overrun: number;
  task_count: number;
}

interface DateRangeRow {
  min_date: string | null;
  max_date: string | null;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

const INSUFFICIENT_DATA_THRESHOLD = 5;

/**
 * Recursive CTE that resolves each category to its final active target
 * by following the merged_into_category_id chain. Used to roll up
 * historical data from merged categories under their target category.
 *
 * Returns: resolved_id (the final active category id), original_id (the starting id)
 *
 * Requirements: 13.1, 13.2
 */
const RESOLVED_CATEGORY_CTE = `
  resolved_cats AS (
    -- Base case: categories that are not merged (active or archived)
    SELECT id AS original_id, id AS resolved_id
    FROM categories
    WHERE status != 'merged' OR merged_into_category_id IS NULL

    UNION ALL

    -- Recursive case: follow merged_into_category_id pointer
    SELECT rc.original_id, c.id AS resolved_id
    FROM resolved_cats rc
    JOIN categories c ON c.id = (
      SELECT merged_into_category_id FROM categories WHERE id = rc.resolved_id AND status = 'merged' AND merged_into_category_id IS NOT NULL
    )
    WHERE rc.resolved_id != c.id
  )
`;

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
   * Returns an `ExtendedAnalyticsSummary` that is a superset of the original
   * `AnalyticsSummary`. All existing fields are preserved unchanged.
   *
   * New fields include: kpis, weeklyTrends, categoryPerformance, insights,
   * estimationAccuracyTrend, difficultyCalibration, recentChanges, dataStatus.
   *
   * Dates are inclusive and expected in ISO format (YYYY-MM-DD).
   */
  getSummary(
    userId: string,
    startDate: string,
    endDate: string,
  ): ExtendedAnalyticsSummary {
    // --- Existing AnalyticsSummary fields (preserved unchanged) ---
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

    // --- Extended analytics computations ---

    // Fetch all completion records for the user in the date range
    const allRecords = this.getAllCompletions(userId, startDate, endDate);

    // KPIs (Req 2.1–2.7)
    const kpis = this.computeKPIs(userId, allRecords, startDate, endDate);

    // Weekly trends — last 8 weeks (Req 3.1–3.3)
    const weeklyTrends = this.computeWeeklyTrends(userId, endDate);

    // Category performance using normalized_category (Req 4.1–4.5)
    const categoryPerformance = this.computeCategoryPerformance(
      userId,
      startDate,
      endDate,
    );

    // Behavioral insights (Req 5.1–5.6)
    const weeklyByCategory = this.computeWeeklyByCategory(userId, endDate);
    const insights = generateInsights(
      categoryPerformance.stats,
      weeklyByCategory,
    );

    // Estimation accuracy trend (Req 6.1–6.4)
    const estimationAccuracyTrend =
      this.computeEstimationAccuracyTrend(weeklyTrends);

    // Difficulty calibration (Req 7.1–7.4)
    const difficultyCalibration = this.computeDifficultyCalibration(
      userId,
      startDate,
      endDate,
    );

    // Recent changes (Req 8.1–8.5)
    const recentChanges = this.computeRecentChanges(userId, endDate);

    // Data status (Req 9.1–9.3)
    const dataStatus = this.computeDataStatus(userId);

    // --- New analytics computations ---

    // Time allocation
    const timeAllocation = this.computeTimeAllocation(allRecords);

    // Estimation errors
    const estimationErrors = this.computeEstimationErrors(allRecords);

    // Day-of-week patterns
    const dayOfWeekPatterns = this.computeDayOfWeekPatterns(allRecords);

    // Speed insights
    const speedInsights = this.computeSpeedInsights(categoryPerformance);

    // AI learning progress
    const aiLearningProgress = this.computeAILearningProgress(
      userId,
      categoryPerformance,
      weeklyByCategory,
    );

    // Productivity consistency
    const productivityConsistency =
      this.computeProductivityConsistency(weeklyTrends);

    // Anomalies
    const anomalies = this.computeAnomalies(allRecords);

    // Period comparison
    const periodComparison = this.computePeriodComparison(
      userId,
      startDate,
      endDate,
    );

    // Recommendations
    const recommendations = this.computeRecommendations(
      categoryPerformance,
      estimationErrors,
      aiLearningProgress,
      productivityConsistency,
    );

    return {
      dailyStats,
      difficultyBreakdown,
      performanceCategories,
      dailyProgressPercent,
      insufficientData,
      kpis,
      weeklyTrends,
      categoryPerformance,
      insights,
      estimationAccuracyTrend,
      difficultyCalibration,
      recentChanges,
      dataStatus,
      timeAllocation,
      estimationErrors,
      dayOfWeekPatterns,
      speedInsights,
      aiLearningProgress,
      productivityConsistency,
      anomalies,
      periodComparison,
      recommendations,
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
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT
           c_target.name as category_name,
           AVG(ch.actual_time) as avg_actual_time,
           AVG(ch.estimated_time) as avg_estimated_time
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) >= ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id
         ORDER BY c_target.name`,
      )
      .all(userId, startDate, endDate) as CategoryIdRow[];

    return rows.map((r) => ({
      category: r.category_name,
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

  // -----------------------------------------------------------------------
  // Extended analytics helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch all completion records for a user in the date range.
   */
  private getAllCompletions(
    userId: string,
    startDate: string,
    endDate: string,
  ): CompletionRow[] {
    return this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT ch.estimated_time, ch.actual_time, ch.completed_at,
                ch.normalized_category,
                COALESCE(c_target.name, c_raw.name) as category_name,
                ch.task_description, ch.difficulty_level
         FROM completion_history ch
         LEFT JOIN categories c_raw ON c_raw.id = ch.category_id
         LEFT JOIN resolved_cats rc ON rc.original_id = ch.category_id
         LEFT JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) >= ?
           AND DATE(ch.completed_at) <= ?
         ORDER BY ch.completed_at`,
      )
      .all(userId, startDate, endDate) as CompletionRow[];
  }

  /**
   * Compute KPIs for the KPI panel (Req 2.1–2.7).
   */
  private computeKPIs(
    userId: string,
    records: CompletionRow[],
    startDate: string,
    endDate: string,
  ): ExtendedAnalyticsSummary["kpis"] {
    const totalCompleted = records.length;

    // Completion rate: completed / planned tasks in sessions within the range
    const plannedRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM tasks t
         JOIN task_sessions s ON t.session_id = s.id
         WHERE s.user_id = ?
           AND DATE(s.created_at) >= ?
           AND DATE(s.created_at) <= ?`,
      )
      .get(userId, startDate, endDate) as CountRow | undefined;
    const totalPlanned = plannedRow?.cnt ?? 0;
    const completionRate =
      totalPlanned > 0 ? (totalCompleted / totalPlanned) * 100 : 0;

    // Average estimated and actual times
    let sumEstimated = 0;
    let sumActual = 0;
    let accuracySum = 0;
    let accuracyCount = 0;

    for (const r of records) {
      sumEstimated += r.estimated_time;
      sumActual += r.actual_time;
      if (r.estimated_time > 0) {
        accuracySum += computeEstimationAccuracy(
          r.estimated_time,
          r.actual_time,
        );
        accuracyCount++;
      }
    }

    const avgEstimatedTime =
      totalCompleted > 0 ? sumEstimated / totalCompleted : 0;
    const avgActualTime = totalCompleted > 0 ? sumActual / totalCompleted : 0;
    const estAccuracy =
      accuracyCount > 0 ? (accuracySum / accuracyCount) * 100 : 0;

    // Top improving category (Req 2.5): largest improvement in estimation accuracy
    // over last 4 weeks vs preceding 4 weeks
    const topImprovingCategory = this.findTopImprovingCategory(userId, endDate);

    // Most delayed category (Req 2.6): highest avg positive time overrun
    const mostDelayedCategory = this.findMostDelayedCategory(
      userId,
      startDate,
      endDate,
    );

    return {
      totalCompleted,
      completionRate,
      avgEstimatedTime,
      avgActualTime,
      estimationAccuracy: estAccuracy,
      topImprovingCategory,
      mostDelayedCategory,
    };
  }

  /**
   * Find the category with the largest improvement in estimation accuracy
   * over the last 4 weeks compared to the preceding 4 weeks.
   */
  private findTopImprovingCategory(
    userId: string,
    endDate: string,
  ): string | null {
    const end = new Date(endDate);
    const recentStart = new Date(end);
    recentStart.setDate(recentStart.getDate() - 28); // last 4 weeks
    const previousStart = new Date(recentStart);
    previousStart.setDate(previousStart.getDate() - 28); // preceding 4 weeks

    const recentStartStr = recentStart.toISOString().split("T")[0];
    const previousStartStr = previousStart.toISOString().split("T")[0];
    const endStr = endDate;

    // Get records for both periods
    const recentRecords = this.getAllCompletions(
      userId,
      recentStartStr,
      endStr,
    );
    const previousRecords = this.getAllCompletions(
      userId,
      previousStartStr,
      recentStartStr,
    );

    // Compute per-category accuracy for each period
    const recentAccuracy = this.categoryAccuracyMap(recentRecords);
    const previousAccuracy = this.categoryAccuracyMap(previousRecords);

    let bestCategory: string | null = null;
    let bestImprovement = 0;

    for (const [category, recentAcc] of recentAccuracy) {
      const prevAcc = previousAccuracy.get(category);
      if (prevAcc !== undefined) {
        const improvement = recentAcc - prevAcc;
        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestCategory = category;
        }
      }
    }

    return bestCategory;
  }

  /**
   * Compute average estimation accuracy per category from a set of records.
   */
  private categoryAccuracyMap(records: CompletionRow[]): Map<string, number> {
    const categoryData = new Map<string, { sum: number; count: number }>();

    for (const r of records) {
      const cat = r.category_name ?? r.normalized_category ?? "Other";
      if (r.estimated_time <= 0) continue;
      const acc = computeEstimationAccuracy(r.estimated_time, r.actual_time);
      const existing = categoryData.get(cat) ?? { sum: 0, count: 0 };
      existing.sum += acc;
      existing.count++;
      categoryData.set(cat, existing);
    }

    const result = new Map<string, number>();
    for (const [cat, data] of categoryData) {
      result.set(cat, data.sum / data.count);
    }
    return result;
  }

  /**
   * Find the category with the highest average positive time overrun.
   */
  private findMostDelayedCategory(
    userId: string,
    startDate: string,
    endDate: string,
  ): string | null {
    const row = this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT c_target.name as category_name,
                AVG(ch.actual_time - ch.estimated_time) as avg_overrun
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) >= ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id
         HAVING avg_overrun > 0
         ORDER BY avg_overrun DESC
         LIMIT 1`,
      )
      .get(userId, startDate, endDate) as
      | { category_name: string; avg_overrun: number }
      | undefined;

    return row?.category_name ?? null;
  }

  /**
   * Compute weekly trend data for the last 8 weeks (Req 3.1–3.3).
   *
   * Groups completion_history by ISO week, computing per-week aggregates.
   */
  private computeWeeklyTrends(
    userId: string,
    endDate: string,
  ): WeeklyTrendPoint[] {
    // Compute the start date: 8 weeks before endDate
    const end = new Date(endDate);
    const start = new Date(end);
    start.setDate(start.getDate() - 56); // 8 weeks
    const startStr = start.toISOString().split("T")[0];

    // Fetch all records in the 8-week window
    const records = this.getAllCompletions(userId, startStr, endDate);

    // Group by ISO week
    const weekMap = new Map<
      string,
      {
        weekStart: string;
        weekEnd: string;
        estimated: number[];
        actual: number[];
      }
    >();

    for (const r of records) {
      const date = new Date(r.completed_at);
      const { weekStart, weekEnd } = getISOWeekRange(date);
      const key = weekStart;

      if (!weekMap.has(key)) {
        weekMap.set(key, {
          weekStart,
          weekEnd,
          estimated: [],
          actual: [],
        });
      }

      const week = weekMap.get(key)!;
      week.estimated.push(r.estimated_time);
      week.actual.push(r.actual_time);
    }

    // Convert to WeeklyTrendPoint array, sorted by weekStart
    const points: WeeklyTrendPoint[] = [];
    for (const [, week] of weekMap) {
      const tasksCompleted = week.actual.length;
      const totalActualTime = week.actual.reduce((s, v) => s + v, 0);
      const avgActualTime = totalActualTime / tasksCompleted;
      const avgEstimatedTime =
        week.estimated.reduce((s, v) => s + v, 0) / tasksCompleted;

      // Per-task estimation accuracy, averaged
      let accSum = 0;
      let accCount = 0;
      let errorSum = 0;
      for (let i = 0; i < tasksCompleted; i++) {
        if (week.estimated[i] > 0) {
          accSum += computeEstimationAccuracy(
            week.estimated[i],
            week.actual[i],
          );
          errorSum +=
            (Math.abs(week.actual[i] - week.estimated[i]) / week.estimated[i]) *
            100;
          accCount++;
        }
      }

      points.push({
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        tasksCompleted,
        totalActualTime,
        avgActualTime,
        avgEstimatedTime,
        estimationAccuracy: accCount > 0 ? accSum / accCount : 0,
        avgAbsolutePercentError: accCount > 0 ? errorSum / accCount : 0,
      });
    }

    points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return points;
  }

  /**
   * Compute category performance stats using normalized_category (Req 4.1–4.5).
   */
  private computeCategoryPerformance(
    userId: string,
    startDate: string,
    endDate: string,
  ): NonNullable<ExtendedAnalyticsSummary["categoryPerformance"]> {
    const rows = this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT
           c_target.name as category_name,
           AVG(ch.estimated_time) as avg_estimated_time,
           AVG(ch.actual_time) as avg_actual_time,
           AVG(ch.actual_time - ch.estimated_time) as avg_time_overrun,
           COUNT(*) as sample_size
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) >= ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id
         ORDER BY c_target.name`,
      )
      .all(userId, startDate, endDate) as CategoryIdAggRow[];

    const stats: CategoryPerformanceStat[] = rows.map((r) => ({
      category: r.category_name,
      avgEstimatedTime: r.avg_estimated_time,
      avgActualTime: r.avg_actual_time,
      avgTimeOverrun: r.avg_time_overrun,
      sampleSize: r.sample_size,
    }));

    // Consistently faster: avg actual < avg estimated by ≥ 10%, with ≥ 3 tasks
    const consistentlyFaster: string[] = [];
    const consistentlySlower: string[] = [];

    for (const stat of stats) {
      if (stat.sampleSize < 3) continue;
      if (stat.avgEstimatedTime <= 0) continue;

      const ratio =
        (stat.avgActualTime - stat.avgEstimatedTime) / stat.avgEstimatedTime;

      if (ratio <= -0.1) {
        consistentlyFaster.push(stat.category);
      } else if (ratio >= 0.1) {
        consistentlySlower.push(stat.category);
      }
    }

    return { stats, consistentlyFaster, consistentlySlower };
  }

  /**
   * Compute weekly data grouped by category for insight generation.
   */
  private computeWeeklyByCategory(
    userId: string,
    endDate: string,
  ): Map<string, WeeklyTrendPoint[]> {
    const end = new Date(endDate);
    const start = new Date(end);
    start.setDate(start.getDate() - 56); // 8 weeks
    const startStr = start.toISOString().split("T")[0];

    const records = this.getAllCompletions(userId, startStr, endDate);

    // Group by category + week
    const catWeekMap = new Map<
      string,
      Map<
        string,
        {
          weekStart: string;
          weekEnd: string;
          estimated: number[];
          actual: number[];
        }
      >
    >();

    for (const r of records) {
      const cat = r.category_name ?? r.normalized_category ?? "Other";
      const date = new Date(r.completed_at);
      const { weekStart, weekEnd } = getISOWeekRange(date);

      if (!catWeekMap.has(cat)) {
        catWeekMap.set(cat, new Map());
      }
      const weekMap = catWeekMap.get(cat)!;

      if (!weekMap.has(weekStart)) {
        weekMap.set(weekStart, {
          weekStart,
          weekEnd,
          estimated: [],
          actual: [],
        });
      }

      const week = weekMap.get(weekStart)!;
      week.estimated.push(r.estimated_time);
      week.actual.push(r.actual_time);
    }

    // Convert to Map<string, WeeklyTrendPoint[]>
    const result = new Map<string, WeeklyTrendPoint[]>();

    for (const [cat, weekMap] of catWeekMap) {
      const points: WeeklyTrendPoint[] = [];

      for (const [, week] of weekMap) {
        const tasksCompleted = week.actual.length;
        const totalActualTime = week.actual.reduce((s, v) => s + v, 0);
        const avgActualTime = totalActualTime / tasksCompleted;
        const avgEstimatedTime =
          week.estimated.reduce((s, v) => s + v, 0) / tasksCompleted;

        let accSum = 0;
        let accCount = 0;
        let errorSum = 0;
        for (let i = 0; i < tasksCompleted; i++) {
          if (week.estimated[i] > 0) {
            accSum += computeEstimationAccuracy(
              week.estimated[i],
              week.actual[i],
            );
            errorSum +=
              (Math.abs(week.actual[i] - week.estimated[i]) /
                week.estimated[i]) *
              100;
            accCount++;
          }
        }

        points.push({
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          tasksCompleted,
          totalActualTime,
          avgActualTime,
          avgEstimatedTime,
          estimationAccuracy: accCount > 0 ? accSum / accCount : 0,
          avgAbsolutePercentError: accCount > 0 ? errorSum / accCount : 0,
        });
      }

      points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      result.set(cat, points);
    }

    return result;
  }

  /**
   * Compute estimation accuracy trend with linear regression (Req 6.1–6.4).
   */
  private computeEstimationAccuracyTrend(
    weeklyTrends: WeeklyTrendPoint[],
  ): NonNullable<ExtendedAnalyticsSummary["estimationAccuracyTrend"]> {
    const accuracyValues = weeklyTrends.map((w) => w.estimationAccuracy);
    const slope = linearRegressionSlope(accuracyValues);
    const trendLabel = classifyTrend(slope);

    return {
      weeklyAccuracy: weeklyTrends,
      trendLabel,
    };
  }

  /**
   * Compute per-difficulty-level calibration stats (Req 7.1–7.4).
   */
  private computeDifficultyCalibration(
    userId: string,
    startDate: string,
    endDate: string,
  ): DifficultyCalibrationStat[] {
    const rows = this.db
      .prepare(
        `SELECT
           difficulty_level,
           AVG(estimated_time) as avg_estimated_time,
           AVG(actual_time) as avg_actual_time,
           AVG(actual_time - estimated_time) as avg_time_overrun,
           COUNT(*) as task_count
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) >= ?
           AND DATE(completed_at) <= ?
         GROUP BY difficulty_level
         ORDER BY difficulty_level`,
      )
      .all(userId, startDate, endDate) as DifficultyAggRow[];

    return rows.map((r) => ({
      difficultyLevel: r.difficulty_level,
      avgEstimatedTime: r.avg_estimated_time,
      avgActualTime: r.avg_actual_time,
      avgTimeOverrun: r.avg_time_overrun,
      taskCount: r.task_count,
    }));
  }

  /**
   * Compute recent behavioral changes (Req 8.1–8.5).
   *
   * Compares the last 2 weeks vs the preceding 4 weeks per category.
   */
  private computeRecentChanges(
    userId: string,
    endDate: string,
  ): NonNullable<ExtendedAnalyticsSummary["recentChanges"]> {
    const end = new Date(endDate);

    // Last 2 weeks
    const recentStart = new Date(end);
    recentStart.setDate(recentStart.getDate() - 14);
    const recentStartStr = recentStart.toISOString().split("T")[0];

    // Preceding 4 weeks (before the last 2 weeks)
    const previousStart = new Date(recentStart);
    previousStart.setDate(previousStart.getDate() - 28);
    const previousStartStr = previousStart.toISOString().split("T")[0];

    // Get avg actual time per category for each period
    const recentRows = this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT c_target.name as category_name,
                AVG(ch.actual_time) as avg_actual_time,
                COUNT(*) as cnt
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) > ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id`,
      )
      .all(userId, recentStartStr, endDate) as {
      category_name: string;
      avg_actual_time: number;
      cnt: number;
    }[];

    const previousRows = this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT c_target.name as category_name,
                AVG(ch.actual_time) as avg_actual_time,
                COUNT(*) as cnt
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) > ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id`,
      )
      .all(userId, previousStartStr, recentStartStr) as {
      category_name: string;
      avg_actual_time: number;
      cnt: number;
    }[];

    const previousMap = new Map<string, number>();
    for (const r of previousRows) {
      previousMap.set(r.category_name, r.avg_actual_time);
    }

    const fasterCategories: CategoryChange[] = [];
    const slowerCategories: CategoryChange[] = [];

    for (const r of recentRows) {
      const prevAvg = previousMap.get(r.category_name);
      if (prevAvg === undefined || prevAvg === 0) continue;

      const percentageChange = ((r.avg_actual_time - prevAvg) / prevAvg) * 100;

      const change: CategoryChange = {
        category: r.category_name,
        percentageChange,
        recentAvgTime: r.avg_actual_time,
        previousAvgTime: prevAvg,
      };

      if (percentageChange < 0) {
        fasterCategories.push(change);
      } else if (percentageChange > 0) {
        slowerCategories.push(change);
      }
    }

    // Sort faster by most improvement (most negative), slower by most increase
    fasterCategories.sort((a, b) => a.percentageChange - b.percentageChange);
    slowerCategories.sort((a, b) => b.percentageChange - a.percentageChange);

    // Largest overruns in last 2 weeks (Req 8.3)
    const overrunRows = this.db
      .prepare(
        `SELECT task_description, estimated_time, actual_time,
                (actual_time - estimated_time) as overrun
         FROM completion_history
         WHERE user_id = ?
           AND DATE(completed_at) > ?
           AND DATE(completed_at) <= ?
           AND actual_time > estimated_time
         ORDER BY overrun DESC
         LIMIT 5`,
      )
      .all(userId, recentStartStr, endDate) as {
      task_description: string;
      estimated_time: number;
      actual_time: number;
      overrun: number;
    }[];

    const largestOverruns: OverrunTask[] = overrunRows.map((r) => ({
      description: r.task_description,
      estimatedTime: r.estimated_time,
      actualTime: r.actual_time,
      overrunMinutes: r.overrun,
    }));

    // Limited data categories: < 3 tasks in last 4 weeks (Req 8.4)
    const allCategoriesLast4Weeks = this.db
      .prepare(
        `WITH ${RESOLVED_CATEGORY_CTE}
         SELECT c_target.name as category_name, COUNT(*) as cnt
         FROM completion_history ch
         JOIN resolved_cats rc ON rc.original_id = ch.category_id
         JOIN categories c_target ON c_target.id = rc.resolved_id
         WHERE ch.user_id = ?
           AND DATE(ch.completed_at) > ?
           AND DATE(ch.completed_at) <= ?
           AND ch.category_id IS NOT NULL
           AND c_target.status = 'active'
         GROUP BY rc.resolved_id
         HAVING cnt < 3`,
      )
      .all(userId, previousStartStr, endDate) as {
      category_name: string;
      cnt: number;
    }[];

    const limitedDataCategories = allCategoriesLast4Weeks.map(
      (r) => r.category_name,
    );

    return {
      fasterCategories,
      slowerCategories,
      largestOverruns,
      limitedDataCategories,
    };
  }

  /**
   * Compute data status: total completed tasks, weeks of data, days of data.
   */
  private computeDataStatus(
    userId: string,
  ): NonNullable<ExtendedAnalyticsSummary["dataStatus"]> {
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM completion_history WHERE user_id = ?`,
      )
      .get(userId) as CountRow | undefined;

    const totalCompletedTasks = countRow?.cnt ?? 0;

    const dateRange = this.db
      .prepare(
        `SELECT
           MIN(DATE(completed_at)) as min_date,
           MAX(DATE(completed_at)) as max_date
         FROM completion_history
         WHERE user_id = ?`,
      )
      .get(userId) as DateRangeRow | undefined;

    let weeksOfData = 0;
    let daysOfData = 0;

    if (dateRange?.min_date && dateRange?.max_date) {
      const minDate = new Date(dateRange.min_date);
      const maxDate = new Date(dateRange.max_date);
      const diffMs = maxDate.getTime() - minDate.getTime();
      daysOfData = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
      weeksOfData = Math.ceil(daysOfData / 7);
    }

    return {
      totalCompletedTasks,
      weeksOfData,
      daysOfData,
    };
  }

  // -----------------------------------------------------------------------
  // New analytics computation methods
  // -----------------------------------------------------------------------

  /**
   * Compute time allocation breakdown by category.
   */
  private computeTimeAllocation(
    records: CompletionRow[],
  ): TimeAllocationEntry[] {
    const catMap = new Map<
      string,
      { actual: number; estimated: number; count: number }
    >();
    let totalActual = 0;

    for (const r of records) {
      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      const entry = catMap.get(cat) ?? { actual: 0, estimated: 0, count: 0 };
      entry.actual += r.actual_time;
      entry.estimated += r.estimated_time;
      entry.count++;
      catMap.set(cat, entry);
      totalActual += r.actual_time;
    }

    const result: TimeAllocationEntry[] = [];
    for (const [cat, data] of catMap) {
      result.push({
        category: cat,
        totalActualTime: data.actual,
        totalEstimatedTime: data.estimated,
        percentOfTotal: totalActual > 0 ? (data.actual / totalActual) * 100 : 0,
        taskCount: data.count,
      });
    }

    return result.sort((a, b) => b.totalActualTime - a.totalActualTime);
  }

  /**
   * Compute detailed estimation error statistics.
   */
  private computeEstimationErrors(
    records: CompletionRow[],
  ): EstimationErrorStats {
    let totalErrorPercent = 0;
    let errorCount = 0;
    let overCount = 0;
    let underCount = 0;
    const overruns: {
      description: string;
      estimatedTime: number;
      actualTime: number;
      overrunMinutes: number;
    }[] = [];
    const underruns: {
      description: string;
      estimatedTime: number;
      actualTime: number;
      savedMinutes: number;
    }[] = [];
    const catErrors = new Map<string, { totalError: number; count: number }>();

    for (const r of records) {
      if (r.estimated_time <= 0) continue;
      const errorPct =
        (Math.abs(r.actual_time - r.estimated_time) / r.estimated_time) * 100;
      totalErrorPercent += errorPct;
      errorCount++;

      if (r.estimated_time > r.actual_time) {
        overCount++;
        underruns.push({
          description: r.task_description,
          estimatedTime: r.estimated_time,
          actualTime: r.actual_time,
          savedMinutes: r.estimated_time - r.actual_time,
        });
      } else if (r.actual_time > r.estimated_time) {
        underCount++;
        overruns.push({
          description: r.task_description,
          estimatedTime: r.estimated_time,
          actualTime: r.actual_time,
          overrunMinutes: r.actual_time - r.estimated_time,
        });
      }

      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      const catEntry = catErrors.get(cat) ?? { totalError: 0, count: 0 };
      catEntry.totalError += errorPct;
      catEntry.count++;
      catErrors.set(cat, catEntry);
    }

    overruns.sort((a, b) => b.overrunMinutes - a.overrunMinutes);
    underruns.sort((a, b) => b.savedMinutes - a.savedMinutes);

    return {
      avgErrorPercent: errorCount > 0 ? totalErrorPercent / errorCount : 0,
      overestimationCount: overCount,
      underestimationCount: underCount,
      biggestOverruns: overruns.slice(0, 5).map((o) => ({
        description: o.description,
        estimatedTime: o.estimatedTime,
        actualTime: o.actualTime,
        overrunMinutes: o.overrunMinutes,
      })),
      biggestUnderruns: underruns.slice(0, 5),
      errorByCategory: Array.from(catErrors.entries())
        .map(([cat, data]) => ({
          category: cat,
          avgErrorPercent: data.totalError / data.count,
          sampleSize: data.count,
        }))
        .sort((a, b) => b.avgErrorPercent - a.avgErrorPercent),
    };
  }

  /**
   * Compute day-of-week patterns from completion records.
   */
  private computeDayOfWeekPatterns(
    records: CompletionRow[],
  ): DayOfWeekPattern[] {
    const DAY_NAMES = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayData = new Map<
      number,
      { actual: number[]; estimated: number[] }
    >();

    for (const r of records) {
      const day = new Date(r.completed_at).getDay();
      const entry = dayData.get(day) ?? { actual: [], estimated: [] };
      entry.actual.push(r.actual_time);
      entry.estimated.push(r.estimated_time);
      dayData.set(day, entry);
    }

    const result: DayOfWeekPattern[] = [];
    for (let i = 0; i < 7; i++) {
      const data = dayData.get(i);
      if (!data || data.actual.length === 0) continue;

      const avgActual =
        data.actual.reduce((s, v) => s + v, 0) / data.actual.length;
      const avgEstimated =
        data.estimated.reduce((s, v) => s + v, 0) / data.estimated.length;

      let accSum = 0;
      let accCount = 0;
      for (let j = 0; j < data.actual.length; j++) {
        if (data.estimated[j] > 0) {
          accSum += computeEstimationAccuracy(
            data.estimated[j],
            data.actual[j],
          );
          accCount++;
        }
      }

      result.push({
        dayName: DAY_NAMES[i],
        dayIndex: i,
        tasksCompleted: data.actual.length,
        avgActualTime: avgActual,
        avgEstimatedTime: avgEstimated,
        estimationAccuracy: accCount > 0 ? (accSum / accCount) * 100 : 0,
      });
    }

    // Sort by day index (Monday first: 1,2,3,4,5,6,0)
    result.sort((a, b) => ((a.dayIndex + 6) % 7) - ((b.dayIndex + 6) % 7));
    return result;
  }

  /**
   * Compute speed insights: fastest, slowest, quick wins, consistent overruns.
   */
  private computeSpeedInsights(categoryPerformance: {
    stats: CategoryPerformanceStat[];
  }): {
    fastest: CategorySpeedInsight[];
    slowest: CategorySpeedInsight[];
    quickWins: CategorySpeedInsight[];
    consistentOverruns: CategorySpeedInsight[];
  } {
    const insights: CategorySpeedInsight[] = categoryPerformance.stats
      .filter((s) => s.sampleSize >= 3)
      .map((s) => ({
        category: s.category,
        avgActualTime: s.avgActualTime,
        avgEstimatedTime: s.avgEstimatedTime,
        avgRatio:
          s.avgEstimatedTime > 0 ? s.avgActualTime / s.avgEstimatedTime : 1,
        sampleSize: s.sampleSize,
      }));

    const sorted = [...insights].sort(
      (a, b) => a.avgActualTime - b.avgActualTime,
    );

    return {
      fastest: sorted.slice(0, 5),
      slowest: [...sorted].reverse().slice(0, 5),
      quickWins: insights
        .filter((i) => i.avgRatio < 0.8)
        .sort((a, b) => a.avgRatio - b.avgRatio)
        .slice(0, 5),
      consistentOverruns: insights
        .filter((i) => i.avgRatio > 1.2)
        .sort((a, b) => b.avgRatio - a.avgRatio)
        .slice(0, 5),
    };
  }

  /**
   * Compute AI learning progress per category.
   */
  private computeAILearningProgress(
    _userId: string,
    categoryPerformance: { stats: CategoryPerformanceStat[] },
    weeklyByCategory: Map<string, WeeklyTrendPoint[]>,
  ): CategoryLearningStatus[] {
    return categoryPerformance.stats.map((stat) => {
      const maturity =
        stat.sampleSize < 3
          ? "new"
          : stat.sampleSize < 10
            ? "learning"
            : "ready";
      const hasPersonalization = stat.sampleSize >= 10;

      const weeklyData = weeklyByCategory.get(stat.category);
      let recentAccuracyTrend: CategoryLearningStatus["recentAccuracyTrend"] =
        "insufficient";
      if (weeklyData && weeklyData.length >= 3) {
        const accuracyValues = weeklyData.map((w) => w.estimationAccuracy);
        const slope = linearRegressionSlope(accuracyValues);
        const trend = classifyTrend(slope);
        recentAccuracyTrend = trend.toLowerCase() as
          | "improving"
          | "stable"
          | "declining";
      }

      return {
        category: stat.category,
        sampleSize: stat.sampleSize,
        maturity,
        hasPersonalization,
        recentAccuracyTrend,
      };
    });
  }

  /**
   * Compute productivity consistency metrics from weekly trends.
   */
  private computeProductivityConsistency(
    weeklyTrends: WeeklyTrendPoint[],
  ): ProductivityConsistency {
    const weeklyScores = weeklyTrends.map((w) => ({
      weekStart: w.weekStart,
      tasksCompleted: w.tasksCompleted,
      totalTime: w.totalActualTime,
    }));

    const taskCounts = weeklyTrends.map((w) => w.tasksCompleted);
    const avgWeeklyTasks =
      taskCounts.length > 0
        ? taskCounts.reduce((s, v) => s + v, 0) / taskCounts.length
        : 0;

    // Coefficient of variation
    let variance = 0;
    if (taskCounts.length > 1 && avgWeeklyTasks > 0) {
      const sumSquaredDiff = taskCounts.reduce(
        (s, v) => s + Math.pow(v - avgWeeklyTasks, 2),
        0,
      );
      const stdDev = Math.sqrt(sumSquaredDiff / taskCounts.length);
      variance = (stdDev / avgWeeklyTasks) * 100;
    }

    let consistencyLabel: ProductivityConsistency["consistencyLabel"];
    if (variance < 15) consistencyLabel = "very-consistent";
    else if (variance < 30) consistencyLabel = "consistent";
    else if (variance < 50) consistencyLabel = "variable";
    else consistencyLabel = "highly-variable";

    return {
      weeklyScores,
      avgWeeklyTasks,
      taskVariancePercent: variance,
      consistencyLabel,
    };
  }

  /**
   * Detect anomalous tasks that deviate significantly from category averages.
   */
  private computeAnomalies(records: CompletionRow[]): AnomalyEntry[] {
    // Compute per-category averages
    const catAvg = new Map<string, { sum: number; count: number }>();
    for (const r of records) {
      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      const entry = catAvg.get(cat) ?? { sum: 0, count: 0 };
      entry.sum += r.actual_time;
      entry.count++;
      catAvg.set(cat, entry);
    }

    const anomalies: AnomalyEntry[] = [];
    for (const r of records) {
      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      const avg = catAvg.get(cat);
      if (!avg || avg.count < 3) continue;

      const categoryAvg = avg.sum / avg.count;
      if (categoryAvg <= 0) continue;

      const deviation = ((r.actual_time - categoryAvg) / categoryAvg) * 100;

      // Flag tasks that took >100% longer than category average
      if (deviation > 100) {
        anomalies.push({
          type: "slow-task",
          description: r.task_description,
          category: cat,
          actualTime: r.actual_time,
          expectedTime: categoryAvg,
          deviationPercent: deviation,
          completedAt: r.completed_at,
        });
      }
    }

    return anomalies
      .sort((a, b) => b.deviationPercent - a.deviationPercent)
      .slice(0, 10);
  }

  /**
   * Compare current period with the equivalent previous period.
   */
  private computePeriodComparison(
    userId: string,
    startDate: string,
    endDate: string,
  ): PeriodComparison {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationMs = end.getTime() - start.getTime();

    const prevEnd = new Date(start.getTime() - 1); // day before current start
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    const prevStartStr = prevStart.toISOString().split("T")[0];
    const prevEndStr = prevEnd.toISOString().split("T")[0];

    const currentRecords = this.getAllCompletions(userId, startDate, endDate);
    const previousRecords = this.getAllCompletions(
      userId,
      prevStartStr,
      prevEndStr,
    );

    function computePeriodStats(records: CompletionRow[]) {
      const total = records.length;
      const totalActual = records.reduce((s, r) => s + r.actual_time, 0);
      const avgActual = total > 0 ? totalActual / total : 0;
      let accSum = 0;
      let accCount = 0;
      for (const r of records) {
        if (r.estimated_time > 0) {
          accSum += computeEstimationAccuracy(r.estimated_time, r.actual_time);
          accCount++;
        }
      }
      return {
        tasksCompleted: total,
        totalActualTime: totalActual,
        avgActualTime: avgActual,
        estimationAccuracy: accCount > 0 ? (accSum / accCount) * 100 : 0,
      };
    }

    const current = computePeriodStats(currentRecords);
    const previous = computePeriodStats(previousRecords);

    const deltas = {
      tasksCompleted: current.tasksCompleted - previous.tasksCompleted,
      totalActualTime: current.totalActualTime - previous.totalActualTime,
      avgActualTime: current.avgActualTime - previous.avgActualTime,
      estimationAccuracy:
        current.estimationAccuracy - previous.estimationAccuracy,
    };

    // Most changed category
    const currentCatTime = new Map<string, number>();
    for (const r of currentRecords) {
      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      currentCatTime.set(cat, (currentCatTime.get(cat) ?? 0) + r.actual_time);
    }
    const prevCatTime = new Map<string, number>();
    for (const r of previousRecords) {
      const cat = r.category_name ?? r.normalized_category ?? "Uncategorized";
      prevCatTime.set(cat, (prevCatTime.get(cat) ?? 0) + r.actual_time);
    }

    let mostChanged: PeriodComparison["mostChangedCategory"] = null;
    let maxChange = 0;
    for (const [cat, currentTime] of currentCatTime) {
      const prevTime = prevCatTime.get(cat) ?? 0;
      if (prevTime === 0) continue;
      const change = Math.abs(((currentTime - prevTime) / prevTime) * 100);
      if (change > maxChange) {
        maxChange = change;
        mostChanged = {
          category: cat,
          changePercent: ((currentTime - prevTime) / prevTime) * 100,
        };
      }
    }

    return { current, previous, deltas, mostChangedCategory: mostChanged };
  }

  /**
   * Generate actionable recommendations based on analytics data.
   */
  private computeRecommendations(
    categoryPerformance: { stats: CategoryPerformanceStat[] },
    _estimationErrors: EstimationErrorStats,
    aiLearning: CategoryLearningStatus[],
    productivityConsistency: ProductivityConsistency,
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    let id = 0;

    // Categories with consistent overruns → add buffer
    for (const stat of categoryPerformance.stats) {
      if (stat.sampleSize >= 5 && stat.avgTimeOverrun > 10) {
        const bufferMins = Math.round(stat.avgTimeOverrun);
        recs.push({
          id: `rec-${id++}`,
          text: `Add ~${bufferMins} min buffer to ${stat.category} tasks — they consistently take longer than estimated.`,
          type: "buffer",
          category: stat.category,
          priority: stat.avgTimeOverrun > 20 ? "high" : "medium",
        });
      }
    }

    // Categories with consistent overestimation → reduce estimates
    for (const stat of categoryPerformance.stats) {
      if (stat.sampleSize >= 5 && stat.avgTimeOverrun < -10) {
        recs.push({
          id: `rec-${id++}`,
          text: `${stat.category} tasks are consistently overestimated — you finish ~${Math.round(Math.abs(stat.avgTimeOverrun))} min early on average.`,
          type: "overestimation",
          category: stat.category,
          priority: "low",
        });
      }
    }

    // Categories improving
    for (const learning of aiLearning) {
      if (
        learning.recentAccuracyTrend === "improving" &&
        learning.sampleSize >= 5
      ) {
        recs.push({
          id: `rec-${id++}`,
          text: `You're improving in ${learning.category} — estimation accuracy is trending up.`,
          type: "improvement",
          category: learning.category,
          priority: "low",
        });
      }
    }

    // Categories still learning
    for (const learning of aiLearning) {
      if (learning.maturity === "new") {
        recs.push({
          id: `rec-${id++}`,
          text: `${learning.category} needs more data — complete a few more tasks for personalized estimates.`,
          type: "learning",
          category: learning.category,
          priority: "medium",
        });
      }
    }

    // Consistency
    if (productivityConsistency.consistencyLabel === "highly-variable") {
      recs.push({
        id: `rec-${id++}`,
        text: "Your weekly task volume varies a lot — try setting a minimum weekly target for more consistent progress.",
        type: "consistency",
        priority: "medium",
      });
    }

    return recs
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, 8);
  }
}

// ---------------------------------------------------------------------------
// ISO Week helper
// ---------------------------------------------------------------------------

/**
 * Get the Monday and Sunday dates for the ISO week containing the given date.
 */
function getISOWeekRange(date: Date): {
  weekStart: string;
  weekEnd: string;
} {
  const d = new Date(date);
  const day = d.getUTCDay();
  // Adjust to Monday (day 0 = Sunday → offset 6, day 1 = Monday → offset 0, etc.)
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: monday.toISOString().split("T")[0],
    weekEnd: sunday.toISOString().split("T")[0],
  };
}

// ---------------------------------------------------------------------------
// InsightGenerator — pure functions for behavioral insight detection
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
// ---------------------------------------------------------------------------

/** Minimum tasks per category for underestimation insights (Req 5.2) */
const UNDERESTIMATION_MIN_TASKS = 5;

/** Minimum overrun percentage threshold for underestimation insights (Req 5.2) */
const UNDERESTIMATION_THRESHOLD = 0.15;

/** Minimum weeks of data needed for trend-based insights */
const MIN_WEEKS_FOR_TREND = 4;

/** Maximum number of insights returned (Req 5.5) */
const MAX_INSIGHTS = 5;

/**
 * Detect categories where the user consistently underestimates task time.
 *
 * A category qualifies when:
 * - It has at least 5 completed tasks (sampleSize ≥ 5)
 * - The average time overrun exceeds 15% of the average estimated time
 *
 * Produces a natural language insight string for each qualifying category.
 *
 * Req 5.2
 */
export function detectUnderestimation(
  stats: CategoryPerformanceStat[],
): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];

  for (const stat of stats) {
    if (stat.sampleSize < UNDERESTIMATION_MIN_TASKS) {
      continue;
    }

    if (stat.avgEstimatedTime <= 0) {
      continue;
    }

    const overrunPercent = stat.avgTimeOverrun / stat.avgEstimatedTime;

    if (overrunPercent > UNDERESTIMATION_THRESHOLD) {
      const pct = Math.round(overrunPercent * 100);
      insights.push({
        text: `You typically underestimate ${stat.category} tasks by ${pct}%. Consider adding a buffer when planning these tasks.`,
        magnitude: overrunPercent,
        type: "underestimation",
        category: stat.category,
      });
    }
  }

  return insights;
}

/**
 * Detect categories where the user is getting faster over time.
 *
 * Looks at the last 4 weekly data points per category and computes a
 * linear regression slope on the average actual time. A negative slope
 * indicates the user is completing tasks faster.
 *
 * Req 5.3
 */
export function detectSpeedImprovements(
  weeklyByCategory: Map<string, WeeklyTrendPoint[]>,
): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];

  for (const [category, points] of weeklyByCategory) {
    if (points.length < MIN_WEEKS_FOR_TREND) {
      continue;
    }

    // Take the last 4 weeks
    const recent = points.slice(-MIN_WEEKS_FOR_TREND);
    const avgTimes = recent.map((p) => p.avgActualTime);
    const slope = linearRegressionSlope(avgTimes);

    // Negative slope means decreasing actual time (getting faster)
    if (slope < 0) {
      // Compute magnitude as the percentage decrease per week relative to the
      // average actual time across the period
      const avgTime = avgTimes.reduce((sum, t) => sum + t, 0) / avgTimes.length;
      const magnitude = avgTime > 0 ? Math.abs(slope) / avgTime : 0;

      if (magnitude > 0) {
        const pctPerWeek = Math.round(magnitude * 100);
        insights.push({
          text: `You're getting faster at ${category} tasks, improving by about ${pctPerWeek}% per week.`,
          magnitude,
          type: "speed-improvement",
          category,
        });
      }
    }
  }

  return insights;
}

/**
 * Detect categories where estimation accuracy is improving over time.
 *
 * Looks at the last 4 weekly data points per category and computes a
 * linear regression slope on the estimation accuracy values. A positive
 * slope indicates improving accuracy.
 *
 * Req 5.4
 */
export function detectAccuracyImprovements(
  weeklyByCategory: Map<string, WeeklyTrendPoint[]>,
): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];

  for (const [category, points] of weeklyByCategory) {
    if (points.length < MIN_WEEKS_FOR_TREND) {
      continue;
    }

    // Take the last 4 weeks
    const recent = points.slice(-MIN_WEEKS_FOR_TREND);
    const accuracies = recent.map((p) => p.estimationAccuracy);
    const slope = linearRegressionSlope(accuracies);

    // Positive slope means increasing accuracy (improving)
    if (slope > 0) {
      const magnitude = slope;
      const pctImprovement = Math.round(slope * 100);

      if (pctImprovement > 0) {
        insights.push({
          text: `Estimation accuracy for ${category} tasks is improving, gaining about ${pctImprovement} percentage points per week.`,
          magnitude,
          type: "accuracy-improvement",
          category,
        });
      }
    }
  }

  return insights;
}

/**
 * Combine all insight detectors, rank by magnitude, and return the top 5.
 *
 * Req 5.1, 5.5
 */
export function generateInsights(
  stats: CategoryPerformanceStat[],
  weeklyByCategory: Map<string, WeeklyTrendPoint[]>,
): BehavioralInsight[] {
  const allInsights: BehavioralInsight[] = [
    ...detectUnderestimation(stats),
    ...detectSpeedImprovements(weeklyByCategory),
    ...detectAccuracyImprovements(weeklyByCategory),
  ];

  // Sort by magnitude descending (most significant first)
  allInsights.sort((a, b) => b.magnitude - a.magnitude);

  // Return top 5 (Req 5.5)
  return allInsights.slice(0, MAX_INSIGHTS);
}
