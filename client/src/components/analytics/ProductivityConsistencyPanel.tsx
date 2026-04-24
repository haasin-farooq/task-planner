import type { ProductivityConsistency } from "../../types";
import BarChart from "./BarChart";
import LowDataState from "./LowDataState";

export interface ProductivityConsistencyPanelProps {
  consistency: ProductivityConsistency;
  weeksOfData: number;
}

/** Badge styles for consistency labels */
const CONSISTENCY_STYLES: Record<
  ProductivityConsistency["consistencyLabel"],
  { className: string; label: string }
> = {
  "very-consistent": {
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    label: "Very Consistent",
  },
  consistent: {
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    label: "Consistent",
  },
  variable: {
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    label: "Variable",
  },
  "highly-variable": {
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    label: "Highly Variable",
  },
};

/**
 * Productivity Consistency Panel — shows consistency label, avg weekly tasks,
 * variance %, and a bar chart of weekly task counts.
 */
export default function ProductivityConsistencyPanel({
  consistency,
  weeksOfData,
}: ProductivityConsistencyPanelProps) {
  if (weeksOfData < 3) {
    return (
      <section aria-label="Productivity Consistency">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Productivity Consistency
        </h3>
        <LowDataState
          current={weeksOfData}
          required={3}
          unit="weeks"
          sectionName="Productivity Consistency"
        />
      </section>
    );
  }

  if (!consistency) {
    return null;
  }

  const style = CONSISTENCY_STYLES[consistency.consistencyLabel];

  const chartData = consistency.weeklyScores.map((w) => ({
    label: w.weekStart,
    value: w.tasksCompleted,
    highlight: false,
  }));

  return (
    <section aria-label="Productivity Consistency">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Productivity Consistency
      </h3>

      <div className="space-y-4">
        {/* Summary row */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-dark-border bg-dark-card p-4 flex flex-col items-center justify-center">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary mb-2">
              Consistency
            </span>
            <span
              className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ${style.className}`}
            >
              {style.label}
            </span>
          </div>

          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Avg Weekly Tasks
            </span>
            <p className="font-serif text-2xl font-semibold text-text-primary mt-1">
              {Math.round(consistency.avgWeeklyTasks * 10) / 10}
            </p>
          </div>

          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Variance
            </span>
            <p className="font-serif text-2xl font-semibold text-text-primary mt-1">
              {Math.round(consistency.taskVariancePercent)}%
            </p>
            <span className="text-xs text-text-secondary">
              coefficient of variation
            </span>
          </div>
        </div>

        {/* Weekly tasks bar chart */}
        {chartData.length > 0 && (
          <BarChart
            data={chartData}
            ariaLabel="Bar chart showing tasks completed per week"
          />
        )}
      </div>
    </section>
  );
}
