import type { ExtendedAnalyticsSummary } from "../../types";
import LowDataState from "./LowDataState";

export interface KPIPanelProps {
  kpis: ExtendedAnalyticsSummary["kpis"];
  insufficientData: boolean;
  totalCompleted: number;
}

/**
 * Mini progress ring rendered as inline SVG.
 * Displays a percentage value as a circular progress indicator.
 */
function MiniProgressRing({
  percent,
  size = 36,
  strokeWidth = 3,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/**
 * Trend arrow SVG — points up (positive) or down (negative).
 * Green for positive trends, red for negative.
 */
function TrendArrow({ direction }: { direction: "up" | "down" }) {
  const isUp = direction === "up";
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="inline-block ml-1"
    >
      {isUp ? (
        <path d="M8 3L13 9H3L8 3Z" fill="#16a34a" />
      ) : (
        <path d="M8 13L3 7H13L8 13Z" fill="#dc2626" />
      )}
    </svg>
  );
}

/** Format minutes to a readable string like "12 min" */
function formatMinutes(value: number): string {
  return `${Math.round(value)} min`;
}

/** Format a percentage value with % suffix */
function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

interface KPICardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | null;
  subtitle?: string;
}

function KPICard({ label, value, icon, trend, subtitle }: KPICardProps) {
  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-serif text-2xl font-semibold text-text-primary">
          {value}
        </span>
        {trend && <TrendArrow direction={trend} />}
      </div>
      {subtitle && (
        <span className="text-xs text-text-secondary">{subtitle}</span>
      )}
    </div>
  );
}

/**
 * KPI Panel — displays 6 key performance indicator cards in a responsive grid.
 *
 * Requirements: 2.1–2.7, 9.1, 9.2, 9.4, 10.2, 10.3, 10.4, 11.3
 */
export default function KPIPanel({
  kpis,
  insufficientData,
  totalCompleted,
}: KPIPanelProps) {
  const showLowData = totalCompleted < 5 || insufficientData;

  if (showLowData) {
    return (
      <section aria-label="Key Performance Indicators">
        <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
          Overview
        </h3>
        <LowDataState
          current={totalCompleted}
          required={5}
          unit="tasks"
          sectionName="KPI Overview"
        />
      </section>
    );
  }

  if (!kpis) {
    return null;
  }

  // Determine trend direction for estimation accuracy
  const accuracyTrend: "up" | "down" | null =
    kpis.estimationAccuracy >= 80
      ? "up"
      : kpis.estimationAccuracy < 50
        ? "down"
        : null;

  // Determine trend for avg actual vs estimated
  const timeTrend: "up" | "down" | null =
    kpis.avgActualTime <= kpis.avgEstimatedTime ? "up" : "down";

  return (
    <section aria-label="Key Performance Indicators">
      <h3 className="font-serif text-xl font-semibold text-text-primary mb-3">
        Overview
      </h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 p-5 rounded-lg border border-dark-border bg-dark-surface">
        {/* 2.1 — Total Completed */}
        <KPICard
          label="Completed"
          value={String(kpis.totalCompleted)}
          subtitle="tasks in period"
        />

        {/* 2.2 — Completion Rate */}
        <KPICard
          label="Completion Rate"
          value={formatPercent(kpis.completionRate)}
          icon={<MiniProgressRing percent={kpis.completionRate} />}
        />

        {/* 2.3 — Avg Estimated Time */}
        <KPICard
          label="Avg Estimated"
          value={formatMinutes(kpis.avgEstimatedTime)}
          subtitle="per task"
        />

        {/* 2.3 — Avg Actual Time */}
        <KPICard
          label="Avg Actual"
          value={formatMinutes(kpis.avgActualTime)}
          trend={timeTrend}
          subtitle="per task"
        />

        {/* 2.4 — Estimation Accuracy */}
        <KPICard
          label="Accuracy"
          value={formatPercent(kpis.estimationAccuracy)}
          icon={<MiniProgressRing percent={kpis.estimationAccuracy} />}
          trend={accuracyTrend}
        />

        {/* 2.5 & 2.6 — Top Improving / Most Delayed Category */}
        <KPICard
          label={
            kpis.topImprovingCategory
              ? "Top Improving"
              : kpis.mostDelayedCategory
                ? "Most Delayed"
                : "Category"
          }
          value={kpis.topImprovingCategory ?? kpis.mostDelayedCategory ?? "—"}
          trend={
            kpis.topImprovingCategory
              ? "up"
              : kpis.mostDelayedCategory
                ? "down"
                : null
          }
          subtitle={
            kpis.topImprovingCategory
              ? "improving accuracy"
              : kpis.mostDelayedCategory
                ? "highest overrun"
                : "not enough data"
          }
        />
      </div>
    </section>
  );
}
