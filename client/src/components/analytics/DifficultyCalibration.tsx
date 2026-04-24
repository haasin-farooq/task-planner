import { useMemo } from "react";
import type { DifficultyCalibrationStat } from "../../types";

export interface DifficultyCalibrationProps {
  calibration: DifficultyCalibrationStat[];
}

/** Minimum task count for reliable statistics */
const MIN_TASK_COUNT = 3;

/** Threshold for highlighting overestimation rows (20%) */
const OVERRUN_HIGHLIGHT_THRESHOLD = 0.2;

/** Difficulty level labels */
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Very Easy",
  2: "Easy",
  3: "Medium",
  4: "Hard",
  5: "Very Hard",
};

/** Format minutes to a readable string like "12 min" or "1h 5m" */
function formatMinutes(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 60) return `${rounded} min`;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
}

/** Format overrun with a +/- prefix */
function formatOverrun(value: number): string {
  const formatted = formatMinutes(value);
  if (value > 0 && !formatted.startsWith("+")) return `+${formatted}`;
  return formatted;
}

/**
 * Warning icon for insufficient data indicator.
 */
function InsufficientDataIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="inline-block mr-1 align-text-bottom"
    >
      <path
        d="M8 1L15 14H1L8 1Z"
        stroke="#D97706"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="#FEF3C7"
      />
      <path
        d="M8 6V9"
        stroke="#D97706"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.5" r="0.75" fill="#D97706" />
    </svg>
  );
}

/**
 * Determine whether higher difficulty correlates with longer actual times.
 */
function computeCorrelation(
  calibration: DifficultyCalibrationStat[],
): { label: string; positive: boolean } | null {
  const reliable = calibration
    .filter((s) => s.taskCount >= MIN_TASK_COUNT)
    .sort((a, b) => a.difficultyLevel - b.difficultyLevel);

  if (reliable.length < 2) return null;

  let increasing = 0;
  let total = 0;
  for (let i = 1; i < reliable.length; i++) {
    total++;
    if (reliable[i].avgActualTime > reliable[i - 1].avgActualTime) {
      increasing++;
    }
  }

  const ratio = increasing / total;
  if (ratio >= 0.6) {
    return { label: "Higher difficulty = longer tasks", positive: true };
  }
  return {
    label: "Difficulty does not strongly predict time",
    positive: false,
  };
}

/**
 * Check if a row should be highlighted — actual exceeds estimated by > 20%.
 */
function isOverrunHighlighted(stat: DifficultyCalibrationStat): boolean {
  if (stat.avgEstimatedTime <= 0) return false;
  return (
    (stat.avgActualTime - stat.avgEstimatedTime) / stat.avgEstimatedTime >
    OVERRUN_HIGHLIGHT_THRESHOLD
  );
}

/**
 * Difficulty Calibration section — displays a table showing how task difficulty
 * relates to actual effort.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 11.3
 */
export default function DifficultyCalibration({
  calibration,
}: DifficultyCalibrationProps) {
  const sortedCalibration = useMemo(
    () =>
      [...calibration].sort((a, b) => a.difficultyLevel - b.difficultyLevel),
    [calibration],
  );

  const correlation = useMemo(
    () => computeCorrelation(calibration),
    [calibration],
  );

  const columns = [
    { label: "Difficulty Level" },
    { label: "Avg Estimated" },
    { label: "Avg Actual" },
    { label: "Avg Overrun" },
    { label: "Task Count" },
  ];

  return (
    <section aria-label="Difficulty Calibration">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-text-primary">
          Difficulty &amp; Effort Calibration
        </h2>

        {/* Correlation indicator */}
        {correlation && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              correlation.positive
                ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"
            }`}
            role="status"
            aria-label={`Correlation: ${correlation.label}`}
          >
            {correlation.positive ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 12L13 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M7 4H13V10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 8H13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {correlation.label}
          </span>
        )}
      </div>

      {/* Calibration table */}
      <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-border bg-dark-card/60">
              {columns.map(({ label }) => (
                <th
                  key={label}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedCalibration.map((stat) => {
              const isInsufficient = stat.taskCount < MIN_TASK_COUNT;
              const needed = MIN_TASK_COUNT - stat.taskCount;
              const highlighted = !isInsufficient && isOverrunHighlighted(stat);
              const levelLabel =
                DIFFICULTY_LABELS[stat.difficultyLevel] ||
                `Level ${stat.difficultyLevel}`;

              return (
                <tr
                  key={stat.difficultyLevel}
                  className={`border-b border-dark-border last:border-b-0 transition-colors ${
                    highlighted
                      ? "bg-red-50/80 hover:bg-red-50 dark:bg-red-900/20 dark:hover:bg-red-900/30"
                      : "hover:bg-dark-hover/40"
                  } ${isInsufficient ? "opacity-70" : ""}`}
                  aria-label={
                    highlighted
                      ? `${levelLabel}: actual time exceeds estimated by more than 20%`
                      : undefined
                  }
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          highlighted
                            ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                            : "bg-dark-bg text-text-secondary"
                        }`}
                        aria-hidden="true"
                      >
                        {stat.difficultyLevel}
                      </span>
                      {levelLabel}
                    </span>
                    {isInsufficient && (
                      <span
                        className="ml-2 text-xs text-amber-600"
                        title={`${needed} more task${needed !== 1 ? "s" : ""} needed for reliable statistics`}
                      >
                        <InsufficientDataIcon />
                        <span className="sr-only">Insufficient data: </span>
                        {needed} more needed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatMinutes(stat.avgEstimatedTime)}
                  </td>
                  <td
                    className={`px-4 py-3 ${
                      highlighted
                        ? "font-medium text-red-700 dark:text-red-400"
                        : "text-text-secondary"
                    }`}
                  >
                    {formatMinutes(stat.avgActualTime)}
                  </td>
                  <td
                    className={`px-4 py-3 font-medium ${
                      stat.avgTimeOverrun > 0
                        ? highlighted
                          ? "text-red-700 dark:text-red-400"
                          : "text-red-600 dark:text-red-400"
                        : stat.avgTimeOverrun < 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-text-secondary"
                    }`}
                  >
                    {formatOverrun(stat.avgTimeOverrun)}
                    {highlighted && (
                      <span className="ml-1.5 text-xs text-red-500">⚠</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {stat.taskCount}
                  </td>
                </tr>
              );
            })}
            {sortedCalibration.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-text-secondary"
                >
                  No difficulty calibration data available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend for highlighted rows */}
      {sortedCalibration.some(
        (s) =>
          !s.taskCount ||
          (s.taskCount >= MIN_TASK_COUNT && isOverrunHighlighted(s)),
      ) && (
        <p className="mt-2 text-xs text-text-secondary">
          <span
            className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-red-100 dark:bg-red-900/40"
            aria-hidden="true"
          />
          Highlighted rows indicate actual time exceeds estimated by more than
          20%.
        </p>
      )}
    </section>
  );
}
