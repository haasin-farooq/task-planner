import type { DayOfWeekPattern } from "../../types";
import BarChart from "./BarChart";
import LowDataState from "./LowDataState";

export interface DayOfWeekPatternsProps {
  patterns: DayOfWeekPattern[];
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

/**
 * Day-of-Week Patterns section — shows a bar chart of tasks completed
 * by weekday and a table with avg actual time and estimation accuracy per day.
 * Highlights strongest and weakest days.
 */
export default function DayOfWeekPatterns({
  patterns,
  totalCompleted,
}: DayOfWeekPatternsProps) {
  if (totalCompleted < 10) {
    return (
      <section aria-label="Day-of-Week Patterns">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Day-of-Week Patterns
        </h3>
        <LowDataState
          current={totalCompleted}
          required={10}
          unit="tasks"
          sectionName="Day-of-Week Patterns"
        />
      </section>
    );
  }

  if (!patterns || patterns.length === 0) {
    return (
      <section aria-label="Day-of-Week Patterns">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Day-of-Week Patterns
        </h3>
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No day-of-week pattern data available yet.
          </p>
        </div>
      </section>
    );
  }

  // Sort by dayIndex for Mon-Sun display (1=Mon through 0=Sun)
  const ordered = [...patterns].sort((a, b) => {
    const aIdx = a.dayIndex === 0 ? 7 : a.dayIndex;
    const bIdx = b.dayIndex === 0 ? 7 : b.dayIndex;
    return aIdx - bIdx;
  });

  const chartData = ordered.map((p) => ({
    label: p.dayName.slice(0, 3),
    value: p.tasksCompleted,
    highlight: false,
  }));

  // Find strongest and weakest days (by accuracy, only days with tasks)
  const withTasks = ordered.filter((p) => p.tasksCompleted > 0);
  let strongestDay: string | null = null;
  let weakestDay: string | null = null;

  if (withTasks.length >= 2) {
    const sorted = [...withTasks].sort(
      (a, b) => b.estimationAccuracy - a.estimationAccuracy,
    );
    strongestDay = sorted[0].dayName;
    weakestDay = sorted[sorted.length - 1].dayName;
  }

  return (
    <section aria-label="Day-of-Week Patterns">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Day-of-Week Patterns
      </h3>

      <BarChart
        data={chartData}
        ariaLabel="Bar chart showing tasks completed by day of week"
      />

      {/* Detail table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-border bg-dark-card/60">
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Day
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Tasks
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Avg Actual
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Accuracy
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((p) => {
              const isStrongest = p.dayName === strongestDay;
              const isWeakest = p.dayName === weakestDay;

              return (
                <tr
                  key={p.dayName}
                  className="border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40"
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {p.dayName}
                    {isStrongest && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        Best
                      </span>
                    )}
                    {isWeakest && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                        Weakest
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {p.tasksCompleted}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {formatMinutes(p.avgActualTime)}
                  </td>
                  <td
                    className={`px-4 py-3 font-medium ${
                      p.estimationAccuracy >= 80
                        ? "text-green-600 dark:text-green-400"
                        : p.estimationAccuracy < 50
                          ? "text-red-600 dark:text-red-400"
                          : "text-text-secondary"
                    }`}
                  >
                    {Math.round(p.estimationAccuracy)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
