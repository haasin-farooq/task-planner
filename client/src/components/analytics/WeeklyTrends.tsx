import type { WeeklyTrendPoint } from "../../types";
import TrendChart from "./TrendChart";
import LowDataState from "./LowDataState";

export interface WeeklyTrendsProps {
  weeklyTrends: WeeklyTrendPoint[];
  weeksOfData: number;
}

/** Format minutes into a human-readable string for chart tooltips/axes. */
function formatMinutes(value: number): string {
  if (value < 60) return `${Math.round(value)}m`;
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Weekly Behavior Trends section. Renders three trend charts showing
 * tasks per week, total time per week, and actual vs estimated time per week.
 * Displays a low-data state when fewer than 2 weeks of data are available.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 11.1, 11.5
 */
export default function WeeklyTrends({
  weeklyTrends,
  weeksOfData,
}: WeeklyTrendsProps) {
  if (weeksOfData < 2) {
    return (
      <section aria-label="Weekly Behavior Trends">
        <h2 className="mb-4 font-serif text-xl font-semibold text-text-primary">
          Weekly Behavior Trends
        </h2>
        <LowDataState
          current={weeksOfData}
          required={2}
          unit="weeks"
          sectionName="Weekly Trends"
        />
      </section>
    );
  }

  const tasksPerWeek = weeklyTrends.map((point) => ({
    label: point.weekStart,
    value: point.tasksCompleted,
  }));

  const timePerWeek = weeklyTrends.map((point) => ({
    label: point.weekStart,
    value: point.totalActualTime,
  }));

  const actualVsEstimated = weeklyTrends.map((point) => ({
    label: point.weekStart,
    value: point.avgActualTime,
    secondaryValue: point.avgEstimatedTime,
  }));

  return (
    <section aria-label="Weekly Behavior Trends">
      <h2 className="mb-4 font-serif text-xl font-semibold text-text-primary">
        Weekly Behavior Trends
      </h2>

      <div className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-secondary">
            Tasks Completed per Week
          </h3>
          <TrendChart
            data={tasksPerWeek}
            ariaLabel="Trend chart showing tasks completed per week over the last 8 weeks"
            valueLabel="Tasks"
            formatValue={(v) => String(Math.round(v))}
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-text-secondary">
            Total Time per Week
          </h3>
          <TrendChart
            data={timePerWeek}
            ariaLabel="Trend chart showing total actual time spent per week over the last 8 weeks"
            valueLabel="Total Time"
            formatValue={formatMinutes}
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-text-secondary">
            Actual vs Estimated Time per Week
          </h3>
          <TrendChart
            data={actualVsEstimated}
            ariaLabel="Trend chart comparing average actual time versus average estimated time per week"
            showSecondaryLine
            valueLabel="Actual"
            secondaryLabel="Estimated"
            formatValue={formatMinutes}
          />
        </div>
      </div>
    </section>
  );
}
