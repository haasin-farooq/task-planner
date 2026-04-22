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
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        maxWidth: "22rem",
        padding: "1rem",
        backgroundColor: "#eff6ff",
        border: "1px solid #3b82f6",
        borderRadius: "0.75rem",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        zIndex: 1001,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <strong style={{ color: "#1d4ed8" }}>
          🔓 {unblockedTasks.length} task
          {unblockedTasks.length !== 1 ? "s" : ""} unblocked
        </strong>
        <button
          onClick={onDismiss}
          aria-label="Dismiss notification"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "1.25rem",
            lineHeight: 1,
            color: "#6b7280",
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      <ul
        role="list"
        aria-label="Unblocked tasks"
        style={{
          margin: "0.5rem 0 0",
          paddingLeft: "1.25rem",
          fontSize: "0.875rem",
        }}
      >
        {unblockedTasks.map((t) => (
          <li key={t.id}>{t.description}</li>
        ))}
      </ul>
    </div>
  );
}
