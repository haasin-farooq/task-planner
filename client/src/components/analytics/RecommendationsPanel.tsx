import type { Recommendation } from "../../types";
import LowDataState from "./LowDataState";

export interface RecommendationsPanelProps {
  recommendations: Recommendation[];
  totalCompleted: number;
}

/** Priority badge styles */
const PRIORITY_STYLES: Record<Recommendation["priority"], string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

/** Type icon config */
const TYPE_ICONS: Record<Recommendation["type"], string> = {
  buffer: "⏱",
  improvement: "📈",
  overestimation: "📉",
  consistency: "🎯",
  learning: "🧠",
};

/**
 * Recommendations Panel — shows a list of actionable recommendation cards
 * sorted by priority.
 */
export default function RecommendationsPanel({
  recommendations,
  totalCompleted,
}: RecommendationsPanelProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="Recommendations">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Recommendations
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="Recommendations"
        />
      </section>
    );
  }

  if (!recommendations || recommendations.length === 0) {
    return (
      <section aria-label="Recommendations">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Recommendations
        </h3>
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No recommendations yet. Keep completing tasks and patterns will
            emerge.
          </p>
        </div>
      </section>
    );
  }

  const priorityOrder: Record<Recommendation["priority"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const sorted = [...recommendations].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return (
    <section aria-label="Recommendations">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Recommendations
      </h3>

      <div className="space-y-2">
        {sorted.map((rec) => (
          <div
            key={rec.id}
            className="rounded-lg border border-dark-border bg-dark-card p-4"
          >
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0" aria-hidden="true">
                {TYPE_ICONS[rec.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[rec.priority]}`}
                  >
                    {rec.priority}
                  </span>
                  {rec.category && (
                    <span className="inline-flex items-center rounded-full bg-dark-surface px-2 py-0.5 text-xs font-medium text-text-secondary border border-dark-border">
                      {rec.category}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary leading-relaxed">
                  {rec.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
