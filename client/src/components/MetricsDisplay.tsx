import { useState } from "react";
import type { AnalyzedTask } from "../types";

export interface MetricsDisplayProps {
  /** Analyzed tasks to display with their metrics. */
  tasks: AnalyzedTask[];
  /** Set of task IDs that have been completed. */
  completedTaskIds: Set<string>;
  /** Called when the user marks a task as complete. */
  onTaskComplete?: (taskId: string) => void;
}

/**
 * Metrics Display component.
 *
 * Renders each analyzed task with its AI-assigned metrics:
 * priority, effort percentage, dependency count, difficulty level,
 * and estimated time. Selecting a task with dependencies reveals
 * the full dependency list. Completed tasks are visually dimmed
 * with a strikethrough description.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1
 */
export default function MetricsDisplay({
  tasks,
  completedTaskIds,
  onTaskComplete,
}: MetricsDisplayProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  if (tasks.length === 0) {
    return (
      <section aria-label="Task metrics">
        <p>No tasks to display.</p>
      </section>
    );
  }

  /** Build a lookup from task ID → description for dependency labels. */
  const taskDescriptionById = new Map(tasks.map((t) => [t.id, t.description]));

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  return (
    <section aria-label="Task metrics">
      <h2>Your Tasks</h2>

      <ul role="list" aria-label="Analyzed task list">
        {tasks.map((task) => {
          const isCompleted = completedTaskIds.has(task.id);
          const isSelected = selectedTaskId === task.id;
          const dependencyCount = task.metrics.dependsOn.length;

          return (
            <li
              key={task.id}
              data-testid={`metrics-task-${task.id}`}
              aria-current={isSelected ? "true" : undefined}
              style={{
                opacity: isCompleted ? 0.5 : 1,
                cursor: "pointer",
                padding: "0.75rem",
                marginBottom: "0.5rem",
                border: isSelected ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                borderRadius: "0.5rem",
              }}
              onClick={() => handleTaskClick(task.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleTaskClick(task.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-expanded={dependencyCount > 0 ? isSelected : undefined}
              aria-label={`Task: ${task.description}${isCompleted ? " (completed)" : ""}`}
            >
              {/* Task description — Req 8.1: strikethrough for completed */}
              <div
                style={{
                  textDecoration: isCompleted ? "line-through" : "none",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                }}
              >
                {task.description}
                {isCompleted && (
                  <span aria-label="Completed" style={{ marginLeft: "0.5rem" }}>
                    ✓
                  </span>
                )}
              </div>

              {/* Metrics row — Req 3.1, 3.2, 3.3, 3.4, 3.5 */}
              <div
                role="group"
                aria-label={`Metrics for ${task.description}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1rem",
                  fontSize: "0.875rem",
                }}
              >
                <span data-testid={`priority-${task.id}`}>
                  <strong>Priority:</strong> {task.metrics.priority}
                </span>
                <span data-testid={`effort-${task.id}`}>
                  <strong>Effort:</strong>{" "}
                  {task.metrics.effortPercentage.toFixed(1)}%
                </span>
                <span data-testid={`dependencies-${task.id}`}>
                  <strong>Dependencies:</strong> {dependencyCount}
                </span>
                <span data-testid={`difficulty-${task.id}`}>
                  <strong>Difficulty:</strong> {task.metrics.difficultyLevel}
                </span>
                <span data-testid={`estimated-time-${task.id}`}>
                  <strong>Est. Time:</strong> {task.metrics.estimatedTime} min
                </span>
              </div>

              {/* Dependency detail list — Req 3.6 */}
              {isSelected && dependencyCount > 0 && (
                <div
                  style={{ marginTop: "0.5rem", paddingLeft: "1rem" }}
                  aria-label="Dependency list"
                >
                  <strong>Depends on:</strong>
                  <ul role="list" aria-label="Dependencies">
                    {task.metrics.dependsOn.map((depId) => (
                      <li key={depId} data-testid={`dep-${task.id}-${depId}`}>
                        {taskDescriptionById.get(depId) ?? depId}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Complete button */}
              {!isCompleted && onTaskComplete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTaskComplete(task.id);
                  }}
                  style={{ marginTop: "0.5rem" }}
                  aria-label={`Mark "${task.description}" as complete`}
                >
                  Mark Complete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
