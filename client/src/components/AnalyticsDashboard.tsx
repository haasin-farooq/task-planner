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
    <section aria-label="Analytics dashboard">
      <h2>Analytics Dashboard</h2>

      {/* Date range selector — Req 7.1, 7.2, 7.3 */}
      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      {loading && <p aria-live="polite">Loading analytics…</p>}

      {error && (
        <p role="alert" aria-live="assertive" style={{ color: "#dc2626" }}>
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
              style={{
                padding: "1rem",
                marginBottom: "1rem",
                backgroundColor: "#fef3c7",
                borderRadius: "0.5rem",
                border: "1px solid #f59e0b",
              }}
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
    <fieldset
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "1rem",
        alignItems: "center",
        marginBottom: "1.5rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        padding: "0.75rem",
      }}
    >
      <legend>Date Range</legend>
      <label>
        From{" "}
        <input
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          aria-label="Start date"
        />
      </label>
      <label>
        To{" "}
        <input
          type="date"
          value={endDate}
          min={startDate}
          max={todayISO()}
          onChange={(e) => onEndDateChange(e.target.value)}
          aria-label="End date"
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
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>Daily Completions</h3>
      <table
        aria-label="Daily task completions"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <thead>
          <tr>
            <th
              scope="col"
              style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}
            >
              Date
            </th>
            <th
              scope="col"
              style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}
            >
              Tasks
            </th>
            <th
              scope="col"
              style={{
                textAlign: "left",
                padding: "0.25rem 0.5rem",
                width: "60%",
              }}
            >
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody>
          {dailyStats.map((stat) => {
            const pct = (stat.tasksCompleted / maxCompleted) * 100;
            return (
              <tr key={stat.date} data-testid={`daily-stat-${stat.date}`}>
                <td style={{ padding: "0.25rem 0.5rem", whiteSpace: "nowrap" }}>
                  {formatDate(stat.date)}
                </td>
                <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
                  {stat.tasksCompleted}
                </td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  <div
                    role="img"
                    aria-label={`${stat.tasksCompleted} tasks completed on ${formatDate(stat.date)}`}
                    style={{
                      height: "1rem",
                      width: `${pct}%`,
                      minWidth: stat.tasksCompleted > 0 ? "4px" : "0",
                      backgroundColor: "#3b82f6",
                      borderRadius: "0.25rem",
                    }}
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
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>Average Time Comparison</h3>
      <div
        role="group"
        aria-label="Time comparison"
        style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}
      >
        <div data-testid="avg-estimated-time">
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Avg Estimated
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {avgEstimated.toFixed(1)} min
          </div>
        </div>
        <div data-testid="avg-actual-time">
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Avg Actual
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {avgActual.toFixed(1)} min
          </div>
        </div>
        <div data-testid="time-diff">
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Difference
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 500,
              color: diff > 0 ? "#dc2626" : diff < 0 ? "#16a34a" : "#6b7280",
            }}
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
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>Difficulty Breakdown</h3>
      <table
        aria-label="Task difficulty breakdown"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <thead>
          <tr>
            <th
              scope="col"
              style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}
            >
              Difficulty
            </th>
            <th
              scope="col"
              style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}
            >
              Count
            </th>
            <th
              scope="col"
              style={{ textAlign: "right", padding: "0.25rem 0.5rem" }}
            >
              %
            </th>
            <th
              scope="col"
              style={{
                textAlign: "left",
                padding: "0.25rem 0.5rem",
                width: "50%",
              }}
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
              >
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  {difficultyLabels[b.difficultyLevel] ??
                    `Level ${b.difficultyLevel}`}
                </td>
                <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
                  {b.count}
                </td>
                <td style={{ padding: "0.25rem 0.5rem", textAlign: "right" }}>
                  {pct.toFixed(0)}%
                </td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  <div
                    role="img"
                    aria-label={`${b.count} tasks at ${difficultyLabels[b.difficultyLevel] ?? `level ${b.difficultyLevel}`}`}
                    style={{
                      height: "1rem",
                      width: `${barPct}%`,
                      minWidth: b.count > 0 ? "4px" : "0",
                      backgroundColor: "#8b5cf6",
                      borderRadius: "0.25rem",
                    }}
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
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>Performance Insights</h3>

      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        {/* Strengths — Req 7.5 */}
        <div style={{ flex: 1, minWidth: "200px" }}>
          <h4 style={{ color: "#16a34a" }}>💪 Strengths</h4>
          {strengths.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              No strengths identified yet.
            </p>
          ) : (
            <ul role="list" aria-label="Strengths">
              {strengths.map((c) => (
                <li
                  key={c.category}
                  data-testid={`strength-${c.category}`}
                  style={{ marginBottom: "0.5rem" }}
                >
                  <strong>{c.category}</strong>
                  <br />
                  <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                    Avg {c.avgActualTime.toFixed(1)} min vs{" "}
                    {c.avgEstimatedTime.toFixed(1)} min estimated
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Areas for improvement — Req 7.4 */}
        <div style={{ flex: 1, minWidth: "200px" }}>
          <h4 style={{ color: "#dc2626" }}>🎯 Areas for Improvement</h4>
          {improvements.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              No areas for improvement identified.
            </p>
          ) : (
            <ul role="list" aria-label="Areas for improvement">
              {improvements.map((c) => (
                <li
                  key={c.category}
                  data-testid={`improvement-${c.category}`}
                  style={{ marginBottom: "0.5rem" }}
                >
                  <strong>{c.category}</strong>
                  <br />
                  <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
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
