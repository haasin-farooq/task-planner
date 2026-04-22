import type { AnalyzedTask } from "../types";

export interface UpcomingCardProps {
  tasks: AnalyzedTask[];
  completedTaskIds: Set<string>;
}

/**
 * Placeholder times assigned to upcoming tasks for display purposes.
 * These simulate a scheduled calendar view.
 */
const PLACEHOLDER_TIMES = ["9:00 AM", "10:30 AM", "2:00 PM", "3:30 PM"];

/**
 * UpcomingCard component.
 *
 * Lists the next few incomplete tasks with placeholder scheduled times,
 * a "View all" link in the header, and an "+ Add to calendar" action button.
 *
 * Requirements: 7.6, 7.7
 */
export default function UpcomingCard({
  tasks,
  completedTaskIds,
}: UpcomingCardProps) {
  const upcoming = tasks.filter((t) => !completedTaskIds.has(t.id)).slice(0, 4);

  return (
    <div className="rounded-lg bg-dark-card p-4">
      {/* Header with title and "View all" link */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Upcoming</h3>
        <a
          href="#"
          className="text-xs text-accent-light hover:text-accent transition-colors"
          onClick={(e) => e.preventDefault()}
        >
          View all
        </a>
      </div>

      {upcoming.length === 0 ? (
        <p className="text-sm text-gray-400">All tasks completed!</p>
      ) : (
        <>
          {/* Task list with placeholder times */}
          <ul className="space-y-3 mb-4">
            {upcoming.map((task, index) => (
              <li key={task.id} className="flex items-start gap-3">
                <span className="text-xs text-gray-500 mt-0.5 w-16 shrink-0">
                  {PLACEHOLDER_TIMES[index] ?? PLACEHOLDER_TIMES[0]}
                </span>
                <span className="text-sm text-gray-300 leading-snug line-clamp-1">
                  {task.description}
                </span>
              </li>
            ))}
          </ul>

          {/* Add to calendar button */}
          <button
            type="button"
            className="w-full rounded-md border border-dark-border py-1.5 text-xs text-gray-300 hover:bg-dark-surface hover:text-white transition-colors"
          >
            + Add to calendar
          </button>
        </>
      )}
    </div>
  );
}
