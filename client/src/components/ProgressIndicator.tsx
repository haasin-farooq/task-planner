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
      <h3>Daily Progress</h3>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.5rem",
        }}
      >
        {/* Progress bar track */}
        <div
          style={{
            flex: 1,
            height: "1.25rem",
            backgroundColor: "#e5e7eb",
            borderRadius: "0.625rem",
            overflow: "hidden",
          }}
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
            style={{
              height: "100%",
              width: `${percent}%`,
              backgroundColor: percent === 100 ? "#16a34a" : "#3b82f6",
              borderRadius: "0.625rem",
              transition: "width 0.3s ease, background-color 0.3s ease",
            }}
          />
        </div>

        {/* Percentage label */}
        <span
          data-testid="progress-percent"
          style={{ fontWeight: 600, minWidth: "3.5rem", textAlign: "right" }}
        >
          {Math.round(percent)}%
        </span>
      </div>

      {/* Task count */}
      <p
        data-testid="progress-count"
        style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}
      >
        {completed} of {total} task{total !== 1 ? "s" : ""} completed
      </p>
    </section>
  );
}
