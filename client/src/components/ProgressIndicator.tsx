import type { AnalyzedTask } from "../types";

export interface ProgressIndicatorProps {
  /** All tasks in the current session. */
  tasks: AnalyzedTask[];
  /** Set of task IDs that have been completed. */
  completedTaskIds: Set<string>;
}

/**
 * Progress Indicator component.
 *
 * Displays a progress bar showing the percentage of planned tasks
 * completed for the current day. Updates automatically when the
 * completedTaskIds set changes.
 *
 * Requirements: 7.6, 8.2
 */
export default function ProgressIndicator({
  tasks,
  completedTaskIds,
}: ProgressIndicatorProps) {
  const total = tasks.length;
  const completed = tasks.filter((t) => completedTaskIds.has(t.id)).length;
  const percent = total > 0 ? (completed / total) * 100 : 0;

  return (
    <section aria-label="Daily progress">
      <h3 className="text-text-primary font-semibold">Daily Progress</h3>

      <div className="flex items-center gap-3 mb-2">
        {/* Progress bar track */}
        <div
          className="flex-1 h-5 bg-dark-border rounded-[0.625rem] overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${Math.round(percent)}% of tasks completed`}
          data-testid="progress-bar"
        >
          {/* Filled portion */}
          <div
            data-testid="progress-bar-fill"
            className="h-full rounded-[0.625rem] transition-all duration-300 ease-in-out"
            style={{
              width: `${percent}%`,
              backgroundColor: percent === 100 ? "#16a34a" : "#3b82f6",
            }}
          />
        </div>

        {/* Percentage label */}
        <span
          data-testid="progress-percent"
          className="font-semibold min-w-[3.5rem] text-right text-text-primary"
        >
          {Math.round(percent)}%
        </span>
      </div>

      {/* Task count */}
      <p
        data-testid="progress-count"
        className="text-sm text-text-secondary m-0"
      >
        {completed} of {total} task{total !== 1 ? "s" : ""} completed
      </p>
    </section>
  );
}
