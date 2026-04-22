import { useState } from "react";
import axios from "axios";
import type { AnalyzedTask } from "../types";

/** Shape returned by PATCH /api/tasks/:taskId/complete. */
interface CompletionResponse {
  taskId: string;
  completed: boolean;
  actualTime: number;
  unblockedTasks: { id: string; description: string }[];
}

export interface CompletionDialogProps {
  /** The task being completed. */
  task: AnalyzedTask;
  /** Called when the dialog should close without completing. */
  onCancel: () => void;
  /** Called after the task is successfully completed. */
  onComplete: (
    taskId: string,
    actualTime: number,
    unblockedTasks: { id: string; description: string }[],
  ) => void;
}

/**
 * Completion Dialog component.
 *
 * Prompts the user for the actual time spent when marking a task
 * complete. Submits to PATCH /api/tasks/:taskId/complete and
 * reports back the unblocked tasks.
 *
 * Requirements: 6.1, 8.1, 8.4
 */
export default function CompletionDialog({
  task,
  onCancel,
  onComplete,
}: CompletionDialogProps) {
  const [actualTime, setActualTime] = useState<string>(
    String(task.metrics.estimatedTime),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedTime = Number(actualTime);
  const isValid = !Number.isNaN(parsedTime) && parsedTime > 0;

  const handleSubmit = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await axios.patch<CompletionResponse>(
        `/api/tasks/${encodeURIComponent(task.id)}/complete`,
        { actualTime: parsedTime },
      );

      onComplete(task.id, parsedTime, response.data.unblockedTasks);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error as string);
      } else {
        setError("Failed to mark task as complete. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Complete task: ${task.description}`}
      data-testid="completion-dialog"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        zIndex: 1000,
      }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          maxWidth: "28rem",
          width: "90%",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Complete Task</h3>

        <p style={{ color: "#374151" }}>
          <strong>{task.description}</strong>
        </p>

        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
          Estimated time: {task.metrics.estimatedTime} min
        </p>

        <label
          htmlFor="actual-time-input"
          style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}
        >
          Actual time spent (minutes)
        </label>
        <input
          id="actual-time-input"
          type="number"
          min="1"
          step="1"
          value={actualTime}
          onChange={(e) => {
            setActualTime(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          disabled={submitting}
          aria-label="Actual time spent in minutes"
          data-testid="actual-time-input"
          autoFocus
          style={{
            width: "100%",
            padding: "0.5rem",
            fontSize: "1rem",
            borderRadius: "0.375rem",
            border: "1px solid #d1d5db",
            boxSizing: "border-box",
          }}
        />

        {error && (
          <p
            role="alert"
            aria-live="assertive"
            style={{ color: "#dc2626", fontSize: "0.875rem" }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1rem",
          }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            aria-label="Cancel"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #d1d5db",
              backgroundColor: "#ffffff",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            aria-label="Confirm completion"
            data-testid="confirm-complete-btn"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "none",
              backgroundColor: isValid ? "#3b82f6" : "#9ca3af",
              color: "#ffffff",
              fontWeight: 600,
              cursor: !isValid || submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Saving…" : "Mark Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}
