import type { AnalyzedTask } from "../types";
import { getProgressSegments } from "../utils/progress-segments";

export interface ProgressRingProps {
  tasks: AnalyzedTask[];
  completedTaskIds: Set<string>;
  inProgressTaskIds?: Set<string>;
}

const RADIUS = 40;
const STROKE_WIDTH = 8;
const SIZE = (RADIUS + STROKE_WIDTH) * 2;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * ProgressRing component.
 *
 * Renders an SVG donut chart showing task completion with segmented arcs
 * for Done, In Progress, Planned, and Remaining states. Includes a legend
 * with counts and a summary line.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 10.2
 */
export default function ProgressRing({
  tasks,
  completedTaskIds,
  inProgressTaskIds = new Set(),
}: ProgressRingProps) {
  const total = tasks.length;
  const completed = tasks.filter((t) => completedTaskIds.has(t.id)).length;
  const inProgress = tasks.filter((t) => inProgressTaskIds.has(t.id)).length;
  const planned = total - completed - inProgress;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) {
    return (
      <div
        className="flex flex-col items-center"
        data-testid="progress-ring-empty"
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label="No tasks to display"
          className="mb-3 max-w-full h-auto"
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="#3a3a5a"
            strokeWidth={STROKE_WIDTH}
          />
        </svg>
        <p className="text-sm text-gray-400">No tasks yet</p>
      </div>
    );
  }

  const segments = getProgressSegments(
    total,
    completed,
    inProgress,
    CIRCUMFERENCE,
  );

  return (
    <div className="flex flex-col items-center">
      {/* SVG donut chart */}
      <div className="relative mb-4">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${percent}% of tasks completed`}
          className="rotate-[-90deg] max-w-full h-auto"
        >
          {/* Background track */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="#3a3a5a"
            strokeWidth={STROKE_WIDTH}
          />
          {/* Segment arcs */}
          {segments.map((segment) => (
            <circle
              key={segment.label}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={STROKE_WIDTH}
              strokeDasharray={`${segment.dashLength} ${CIRCUMFERENCE - segment.dashLength}`}
              strokeDashoffset={segment.dashOffset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {/* Centered percentage text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-2xl font-bold text-white"
            data-testid="progress-percent"
          >
            {percent}%
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mb-3">
        {[
          { label: "Done", count: completed, color: "bg-green-500" },
          { label: "In Progress", count: inProgress, color: "bg-orange-500" },
          { label: "Planned", count: planned, color: "bg-accent" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-1.5 text-xs text-gray-300"
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${item.color}`}
            />
            <span>
              {item.label} ({item.count})
            </span>
          </div>
        ))}
      </div>

      {/* Summary line */}
      <p className="text-sm text-gray-400" data-testid="progress-summary">
        {completed} of {total} tasks completed
      </p>
    </div>
  );
}
