import type { AnomalyEntry } from "../../types";
import LowDataState from "./LowDataState";

export interface AnomaliesPanelProps {
  anomalies: AnomalyEntry[];
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

/** Anomaly type labels */
const TYPE_LABELS: Record<AnomalyEntry["type"], string> = {
  "slow-task": "Slow Task",
  "category-spike": "Category Spike",
  "unusual-duration": "Unusual Duration",
};

/**
 * Anomalies Panel — shows a list of anomalous tasks sorted by deviation.
 * Uses warning-colored styling.
 */
export default function AnomaliesPanel({
  anomalies,
  totalCompleted,
}: AnomaliesPanelProps) {
  if (totalCompleted < 10) {
    return (
      <section aria-label="Anomalies">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Anomalies
        </h3>
        <LowDataState
          current={totalCompleted}
          required={10}
          unit="tasks"
          sectionName="Anomalies"
        />
      </section>
    );
  }

  if (!anomalies || anomalies.length === 0) {
    return (
      <section aria-label="Anomalies">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Anomalies
        </h3>
        <div className="rounded-lg border border-dark-border p-6 text-center bg-dark-surface">
          <p className="text-sm text-text-secondary">
            No anomalies detected. Your task patterns look consistent.
          </p>
        </div>
      </section>
    );
  }

  const sorted = [...anomalies].sort(
    (a, b) => Math.abs(b.deviationPercent) - Math.abs(a.deviationPercent),
  );

  return (
    <section aria-label="Anomalies">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Anomalies
      </h3>

      <div className="space-y-2">
        {sorted.map((anomaly, i) => (
          <div
            key={`${anomaly.type}-${anomaly.description}-${i}`}
            className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {TYPE_LABELS[anomaly.type]}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-dark-surface px-2 py-0.5 text-xs font-medium text-text-secondary border border-dark-border">
                    {anomaly.category}
                  </span>
                </div>
                <p className="text-sm text-text-primary">
                  {anomaly.description}
                </p>
                <div className="mt-1 flex items-center gap-4 text-xs text-text-secondary">
                  <span>Actual: {formatMinutes(anomaly.actualTime)}</span>
                  <span>Expected: {formatMinutes(anomaly.expectedTime)}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                  {anomaly.deviationPercent > 0 ? "+" : ""}
                  {Math.round(anomaly.deviationPercent)}%
                </span>
                <p className="text-xs text-text-secondary">deviation</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
