import type { BehavioralInsight } from "../../types";
import LowDataState from "./LowDataState";

export interface InsightsPanelProps {
  insights: BehavioralInsight[];
  totalCompleted: number;
}

/** Visual config per insight type: icon path, accent color */
const INSIGHT_TYPE_CONFIG: Record<
  BehavioralInsight["type"],
  { label: string; color: string; iconPath: string }
> = {
  underestimation: {
    label: "Underestimation",
    color: "#dc2626",
    iconPath:
      "M12 9v4m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99L13.74 4a2 2 0 00-3.48 0L3.33 16.01A2 2 0 005.07 19z",
  },
  "speed-improvement": {
    label: "Speed Improvement",
    color: "#16a34a",
    iconPath: "M13 7l5 5m0 0l-5 5m5-5H6",
  },
  "accuracy-improvement": {
    label: "Accuracy Improvement",
    color: "#E8734A",
    iconPath: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
};

function InsightIcon({ type }: { type: BehavioralInsight["type"] }) {
  const config = INSIGHT_TYPE_CONFIG[type];
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={config.iconPath}
        stroke={config.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InsightCard({ insight }: { insight: BehavioralInsight }) {
  const config = INSIGHT_TYPE_CONFIG[insight.type];

  return (
    <li className="rounded-lg border border-[#E8E4DF] bg-white p-4">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${config.color}15` }}
        >
          <InsightIcon type={insight.type} />
        </div>
        <div className="min-w-0">
          <span
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: config.color }}
          >
            {config.label}
          </span>
          <p className="mt-1 text-sm text-[#1A1A1A] leading-relaxed">
            {insight.text}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * Insights Panel — displays up to 5 natural language behavioral insight cards.
 *
 * Shows a low-data state when totalCompleted < 10.
 * Uses warm editorial design with cream backgrounds and orange accents.
 *
 * Requirements: 5.5, 5.6, 9.1
 */
export default function InsightsPanel({
  insights,
  totalCompleted,
}: InsightsPanelProps) {
  if (totalCompleted < 10) {
    return (
      <section aria-label="Behavioral Insights">
        <h3 className="font-serif text-xl font-semibold text-[#1A1A1A] mb-3">
          Behavioral Insights
        </h3>
        <LowDataState
          current={totalCompleted}
          required={10}
          unit="tasks"
          sectionName="Behavioral Insights"
        />
      </section>
    );
  }

  const displayedInsights = insights.slice(0, 5);

  if (displayedInsights.length === 0) {
    return (
      <section aria-label="Behavioral Insights">
        <h3 className="font-serif text-xl font-semibold text-[#1A1A1A] mb-3">
          Behavioral Insights
        </h3>
        <div
          className="rounded-lg border border-[#E8E4DF] p-6 text-center"
          style={{ backgroundColor: "#FFF8F0" }}
        >
          <p className="text-sm text-[#6B6B6B]">
            No patterns detected yet. Keep completing tasks and insights will
            appear as trends emerge.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Behavioral Insights">
      <h3 className="font-serif text-xl font-semibold text-[#1A1A1A] mb-3">
        Behavioral Insights
      </h3>
      <ul
        className="flex flex-col gap-3 rounded-lg p-5 border border-[#E8E4DF]"
        style={{ backgroundColor: "#FFF8F0" }}
      >
        {displayedInsights.map((insight, index) => (
          <InsightCard
            key={`${insight.type}-${insight.category}-${index}`}
            insight={insight}
          />
        ))}
      </ul>
    </section>
  );
}
