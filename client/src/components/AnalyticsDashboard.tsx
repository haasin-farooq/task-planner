import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import type {
  AnalyticsSummary,
  DailyCompletionStat,
  DifficultyBreakdown,
  PerformanceCategory,
} from "../types";

export interface AnalyticsDashboardProps {
  /** Current user ID for fetching analytics. */
  userId: string;
}

/** Format a date string (YYYY-MM-DD) to a shorter locale label. */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Return today's date as YYYY-MM-DD. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return a date N days ago as YYYY-MM-DD. */
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Analytics Dashboard component.
 *
 * Fetches analytics via GET /api/analytics/:userId with a selectable
 * date range and displays:
 * - Daily completion chart (text-based bar chart)
 * - Average actual vs estimated time comparison
 * - Difficulty breakdown
 * - Strengths and areas for improvement
 * - "Insufficient data" message when fewer than 5 tasks
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7
 */
export default function AnalyticsDashboard({
  userId,
}: AnalyticsDashboardProps) {
  const [startDate, setStartDate] = useState(daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<AnalyticsSummary>(
        `/api/analytics/${encodeURIComponent(userId)}`,
        { params: { startDate, endDate } },
      );
      setSummary(response.data);
    } catch {
      setError("Failed to load analytics. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [userId, startDate, endDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <section aria-label="Analytics dashboard" className="space-y-6">
      <h2 className="text-2xl font-bold text-[#1A1A1A]">Analytics Dashboard</h2>

      {/* Date range selector — Req 7.1, 7.2, 7.3 */}
      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      {loading && (
        <p aria-live="polite" className="text-[#6B6B6B]">
          Loading analytics…
        </p>
      )}

      {error && (
        <p role="alert" aria-live="assertive" className="text-red-500">
          {error}
        </p>
      )}

      {summary && !loading && (
        <>
          {/* Req 7.7 — insufficient data message */}
          {summary.insufficientData && (
            <div
              role="status"
              aria-live="polite"
              data-testid="insufficient-data"
              className="rounded-lg border border-amber-400 bg-amber-50 p-4 mb-4 text-amber-800"
            >
              <strong>Not enough data yet.</strong> Complete at least 5 tasks to
              see meaningful analytics.
            </div>
          )}

          {/* Req 7.1 — daily completion chart */}
          <DailyCompletionChart dailyStats={summary.dailyStats} />

          {/* Req 7.2 — average time comparison */}
          <TimeComparison dailyStats={summary.dailyStats} />

          {/* Req 7.3 — difficulty breakdown */}
          <DifficultyBreakdownDisplay breakdown={summary.difficultyBreakdown} />

          {/* Req 7.4, 7.5 — strengths and areas for improvement */}
          <PerformanceInsights categories={summary.performanceCategories} />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function DateRangeSelector({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-4 items-center mb-6 border border-dark-border rounded-lg p-3 bg-white">
      <legend className="text-sm font-medium text-[#6B6B6B] px-1">
        Date Range
      </legend>
      <label className="text-sm text-[#6B6B6B]">
        From{" "}
        <input
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          aria-label="Start date"
          className="ml-1 rounded-md border border-dark-border bg-dark-bg px-2 py-1 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      <label className="text-sm text-[#6B6B6B]">
        To{" "}
        <input
          type="date"
          value={endDate}
          min={startDate}
          max={todayISO()}
          onChange={(e) => onEndDateChange(e.target.value)}
          aria-label="End date"
          className="ml-1 rounded-md border border-dark-border bg-dark-bg px-2 py-1 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
    </fieldset>
  );
}

/** Req 7.1 — tasks completed per day as a simple bar chart. */
function DailyCompletionChart({
  dailyStats,
}: {
  dailyStats: DailyCompletionStat[];
}) {
  if (dailyStats.length === 0) {
    return null;
  }

  const maxCompleted = Math.max(...dailyStats.map((s) => s.tasksCompleted), 1);

  return (
    <div className="mb-6 rounded-lg bg-white border border-dark-border p-4">
      <h3 className="text-lg font-semibold text-[#1A1A1A] mb-3">
        Daily Completions
      </h3>
      <table
        aria-label="Daily task completions"
        className="w-full border-collapse"
      >
        <thead>
          <tr className="border-b border-dark-border">
            <th
              scope="col"
              className="text-left py-1 px-2 text-sm font-medium text-[#6B6B6B]"
            >
              Date
            </th>
            <th
              scope="col"
              className="text-left py-1 px-2 text-sm font-medium text-[#6B6B6B]"
            >
              Tasks
            </th>
            <th
              scope="col"
              className="text-left py-1 px-2 text-sm font-medium text-[#6B6B6B] w-[60%]"
            >
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody>
          {dailyStats.map((stat) => {
            const pct = (stat.tasksCompleted / maxCompleted) * 100;
            return (
              <tr
                key={stat.date}
                data-testid={`daily-stat-${stat.date}`}
                className="border-b border-dark-border/50 last:border-b-0"
              >
                <td className="py-1 px-2 whitespace-nowrap text-sm text-[#6B6B6B]">
                  {formatDate(stat.date)}
                </td>
                <td className="py-1 px-2 text-right text-sm text-[#1A1A1A]">
                  {stat.tasksCompleted}
                </td>
                <td className="py-1 px-2">
                  <div
                    role="img"
                    aria-label={`${stat.tasksCompleted} tasks completed on ${formatDate(stat.date)}`}
                    className={`h-4 rounded bg-accent ${stat.tasksCompleted > 0 ? "min-w-[4px]" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Req 7.2 — average actual vs estimated time comparison. */
function TimeComparison({ dailyStats }: { dailyStats: DailyCompletionStat[] }) {
  if (dailyStats.length === 0) {
    return null;
  }

  const totalTasks = dailyStats.reduce((s, d) => s + d.tasksCompleted, 0);
  if (totalTasks === 0) return null;

  const weightedActual = dailyStats.reduce(
    (s, d) => s + d.avgActualTime * d.tasksCompleted,
    0,
  );
  const weightedEstimated = dailyStats.reduce(
    (s, d) => s + d.avgEstimatedTime * d.tasksCompleted,
    0,
  );

  const avgActual = weightedActual / totalTasks;
  const avgEstimated = weightedEstimated / totalTasks;
  const diff = avgActual - avgEstimated;
  const diffLabel =
    diff > 0
      ? `${diff.toFixed(1)} min slower than estimated`
      : diff < 0
        ? `${Math.abs(diff).toFixed(1)} min faster than estimated`
        : "Right on target";

  return (
    <div className="mb-6 rounded-lg bg-white border border-dark-border p-4">
      <h3 className="text-lg font-semibold text-[#1A1A1A] mb-3">
        Average Time Comparison
      </h3>
      <div
        role="group"
        aria-label="Time comparison"
        className="flex gap-8 flex-wrap"
      >
        <div data-testid="avg-estimated-time">
          <div className="text-sm text-[#6B6B6B]">Avg Estimated</div>
          <div className="text-2xl font-semibold text-[#1A1A1A]">
            {avgEstimated.toFixed(1)} min
          </div>
        </div>
        <div data-testid="avg-actual-time">
          <div className="text-sm text-[#6B6B6B]">Avg Actual</div>
          <div className="text-2xl font-semibold text-[#1A1A1A]">
            {avgActual.toFixed(1)} min
          </div>
        </div>
        <div data-testid="time-diff">
          <div className="text-sm text-[#6B6B6B]">Difference</div>
          <div
            className={`text-base font-medium ${
              diff > 0
                ? "text-red-500"
                : diff < 0
                  ? "text-green-600"
                  : "text-[#6B6B6B]"
            }`}
          >
            {diffLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Req 7.3 — breakdown of completed tasks by difficulty level. */
function DifficultyBreakdownDisplay({
  breakdown,
}: {
  breakdown: DifficultyBreakdown[];
}) {
  if (breakdown.length === 0) {
    return null;
  }

  const total = breakdown.reduce((s, b) => s + b.count, 0);
  const maxCount = Math.max(...breakdown.map((b) => b.count), 1);

  const difficultyLabels: Record<number, string> = {
    1: "Very Easy",
    2: "Easy",
    3: "Medium",
    4: "Hard",
    5: "Very Hard",
  };

  return (
    <div className="mb-6 rounded-lg bg-white border border-dark-border p-4">
      <h3 className="text-lg font-semibold text-[#1A1A1A] mb-3">
        Difficulty Breakdown
      </h3>
      <table
        aria-label="Task difficulty breakdown"
        className="w-full border-collapse"
      >
        <thead>
          <tr className="border-b border-dark-border">
            <th
              scope="col"
              className="text-left py-1 px-2 text-sm font-medium text-[#6B6B6B]"
            >
              Difficulty
            </th>
            <th
              scope="col"
              className="text-right py-1 px-2 text-sm font-medium text-[#6B6B6B]"
            >
              Count
            </th>
            <th
              scope="col"
              className="text-right py-1 px-2 text-sm font-medium text-[#6B6B6B]"
            >
              %
            </th>
            <th
              scope="col"
              className="text-left py-1 px-2 text-sm font-medium text-[#6B6B6B] w-1/2"
            >
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((b) => {
            const pct = total > 0 ? (b.count / total) * 100 : 0;
            const barPct = (b.count / maxCount) * 100;
            return (
              <tr
                key={b.difficultyLevel}
                data-testid={`difficulty-${b.difficultyLevel}`}
                className="border-b border-dark-border/50 last:border-b-0"
              >
                <td className="py-1 px-2 text-sm text-[#6B6B6B]">
                  {difficultyLabels[b.difficultyLevel] ??
                    `Level ${b.difficultyLevel}`}
                </td>
                <td className="py-1 px-2 text-right text-sm text-[#1A1A1A]">
                  {b.count}
                </td>
                <td className="py-1 px-2 text-right text-sm text-[#1A1A1A]">
                  {pct.toFixed(0)}%
                </td>
                <td className="py-1 px-2">
                  <div
                    role="img"
                    aria-label={`${b.count} tasks at ${difficultyLabels[b.difficultyLevel] ?? `level ${b.difficultyLevel}`}`}
                    className={`h-4 rounded bg-accent ${b.count > 0 ? "min-w-[4px]" : ""}`}
                    style={{ width: `${barPct}%` }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Req 7.4, 7.5 — strengths and areas for improvement. */
function PerformanceInsights({
  categories,
}: {
  categories: PerformanceCategory[];
}) {
  if (categories.length === 0) {
    return null;
  }

  const strengths = categories.filter((c) => c.label === "strength");
  const improvements = categories.filter(
    (c) => c.label === "area-for-improvement",
  );

  return (
    <div className="mb-6 rounded-lg bg-white border border-dark-border p-4">
      <h3 className="text-lg font-semibold text-[#1A1A1A] mb-3">
        Performance Insights
      </h3>

      <div className="flex gap-8 flex-wrap">
        {/* Strengths — Req 7.5 */}
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-green-600 font-medium mb-2">💪 Strengths</h4>
          {strengths.length === 0 ? (
            <p className="text-[#6B6B6B] text-sm">
              No strengths identified yet.
            </p>
          ) : (
            <ul role="list" aria-label="Strengths" className="space-y-2">
              {strengths.map((c) => (
                <li key={c.category} data-testid={`strength-${c.category}`}>
                  <strong className="text-[#1A1A1A]">{c.category}</strong>
                  <br />
                  <span className="text-sm text-[#6B6B6B]">
                    Avg {c.avgActualTime.toFixed(1)} min vs{" "}
                    {c.avgEstimatedTime.toFixed(1)} min estimated
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Areas for improvement — Req 7.4 */}
        <div className="flex-1 min-w-[200px]">
          <h4 className="text-red-500 font-medium mb-2">
            🎯 Areas for Improvement
          </h4>
          {improvements.length === 0 ? (
            <p className="text-[#6B6B6B] text-sm">
              No areas for improvement identified.
            </p>
          ) : (
            <ul
              role="list"
              aria-label="Areas for improvement"
              className="space-y-2"
            >
              {improvements.map((c) => (
                <li key={c.category} data-testid={`improvement-${c.category}`}>
                  <strong className="text-[#1A1A1A]">{c.category}</strong>
                  <br />
                  <span className="text-sm text-[#6B6B6B]">
                    Avg {c.avgActualTime.toFixed(1)} min vs{" "}
                    {c.avgEstimatedTime.toFixed(1)} min estimated
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
