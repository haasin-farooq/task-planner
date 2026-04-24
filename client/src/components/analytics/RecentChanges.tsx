import type { CategoryChange, OverrunTask } from "../../types";
import LowDataState from "./LowDataState";

export interface RecentChangesProps {
  fasterCategories: CategoryChange[];
  slowerCategories: CategoryChange[];
  largestOverruns: OverrunTask[];
  limitedDataCategories: string[];
  daysOfData: number;
}

/** Format a percentage change with +/- prefix */
function formatPercentChange(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

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

function FasterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M8 3v10M8 13l-3-3M8 13l3-3"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SlowerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M8 13V3M8 3L5 6M8 3l3 3"
        stroke="#dc2626"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LimitedDataIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="inline-block mr-1 align-text-bottom shrink-0"
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
 * Recent Changes section — displays faster/slower category lists,
 * top overrun tasks, and limited-data categories.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1
 */
export default function RecentChanges({
  fasterCategories,
  slowerCategories,
  largestOverruns,
  limitedDataCategories,
  daysOfData,
}: RecentChangesProps) {
  if (daysOfData < 14) {
    return (
      <section aria-label="Recent Behavioral Changes">
        <h2 className="mb-4 font-serif text-xl font-semibold text-text-primary">
          Recent Changes
        </h2>
        <LowDataState
          current={daysOfData}
          required={14}
          unit="days"
          sectionName="Recent Changes"
        />
      </section>
    );
  }

  const displayedOverruns = largestOverruns.slice(0, 5);
  const hasChanges = fasterCategories.length > 0 || slowerCategories.length > 0;
  const hasOverruns = displayedOverruns.length > 0;
  const hasLimitedData = limitedDataCategories.length > 0;
  const hasContent = hasChanges || hasOverruns || hasLimitedData;

  return (
    <section aria-label="Recent Behavioral Changes">
      <h2 className="mb-4 font-serif text-xl font-semibold text-text-primary">
        Recent Changes
      </h2>

      {!hasContent ? (
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No significant behavioral changes detected in the last 2 weeks.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Faster / Slower category lists */}
          {hasChanges && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {fasterCategories.length > 0 && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 p-4 bg-green-50 dark:bg-green-900/20">
                  <h3 className="mb-2 font-serif text-base font-semibold text-green-800 dark:text-green-400">
                    Getting Faster
                  </h3>
                  <ul className="space-y-2">
                    {fasterCategories.map((change) => (
                      <li
                        key={change.category}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex items-center gap-2 text-green-700 dark:text-green-400">
                          <FasterIcon />
                          {change.category}
                        </span>
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {formatPercentChange(change.percentageChange)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {slowerCategories.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 p-4 bg-red-50 dark:bg-red-900/20">
                  <h3 className="mb-2 font-serif text-base font-semibold text-red-800 dark:text-red-400">
                    Getting Slower
                  </h3>
                  <ul className="space-y-2">
                    {slowerCategories.map((change) => (
                      <li
                        key={change.category}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex items-center gap-2 text-red-700 dark:text-red-400">
                          <SlowerIcon />
                          {change.category}
                        </span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {formatPercentChange(change.percentageChange)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Largest overrun tasks table */}
          {hasOverruns && (
            <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
              <h3 className="px-4 pt-4 pb-2 font-serif text-base font-semibold text-text-primary">
                Largest Time Overruns
              </h3>
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
                  {displayedOverruns.map((task, index) => (
                    <tr
                      key={`${task.description}-${index}`}
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

          {/* Limited-data categories */}
          {hasLimitedData && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 p-4 bg-amber-50 dark:bg-amber-900/20">
              <h3 className="mb-2 font-serif text-base font-semibold text-amber-800 dark:text-amber-400">
                Categories with Limited Data
              </h3>
              <ul className="space-y-1">
                {limitedDataCategories.map((category) => (
                  <li
                    key={category}
                    className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"
                  >
                    <LimitedDataIcon />
                    {category}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
