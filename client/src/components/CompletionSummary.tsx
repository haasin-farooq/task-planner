import type { AnalyzedTask } from "../types";

export interface CompletionSummaryProps {
  /** All tasks in the session. */
  tasks: AnalyzedTask[];
  /** Map of task ID → actual time spent (minutes). */
  actualTimes: Map<string, number>;
}

/**
 * Completion Summary component.
 *
 * Displayed when all tasks for the day are marked as complete.
 * Shows total time spent vs total estimated time.
 *
 * Requirements: 8.3
 */
export default function CompletionSummary({
  tasks,
  actualTimes,
}: CompletionSummaryProps) {
  const totalEstimated = tasks.reduce(
    (sum, t) => sum + t.metrics.estimatedTime,
    0,
  );
  const totalActual = tasks.reduce(
    (sum, t) => sum + (actualTimes.get(t.id) ?? 0),
    0,
  );
  const diff = totalActual - totalEstimated;

  return (
    <section
      aria-label="Completion summary"
      data-testid="completion-summary"
      style={{
        padding: "1.5rem",
        backgroundColor: "#f0fdf4",
        border: "1px solid #16a34a",
        borderRadius: "0.75rem",
        textAlign: "center",
        marginBottom: "1.5rem",
      }}
    >
      <h2 style={{ color: "#16a34a", marginTop: 0 }}>🎉 All Tasks Complete!</h2>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "2rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div data-testid="total-estimated">
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Total Estimated
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {totalEstimated} min
          </div>
        </div>

        <div data-testid="total-actual">
          <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Total Actual
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {totalActual} min
          </div>
        </div>
      </div>

      <p
        data-testid="time-comparison"
        style={{
          fontSize: "1rem",
          fontWeight: 500,
          color: diff > 0 ? "#dc2626" : diff < 0 ? "#16a34a" : "#6b7280",
          margin: 0,
        }}
      >
        {diff > 0
          ? `You took ${diff} min longer than estimated.`
          : diff < 0
            ? `You finished ${Math.abs(diff)} min ahead of schedule!`
            : "Right on target!"}
      </p>
    </section>
  );
}
