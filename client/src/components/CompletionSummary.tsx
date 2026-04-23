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

  const diffColorClass =
    diff > 0 ? "text-red-500" : diff < 0 ? "text-green-600" : "text-[#6B6B6B]";

  return (
    <section
      aria-label="Completion summary"
      data-testid="completion-summary"
      className="p-6 bg-white border border-green-500 rounded-xl text-center mb-6 shadow-sm"
    >
      <h2 className="text-green-600 mt-0 text-xl font-semibold">
        🎉 All Tasks Complete!
      </h2>

      <div className="flex justify-center gap-8 flex-wrap mb-4">
        <div data-testid="total-estimated">
          <div className="text-sm text-[#6B6B6B]">Total Estimated</div>
          <div className="text-2xl font-semibold text-[#1A1A1A]">
            {totalEstimated} min
          </div>
        </div>

        <div data-testid="total-actual">
          <div className="text-sm text-[#6B6B6B]">Total Actual</div>
          <div className="text-2xl font-semibold text-[#1A1A1A]">
            {totalActual} min
          </div>
        </div>
      </div>

      <p
        data-testid="time-comparison"
        className={`text-base font-medium m-0 ${diffColorClass}`}
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
