import type { AnalyzedTask } from "../types";
import PriorityBadge from "./PriorityBadge";
import CategoryBadge from "./CategoryBadge";
import EffortIndicator from "./EffortIndicator";
import DifficultyRating from "./DifficultyRating";
import OverflowMenu from "./OverflowMenu";
import { formatDuration } from "../utils/format-duration";

export interface TaskCardProps {
  task: AnalyzedTask;
  /** 1-based display index */
  index: number;
  isCompleted: boolean;
  onMarkComplete?: (taskId: string) => void;
  /** All tasks in the session, used for dependency label lookup */
  allTasks: AnalyzedTask[];
}

/**
 * Task card component that displays a single analyzed task with visual
 * metric indicators: priority badge, effort ring, difficulty dots,
 * estimated time, and dependencies.
 *
 * Composes PriorityBadge, EffortIndicator, DifficultyRating,
 * OverflowMenu, and formatDuration.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
 */
export default function TaskCard({
  task,
  index,
  isCompleted,
  onMarkComplete,
  allTasks,
}: TaskCardProps) {
  const { metrics } = task;
  const hasDependencies = metrics.dependsOn.length > 0;

  /** Map dependency IDs to their task descriptions for display. */
  const taskDescriptionById = new Map(
    allTasks.map((t) => [t.id, t.description]),
  );

  /** Determine status dot color: green = completed, gray = planned (default). */
  const statusDotColor = isCompleted ? "bg-green-500" : "bg-gray-400";

  return (
    <div
      data-testid={`task-card-${task.id}`}
      className={`rounded-lg border border-dark-border bg-dark-card p-4 ${
        isCompleted ? "opacity-50" : ""
      }`}
    >
      {/* Top row: index, status dot, title, overflow menu */}
      <div className="flex items-start gap-3">
        {/* Numbered index */}
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dark-bg text-xs font-semibold text-text-secondary">
          {index}
        </span>

        {/* Status dot */}
        <span
          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotColor}`}
          aria-label={isCompleted ? "Completed" : "Planned"}
        />

        {/* Title and description */}
        <div className="min-w-0 flex-1">
          <h3
            className={`text-sm font-semibold text-text-primary ${
              isCompleted ? "line-through" : ""
            }`}
          >
            {task.description}
          </h3>
          {task.rawText !== task.description && (
            <p className="mt-0.5 text-xs text-text-secondary">{task.rawText}</p>
          )}
        </div>

        {/* Overflow menu */}
        <div className="shrink-0">
          <OverflowMenu taskId={task.id} onMarkComplete={onMarkComplete} />
        </div>
      </div>

      {/* Metrics row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-9 text-sm text-text-secondary">
        {/* Priority badge — Req 5.4 */}
        <PriorityBadge priority={metrics.priority} />

        {/* Category badge — Req 11.1, 11.4, 11.5 */}
        {task.category && <CategoryBadge categoryName={task.category} />}

        {/* Effort indicator — Req 5.5 */}
        <EffortIndicator effortPercentage={metrics.effortPercentage} />

        {/* Difficulty rating — Req 5.6 */}
        <DifficultyRating level={metrics.difficultyLevel} />

        {/* Estimated time with clock icon — Req 5.7 */}
        <span className="inline-flex items-center gap-1">
          <svg
            className="h-4 w-4 text-text-secondary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span>{formatDuration(metrics.estimatedTime)}</span>
        </span>
      </div>

      {/* Dependencies row — Req 5.8 */}
      <div className="mt-2 flex items-start gap-1 pl-9 text-sm text-text-secondary">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {hasDependencies ? (
          <span className="flex flex-wrap gap-1">
            {metrics.dependsOn.map((depId) => (
              <span
                key={depId}
                data-testid="dependency-item"
                className="rounded bg-dark-bg px-1.5 py-0.5 text-xs text-text-secondary"
              >
                {taskDescriptionById.get(depId) ?? depId}
              </span>
            ))}
          </span>
        ) : (
          <span data-testid="dependency-item">None</span>
        )}
      </div>
    </div>
  );
}
