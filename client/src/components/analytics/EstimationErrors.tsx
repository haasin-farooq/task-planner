import type { EstimationErrorStats } from "../../types";
import LowDataState from "./LowDataState";

export interface EstimationErrorsProps {
  estimationErrors: EstimationErrorStats;
  totalCompleted: number;
}

/** Format minutes to a readable string */
function formatMinutes(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 60) return `${rounded} min`;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
}

/**
 * Estimation Errors section — shows avg error %, over/underestimation split,
 * biggest overruns/underruns tables, and error by category.
 */
export default function EstimationErrors({
  estimationErrors,
  totalCompleted,
}: EstimationErrorsProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="Estimation Errors">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Estimation Errors
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="Estimation Errors"
        />
      </section>
    );
  }

  if (!estimationErrors) {
    return null;
  }

  const {
    avgErrorPercent,
    overestimationCount,
    underestimationCount,
    biggestOverruns,
    biggestUnderruns,
    errorByCategory,
  } = estimationErrors;

  const totalEstimations = overestimationCount + underestimationCount;
  const overPct =
    totalEstimations > 0
      ? Math.round((overestimationCount / totalEstimations) * 100)
      : 0;
  const underPct = totalEstimations > 0 ? 100 - overPct : 0;

  return (
    <section aria-label="Estimation Errors">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Estimation Errors
      </h3>

      <div className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Avg Error
            </span>
            <p className="font-serif text-2xl font-semibold text-text-primary mt-1">
              {Math.round(avgErrorPercent)}%
            </p>
          </div>

          {/* Over/Under split bar */}
          <div className="rounded-lg border border-dark-border bg-dark-card p-4 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Overestimated vs Underestimated
            </span>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">
                Over: {overestimationCount}
              </span>
              <div className="flex-1 h-4 rounded-full overflow-hidden bg-dark-border flex">
                {overPct > 0 && (
                  <div
                    className="h-full bg-green-500 dark:bg-green-600 transition-all"
                    style={{ width: `${overPct}%` }}
                    title={`Overestimated: ${overestimationCount} (${overPct}%)`}
                  />
                )}
                {underPct > 0 && (
                  <div
                    className="h-full bg-red-500 dark:bg-red-600 transition-all"
                    style={{ width: `${underPct}%` }}
                    title={`Underestimated: ${underestimationCount} (${underPct}%)`}
                  />
                )}
              </div>
              <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">
                Under: {underestimationCount}
              </span>
            </div>
          </div>
        </div>

        {/* Biggest Overruns table */}
        {biggestOverruns.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
            <h4 className="px-4 pt-4 pb-2 font-serif text-base font-semibold text-text-primary">
              Biggest Overruns
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border bg-dark-card/60">
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Task
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Estimated
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Actual
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Overrun
                  </th>
                </tr>
              </thead>
              <tbody>
                {biggestOverruns.slice(0, 5).map((task, i) => (
                  <tr
                    key={`overrun-${i}`}
                    className="border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40"
                  >
                    <td
                      className="px-4 py-3 text-text-primary max-w-xs truncate"
                      title={task.description}
                    >
                      {task.description}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatMinutes(task.estimatedTime)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatMinutes(task.actualTime)}
                    </td>
                    <td className="px-4 py-3 font-medium text-red-600 dark:text-red-400">
                      +{formatMinutes(task.overrunMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Biggest Underruns table */}
        {biggestUnderruns.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
            <h4 className="px-4 pt-4 pb-2 font-serif text-base font-semibold text-text-primary">
              Biggest Underruns (Time Saved)
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border bg-dark-card/60">
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Task
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Estimated
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Actual
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Saved
                  </th>
                </tr>
              </thead>
              <tbody>
                {biggestUnderruns.slice(0, 5).map((task, i) => (
                  <tr
                    key={`underrun-${i}`}
                    className="border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40"
                  >
                    <td
                      className="px-4 py-3 text-text-primary max-w-xs truncate"
                      title={task.description}
                    >
                      {task.description}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatMinutes(task.estimatedTime)}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {formatMinutes(task.actualTime)}
                    </td>
                    <td className="px-4 py-3 font-medium text-green-600 dark:text-green-400">
                      -{formatMinutes(task.savedMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error by Category table */}
        {errorByCategory.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
            <h4 className="px-4 pt-4 pb-2 font-serif text-base font-semibold text-text-primary">
              Error by Category
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border bg-dark-card/60">
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Category
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Avg Error %
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Sample Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {errorByCategory.map((entry) => (
                  <tr
                    key={entry.category}
                    className="border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {entry.category}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium ${entry.avgErrorPercent > 30 ? "text-red-600 dark:text-red-400" : "text-text-secondary"}`}
                    >
                      {Math.round(entry.avgErrorPercent)}%
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {entry.sampleSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
