import type { TimeAllocationEntry } from "../../types";
import BarChart from "./BarChart";
import LowDataState from "./LowDataState";

export interface TimeAllocationProps {
  timeAllocation: TimeAllocationEntry[];
  totalCompleted: number;
}

/** Format minutes to a readable string like "12 min" or "1h 5m" */
function formatMinutes(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 60) return `${rounded} min`;
  const hours = Math.floor(Math.abs(rounded) / 60);
  const mins = Math.abs(rounded) % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Time Allocation section — shows a horizontal bar chart of time spent
 * per category with percentage labels. Displays top 8 categories.
 */
export default function TimeAllocation({
  timeAllocation,
  totalCompleted,
}: TimeAllocationProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="Time Allocation">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Time Allocation
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="Time Allocation"
        />
      </section>
    );
  }

  if (!timeAllocation || timeAllocation.length === 0) {
    return (
      <section aria-label="Time Allocation">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Time Allocation
        </h3>
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No time allocation data available yet.
          </p>
        </div>
      </section>
    );
  }

  const top8 = [...timeAllocation]
    .sort((a, b) => b.totalActualTime - a.totalActualTime)
    .slice(0, 8);

  const chartData = top8.map((entry) => ({
    label: entry.category,
    value: Math.round(entry.totalActualTime),
    highlight: entry.percentOfTotal >= 20,
  }));

  return (
    <section aria-label="Time Allocation">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Time Allocation
      </h3>

      <BarChart
        data={chartData}
        ariaLabel="Horizontal bar chart showing time spent per category"
        layout="vertical"
      />

      {/* Summary list below chart */}
      <div className="mt-3 space-y-1.5">
        {top8.map((entry) => (
          <div
            key={entry.category}
            className="flex items-center justify-between text-sm px-2"
          >
            <span className="text-text-primary font-medium truncate max-w-[40%]">
              {entry.category}
            </span>
            <div className="flex items-center gap-4 text-text-secondary">
              <span>{formatMinutes(entry.totalActualTime)}</span>
              <span className="inline-flex items-center rounded-full bg-dark-surface px-2 py-0.5 text-xs font-medium text-text-secondary border border-dark-border">
                {Math.round(entry.percentOfTotal)}%
              </span>
              <span className="text-xs">{entry.taskCount} tasks</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
