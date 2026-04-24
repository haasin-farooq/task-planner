import { useMemo, useState } from "react";
import type { CategoryPerformanceStat } from "../../types";

export interface CategoryPerformanceProps {
  stats: CategoryPerformanceStat[];
  consistentlyFaster: string[];
  consistentlySlower: string[];
}

/** Minimum sample size for reliable statistics */
const MIN_SAMPLE_SIZE = 3;

type SortField =
  | "category"
  | "avgEstimatedTime"
  | "avgActualTime"
  | "avgTimeOverrun"
  | "sampleSize";

type SortDirection = "asc" | "desc";

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
 * Sort indicator arrow for table column headers.
 */
function SortIndicator({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) return null;
  return (
    <span aria-hidden="true" className="ml-1 inline-block">
      {direction === "asc" ? "▲" : "▼"}
    </span>
  );
}

/**
 * Category Performance section — displays a sortable table of per-category
 * performance stats and lists of consistently faster/slower categories.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 11.3
 */
export default function CategoryPerformance({
  stats,
  consistentlyFaster,
  consistentlySlower,
}: CategoryPerformanceProps) {
  const [sortField, setSortField] = useState<SortField>("avgTimeOverrun");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedStats = useMemo(() => {
    const sorted = [...stats].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === "category") {
        aVal = a.category.toLowerCase();
        bVal = b.category.toLowerCase();
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [stats, sortField, sortDirection]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "category" ? "asc" : "desc");
    }
  }

  const columns: { field: SortField; label: string }[] = [
    { field: "category", label: "Category" },
    { field: "avgEstimatedTime", label: "Avg Estimated" },
    { field: "avgActualTime", label: "Avg Actual" },
    { field: "avgTimeOverrun", label: "Avg Overrun" },
    { field: "sampleSize", label: "Sample Size" },
  ];

  return (
    <section aria-label="Category Performance">
      <h2 className="mb-4 font-serif text-xl font-semibold text-text-primary">
        Category Performance
      </h2>

      {/* Performance table */}
      <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-border bg-dark-card/60">
              {columns.map(({ field, label }) => (
                <th
                  key={field}
                  scope="col"
                  className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary hover:text-accent transition-colors"
                  onClick={() => handleSort(field)}
                  aria-sort={
                    sortField === field
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  {label}
                  <SortIndicator
                    active={sortField === field}
                    direction={sortDirection}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedStats.map((stat) => {
              const isInsufficient = stat.sampleSize < MIN_SAMPLE_SIZE;
              const needed = MIN_SAMPLE_SIZE - stat.sampleSize;

              return (
                <tr
                  key={stat.category}
                  className={`border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40 ${
                    isInsufficient ? "opacity-70" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {stat.category}
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
                  <td className="px-4 py-3 text-text-secondary">
                    {formatMinutes(stat.avgActualTime)}
                  </td>
                  <td
                    className={`px-4 py-3 font-medium ${
                      stat.avgTimeOverrun > 0
                        ? "text-red-600 dark:text-red-400"
                        : stat.avgTimeOverrun < 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-text-secondary"
                    }`}
                  >
                    {formatOverrun(stat.avgTimeOverrun)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {stat.sampleSize}
                  </td>
                </tr>
              );
            })}
            {sortedStats.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-sm text-text-secondary"
                >
                  No category data available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Consistently Faster / Slower lists */}
      {(consistentlyFaster.length > 0 || consistentlySlower.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {consistentlyFaster.length > 0 && (
            <div className="rounded-lg border border-green-200 dark:border-green-800 p-4 bg-green-50 dark:bg-green-900/20">
              <h3 className="mb-2 font-serif text-base font-semibold text-green-800 dark:text-green-400">
                Consistently Faster
              </h3>
              <ul className="space-y-1">
                {consistentlyFaster.map((category) => (
                  <li
                    key={category}
                    className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M13 5L6.5 11.5L3 8"
                        stroke="#16a34a"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {category}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {consistentlySlower.length > 0 && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 p-4 bg-red-50 dark:bg-red-900/20">
              <h3 className="mb-2 font-serif text-base font-semibold text-red-800 dark:text-red-400">
                Consistently Slower
              </h3>
              <ul className="space-y-1">
                {consistentlySlower.map((category) => (
                  <li
                    key={category}
                    className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 8H4M4 8L7 5M4 8L7 11"
                        stroke="#dc2626"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
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
