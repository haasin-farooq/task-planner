import { useEffect } from "react";

export interface UnblockedNotificationProps {
  /** Tasks that were just unblocked. */
  unblockedTasks: { id: string; description: string }[];
  /** Called when the notification should be dismissed. */
  onDismiss: () => void;
  /** Auto-dismiss after this many milliseconds (default 5000). */
  autoDismissMs?: number;
}

/**
 * Unblocked Tasks Notification component.
 *
 * Displays a transient notification listing tasks that became
 * unblocked after a task completion. Auto-dismisses after a
 * configurable timeout.
 *
 * Requirements: 8.4
 */
export default function UnblockedNotification({
  unblockedTasks,
  onDismiss,
  autoDismissMs = 5000,
}: UnblockedNotificationProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [onDismiss, autoDismissMs]);

  if (unblockedTasks.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="unblocked-notification"
      className="fixed bottom-6 right-6 max-w-[22rem] p-4 bg-dark-card border border-accent-light rounded-xl shadow-lg shadow-black/25 z-[1001]"
    >
      <div className="flex justify-between items-start">
        <strong className="text-accent-light">
          🔓 {unblockedTasks.length} task
          {unblockedTasks.length !== 1 ? "s" : ""} unblocked
        </strong>
        <button
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="bg-transparent border-none cursor-pointer text-xl leading-none text-gray-400 p-0 hover:text-gray-200"
        >
          ×
        </button>
      </div>

      <ul
        role="list"
        aria-label="Unblocked tasks"
        className="mt-2 pl-5 text-sm text-gray-300"
      >
        {unblockedTasks.map((t) => (
          <li key={t.id}>{t.description}</li>
        ))}
      </ul>
    </div>
  );
}
