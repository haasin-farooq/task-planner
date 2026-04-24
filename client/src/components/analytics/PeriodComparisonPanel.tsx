import type { PeriodComparison } from "../../types";
import LowDataState from "./LowDataState";

export interface PeriodComparisonPanelProps {
  comparison: PeriodComparison;
  totalCompleted: number;
}

/** Format minutes to a readable string */
function formatMinutes(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 60) return `${rounded} min`;
  const hours = Math.floor(Math.abs(rounded) / 60);
  const mins = Math.abs(rounded) % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Delta display with arrow and color */
function DeltaValue({
  value,
  format,
  invertColor,
}: {
  value: number;
  format: "number" | "minutes" | "percent";
  invertColor?: boolean;
}) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isZero = value === 0;

  // For some metrics, positive is bad (e.g., avg time going up)
  const goodDirection = invertColor ? !isPositive : isPositive;

  let colorClass = "text-text-secondary";
  if (!isZero) {
    colorClass = goodDirection
      ? "text-green-600 dark:text-green-400"
      : "text-red-600 dark:text-red-400";
  }

  let display: string;
  if (format === "minutes") {
    display = formatMinutes(Math.abs(value));
  } else if (format === "percent") {
    display = `${Math.round(Math.abs(value))}%`;
  } else {
    display = String(Math.abs(Math.round(value)));
  }

  const arrow = isPositive ? "↑" : isNegative ? "↓" : "—";

  return (
    <span className={`font-medium ${colorClass}`}>
      {arrow} {display}
    </span>
  );
}

interface MetricRowProps {
  label: string;
  current: number;
  previous: number;
  delta: number;
  format: "number" | "minutes" | "percent";
  invertColor?: boolean;
}

function MetricRow({
  label,
  current,
  previous,
  delta,
  format,
  invertColor,
}: MetricRowProps) {
  const fmt = (v: number) => {
    if (format === "minutes") return formatMinutes(v);
    if (format === "percent") return `${Math.round(v)}%`;
    return String(Math.round(v));
  };

  return (
    <div className="grid grid-cols-4 gap-2 py-2 border-b border-dark-border last:border-b-0">
      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </span>
      <span className="text-sm text-text-primary text-center">
        {fmt(current)}
      </span>
      <span className="text-sm text-text-secondary text-center">
        {fmt(previous)}
      </span>
      <span className="text-sm text-center">
        <DeltaValue value={delta} format={format} invertColor={invertColor} />
      </span>
    </div>
  );
}

/**
 * Period Comparison Panel — shows a side-by-side comparison of current
 * vs previous period metrics with delta indicators.
 */
export default function PeriodComparisonPanel({
  comparison,
  totalCompleted,
}: PeriodComparisonPanelProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="Period Comparison">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Period Comparison
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="Period Comparison"
        />
      </section>
    );
  }

  if (!comparison) {
    return null;
  }

  return (
    <section aria-label="Period Comparison">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Period Comparison
      </h3>

      <div className="rounded-lg border border-dark-border bg-dark-surface p-4">
        {/* Column headers */}
        <div className="grid grid-cols-4 gap-2 pb-2 border-b border-dark-border mb-1">
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Metric
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary text-center">
            Current
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary text-center">
            Previous
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary text-center">
            Change
          </span>
        </div>

        <MetricRow
          label="Tasks"
          current={comparison.current.tasksCompleted}
          previous={comparison.previous.tasksCompleted}
          delta={comparison.deltas.tasksCompleted}
          format="number"
        />
        <MetricRow
          label="Total Time"
          current={comparison.current.totalActualTime}
          previous={comparison.previous.totalActualTime}
          delta={comparison.deltas.totalActualTime}
          format="minutes"
          invertColor
        />
        <MetricRow
          label="Avg Time"
          current={comparison.current.avgActualTime}
          previous={comparison.previous.avgActualTime}
          delta={comparison.deltas.avgActualTime}
          format="minutes"
          invertColor
        />
        <MetricRow
          label="Accuracy"
          current={comparison.current.estimationAccuracy}
          previous={comparison.previous.estimationAccuracy}
          delta={comparison.deltas.estimationAccuracy}
          format="percent"
        />

        {/* Most changed category */}
        {comparison.mostChangedCategory && (
          <div className="mt-3 pt-3 border-t border-dark-border">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Most Changed Category
            </span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                {comparison.mostChangedCategory.category}
              </span>
              <span
                className={`text-sm font-medium ${
                  comparison.mostChangedCategory.changePercent > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400"
                }`}
              >
                {comparison.mostChangedCategory.changePercent > 0 ? "+" : ""}
                {Math.round(comparison.mostChangedCategory.changePercent)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
