import type { CategoryLearningStatus } from "../../types";
import LowDataState from "./LowDataState";

export interface AILearningProgressProps {
  learningProgress: CategoryLearningStatus[];
  totalCompleted: number;
}

/** Badge styles for maturity levels */
const MATURITY_STYLES: Record<CategoryLearningStatus["maturity"], string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  learning:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  ready: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

/** Badge styles for accuracy trend */
const TREND_STYLES: Record<
  CategoryLearningStatus["recentAccuracyTrend"],
  string
> = {
  improving:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  stable: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  declining: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  insufficient: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

/**
 * AI Learning Progress section — shows a table of categories with maturity,
 * personalization status, and accuracy trend badges.
 */
export default function AILearningProgress({
  learningProgress,
  totalCompleted,
}: AILearningProgressProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="AI Learning Progress">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          AI Learning Progress
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="AI Learning Progress"
        />
      </section>
    );
  }

  if (!learningProgress || learningProgress.length === 0) {
    return (
      <section aria-label="AI Learning Progress">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          AI Learning Progress
        </h3>
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No AI learning data available yet. Complete more tasks to see how
            the AI adapts to your patterns.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="AI Learning Progress">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        AI Learning Progress
      </h3>

      <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-surface">
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
                Sample Size
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Maturity
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Personalized
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Accuracy Trend
              </th>
            </tr>
          </thead>
          <tbody>
            {learningProgress.map((entry) => (
              <tr
                key={entry.category}
                className="border-b border-dark-border last:border-b-0 transition-colors hover:bg-dark-hover/40"
              >
                <td className="px-4 py-3 font-medium text-text-primary">
                  {entry.category}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {entry.sampleSize}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${MATURITY_STYLES[entry.maturity]}`}
                  >
                    {entry.maturity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {entry.hasPersonalization ? (
                    <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                      Yes
                    </span>
                  ) : (
                    <span className="text-text-secondary text-xs">No</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TREND_STYLES[entry.recentAccuracyTrend]}`}
                  >
                    {entry.recentAccuracyTrend}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
