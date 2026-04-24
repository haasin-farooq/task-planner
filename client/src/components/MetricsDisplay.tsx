import { useState } from "react";
import type { AnalyzedTask } from "../types";
import TaskCard from "./TaskCard";

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
 * Renders each analyzed task as a TaskCard with its AI-assigned metrics:
 * priority, effort percentage, dependency count, difficulty level,
 * and estimated time. Selecting a task with dependencies reveals
 * the full dependency list. Completed tasks are visually dimmed
 * with a strikethrough description.
 *
 * Requirements: 4.4, 6.3, 6.4, 8.3, 11.2
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
        <p className="text-text-secondary">No tasks to display.</p>
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
      {/* Parsed tasks header with Sort by dropdown integration — Req 6.3 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">
          Parsed tasks
        </h2>
        <span className="text-sm text-text-secondary">Sort by</span>
      </div>

      <ul
        role="list"
        aria-label="Analyzed task list"
        className="flex flex-col gap-3"
      >
        {tasks.map((task, idx) => {
          const isCompleted = completedTaskIds.has(task.id);
          const isSelected = selectedTaskId === task.id;
          const dependencyCount = task.metrics.dependsOn.length;

          return (
            <li
              key={task.id}
              data-testid={`metrics-task-${task.id}`}
              aria-current={isSelected ? "true" : undefined}
              className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                isSelected
                  ? "border-accent bg-dark-card shadow-sm"
                  : "border-dark-border bg-dark-card hover:border-gray-400"
              } ${isCompleted ? "opacity-50" : "opacity-100"}`}
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
              {/* Delegate rendering to TaskCard — Req 4.4 */}
              <TaskCard
                task={task}
                index={idx + 1}
                isCompleted={isCompleted}
                onMarkComplete={onTaskComplete}
                allTasks={tasks}
              />

              {/* Dependency detail list — preserved from original */}
              {isSelected && dependencyCount > 0 && (
                <div
                  className="mt-3 border-t border-dark-border pt-3 pl-9"
                  aria-label="Dependency list"
                >
                  <strong className="text-sm text-text-primary">
                    Depends on:
                  </strong>
                  <ul
                    role="list"
                    aria-label="Dependencies"
                    className="mt-1 flex flex-col gap-1"
                  >
                    {task.metrics.dependsOn.map((depId) => (
                      <li
                        key={depId}
                        data-testid={`dep-${task.id}-${depId}`}
                        className="text-sm text-text-secondary"
                      >
                        {taskDescriptionById.get(depId) ?? depId}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer note — Req 6.4 */}
      <p className="mt-4 text-center text-xs text-text-secondary">
        Tasks are AI-generated and may need review.
      </p>
    </section>
  );
}
