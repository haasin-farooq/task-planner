import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import type { ExtendedAnalyticsSummary } from "../types";
import KPIPanel from "./analytics/KPIPanel";
import WeeklyTrends from "./analytics/WeeklyTrends";
import CategoryPerformance from "./analytics/CategoryPerformance";
import InsightsPanel from "./analytics/InsightsPanel";
import EstimationAccuracy from "./analytics/EstimationAccuracy";
import DifficultyCalibration from "./analytics/DifficultyCalibration";
import RecentChanges from "./analytics/RecentChanges";

export interface AnalyticsDashboardProps {
  /** Current user ID for fetching analytics. */
  userId: string;
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
 * date range and displays decomposed dashboard sections:
 * - KPI Panel (overview metrics)
 * - Weekly Behavior Trends (line charts)
 * - Category Performance (sortable table)
 * - Behavioral Insights (natural language cards)
 * - Estimation Accuracy (trend charts + label)
 * - Difficulty & Effort Calibration (table)
 * - Recent Behavioral Changes (lists + overruns)
 *
 * Preserves backward compatibility: the insufficient-data banner still
 * renders when the base AnalyticsSummary flags it, and the zero-completed
 * welcome state is handled.
 *
 * Requirements: 9.3, 10.1, 10.2, 10.3, 10.4, 10.6, 11.1, 11.2, 11.3, 11.4
 */
export default function AnalyticsDashboard({
  userId,
}: AnalyticsDashboardProps) {
  const [startDate, setStartDate] = useState(daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [summary, setSummary] = useState<ExtendedAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<ExtendedAnalyticsSummary>(
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

  const totalCompleted = summary?.dataStatus?.totalCompletedTasks ?? 0;
  const weeksOfData = summary?.dataStatus?.weeksOfData ?? 0;
  const daysOfData = summary?.dataStatus?.daysOfData ?? 0;

  return (
    <section aria-label="Analytics dashboard" className="space-y-6 pb-12">
      <h2 className="font-serif text-2xl font-bold text-[#1A1A1A]">
        Analytics Dashboard
      </h2>

      {/* Date range selector — Req 10.6 */}
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
          {/* Backward-compatible insufficient data banner */}
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

          {/* Zero-completed-tasks welcome state — Req 9.3 */}
          {totalCompleted === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-[#E8E4DF] p-8 text-center"
              style={{ backgroundColor: "#FFF8F0" }}
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#E8734A]/10">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                    stroke="#E8734A"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="font-serif text-xl font-semibold text-[#1A1A1A]">
                Welcome to Your Analytics Dashboard
              </h3>
              <p className="mt-2 text-sm text-[#6B6B6B] max-w-md mx-auto">
                Start completing tasks to unlock insights about your
                productivity patterns. Your data will appear here as you make
                progress.
              </p>
            </div>
          )}

          {/* Req 10.1 — Sections in order: KPI → Trends → Category → Insights → Accuracy → Calibration → Changes */}

          {/* KPI Panel — Req 2.1–2.7 */}
          <KPIPanel
            kpis={summary.kpis}
            insufficientData={summary.insufficientData}
            totalCompleted={totalCompleted}
          />

          {/* Weekly Behavior Trends — Req 3.1–3.6 */}
          {summary.weeklyTrends && (
            <WeeklyTrends
              weeklyTrends={summary.weeklyTrends}
              weeksOfData={weeksOfData}
            />
          )}

          {/* Category Performance — Req 4.1–4.5 */}
          {summary.categoryPerformance && (
            <CategoryPerformance
              stats={summary.categoryPerformance.stats}
              consistentlyFaster={
                summary.categoryPerformance.consistentlyFaster
              }
              consistentlySlower={
                summary.categoryPerformance.consistentlySlower
              }
            />
          )}

          {/* Behavioral Insights — Req 5.5, 5.6 */}
          {summary.insights && (
            <InsightsPanel
              insights={summary.insights}
              totalCompleted={totalCompleted}
            />
          )}

          {/* Estimation Accuracy — Req 6.1–6.4 */}
          {summary.estimationAccuracyTrend && (
            <EstimationAccuracy
              weeklyAccuracy={summary.estimationAccuracyTrend.weeklyAccuracy}
              trendLabel={summary.estimationAccuracyTrend.trendLabel}
              weeksOfData={weeksOfData}
            />
          )}

          {/* Difficulty & Effort Calibration — Req 7.1–7.4 */}
          {summary.difficultyCalibration && (
            <DifficultyCalibration
              calibration={summary.difficultyCalibration}
            />
          )}

          {/* Recent Behavioral Changes — Req 8.1–8.5 */}
          {summary.recentChanges && (
            <RecentChanges
              fasterCategories={summary.recentChanges.fasterCategories}
              slowerCategories={summary.recentChanges.slowerCategories}
              largestOverruns={summary.recentChanges.largestOverruns}
              limitedDataCategories={
                summary.recentChanges.limitedDataCategories
              }
              daysOfData={daysOfData}
            />
          )}
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
    <fieldset className="flex flex-wrap gap-4 items-center mb-6 border border-[#E8E4DF] rounded-lg p-3 bg-white">
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
          className="ml-1 rounded-md border border-[#E8E4DF] bg-white px-2 py-1 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#E8734A]"
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
          className="ml-1 rounded-md border border-[#E8E4DF] bg-white px-2 py-1 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#E8734A]"
        />
      </label>
    </fieldset>
  );
}
