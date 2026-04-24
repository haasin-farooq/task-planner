import type { AnalyzedTask } from "../types";
import ProgressRing from "./ProgressRing";
import TodayFocusCard from "./TodayFocusCard";
import UpcomingCard from "./UpcomingCard";

export interface RightSidebarProps {
  tasks: AnalyzedTask[];
  completedTaskIds: Set<string>;
  inProgressTaskIds?: Set<string>;
}

/**
 * RightSidebar component.
 *
 * Container for TodayFocusCard, ProgressRing, and UpcomingCard widgets.
 * Shows empty-state placeholders when no tasks are loaded.
 *
 * Requirements: 7.8
 */
export default function RightSidebar({
  tasks,
  completedTaskIds,
  inProgressTaskIds,
}: RightSidebarProps) {
  const hasTasks = tasks.length > 0;

  return (
    <aside
      className="w-full lg:w-[300px] shrink-0 bg-dark-surface lg:h-screen lg:overflow-y-auto p-4 flex flex-col gap-4"
      aria-label="Contextual widgets"
    >
      {/* Today's Focus */}
      {hasTasks ? (
        <TodayFocusCard />
      ) : (
        <div className="rounded-lg bg-dark-card border border-dark-border p-4 text-center">
          <p className="text-sm text-text-secondary">
            No focus items yet. Analyze tasks to get started.
          </p>
        </div>
      )}

      {/* Progress Ring */}
      <div className="rounded-lg bg-dark-card border border-dark-border p-4">
        {hasTasks ? (
          <ProgressRing
            tasks={tasks}
            completedTaskIds={completedTaskIds}
            inProgressTaskIds={inProgressTaskIds}
          />
        ) : (
          <div className="flex flex-col items-center py-4">
            <div className="h-24 w-24 rounded-full border-4 border-dark-border mb-3" />
            <p className="text-sm text-text-secondary">No progress to show</p>
          </div>
        )}
      </div>

      {/* Upcoming Tasks */}
      {hasTasks ? (
        <UpcomingCard tasks={tasks} completedTaskIds={completedTaskIds} />
      ) : (
        <div className="rounded-lg bg-dark-card border border-dark-border p-4 text-center">
          <p className="text-sm text-text-secondary">
            No upcoming tasks. Add tasks to see your schedule.
          </p>
        </div>
      )}
    </aside>
  );
}
