import type { WeeklyTrendPoint } from "../../types";
import TrendChart from "./TrendChart";
import LowDataState from "./LowDataState";

export interface EstimationAccuracyProps {
  weeklyAccuracy: WeeklyTrendPoint[];
  trendLabel: "Improving" | "Stable" | "Declining";
  weeksOfData: number;
}

/** Color map for the trend label badge. */
const TREND_BADGE_STYLES: Record<
  EstimationAccuracyProps["trendLabel"],
  string
> = {
  Improving: "bg-green-100 text-green-800",
  Stable: "bg-gray-100 text-gray-700",
  Declining: "bg-red-100 text-red-800",
};

/**
 * Estimation Accuracy section. Renders two trend charts — weekly accuracy %
 * and weekly error % — plus a trend label badge indicating whether accuracy
 * is improving, stable, or declining.
 *
 * Displays a low-data state when fewer than 2 weeks of data are available.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 11.1
 */
export default function EstimationAccuracy({
  weeklyAccuracy,
  trendLabel,
  weeksOfData,
}: EstimationAccuracyProps) {
  if (weeksOfData < 2) {
    return (
      <section aria-label="Estimation Accuracy">
        <h2 className="mb-4 font-serif text-xl font-semibold text-gray-800">
          Estimation Accuracy
        </h2>
        <LowDataState
          current={weeksOfData}
          required={2}
          unit="weeks"
          sectionName="Estimation Accuracy"
        />
      </section>
    );
  }

  const accuracyData = weeklyAccuracy.map((point) => ({
    label: point.weekStart,
    value: Math.round(point.estimationAccuracy * 100),
  }));

  const errorData = weeklyAccuracy.map((point) => ({
    label: point.weekStart,
    value: Math.round(point.avgAbsolutePercentError),
  }));

  return (
    <section aria-label="Estimation Accuracy">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-serif text-xl font-semibold text-gray-800">
          Estimation Accuracy
        </h2>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TREND_BADGE_STYLES[trendLabel]}`}
        >
          {trendLabel}
        </span>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-600">
            Weekly Accuracy %
          </h3>
          <TrendChart
            data={accuracyData}
            ariaLabel="Trend chart showing weekly estimation accuracy percentage over the last 8 weeks"
            valueLabel="Accuracy"
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-600">
            Weekly Error %
          </h3>
          <TrendChart
            data={errorData}
            ariaLabel="Trend chart showing weekly average absolute percentage error over the last 8 weeks"
            valueLabel="Error"
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </div>
      </div>
    </section>
  );
}
