import type { CategorySpeedInsight } from "../../types";
import LowDataState from "./LowDataState";

export interface SpeedInsightsProps {
  speedInsights: {
    fastest: CategorySpeedInsight[];
    slowest: CategorySpeedInsight[];
    quickWins: CategorySpeedInsight[];
    consistentOverruns: CategorySpeedInsight[];
  };
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

/** Ratio indicator with color coding */
function RatioIndicator({ ratio }: { ratio: number }) {
  const display = ratio.toFixed(2);
  let colorClass = "text-text-secondary";
  if (ratio < 0.8) colorClass = "text-green-600 dark:text-green-400";
  else if (ratio > 1.2) colorClass = "text-red-600 dark:text-red-400";

  return (
    <span className={`text-xs font-medium ${colorClass}`}>{display}x</span>
  );
}

interface SpeedSectionProps {
  title: string;
  items: CategorySpeedInsight[];
  accentColor: string;
  emptyText: string;
}

function SpeedSection({
  title,
  items,
  accentColor,
  emptyText,
}: SpeedSectionProps) {
  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4">
      <h4 className={`text-sm font-semibold mb-2 ${accentColor}`}>{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-text-secondary">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((item) => (
            <li
              key={item.category}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-sm text-text-primary truncate">
                {item.category}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-text-secondary">
                  {formatMinutes(item.avgActualTime)}
                </span>
                <RatioIndicator ratio={item.avgRatio} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Speed Insights section — shows 4 quadrants: Fastest, Slowest,
 * Quick Wins (ratio < 0.8), and Consistent Overruns (ratio > 1.2).
 */
export default function SpeedInsights({
  speedInsights,
  totalCompleted,
}: SpeedInsightsProps) {
  if (totalCompleted < 5) {
    return (
      <section aria-label="Speed Insights">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Speed Insights
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="Speed Insights"
        />
      </section>
    );
  }

  if (!speedInsights) {
    return null;
  }

  return (
    <section aria-label="Speed Insights">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Speed Insights
      </h3>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SpeedSection
          title="Fastest Categories"
          items={speedInsights.fastest}
          accentColor="text-green-700 dark:text-green-400"
          emptyText="No data yet"
        />
        <SpeedSection
          title="Slowest Categories"
          items={speedInsights.slowest}
          accentColor="text-red-700 dark:text-red-400"
          emptyText="No data yet"
        />
        <SpeedSection
          title="Quick Wins (ratio < 0.8)"
          items={speedInsights.quickWins}
          accentColor="text-blue-700 dark:text-blue-400"
          emptyText="No quick wins detected"
        />
        <SpeedSection
          title="Consistent Overruns (ratio > 1.2)"
          items={speedInsights.consistentOverruns}
          accentColor="text-amber-700 dark:text-amber-400"
          emptyText="No consistent overruns"
        />
      </div>
    </section>
  );
}
