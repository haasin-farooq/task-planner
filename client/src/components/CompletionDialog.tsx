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
  /** Pre-filled tracked time from timer (minutes). If provided, used instead of estimated time. */
  trackedTimeMinutes?: number;
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
  trackedTimeMinutes,
}: CompletionDialogProps) {
  const [actualTime, setActualTime] = useState<string>(
    String(trackedTimeMinutes ?? task.metrics.estimatedTime),
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
      className="fixed inset-0 flex items-center justify-center bg-black/30 z-[1000]"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="bg-dark-card rounded-xl p-6 max-w-md w-[90%] shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-dark-border">
        <h3 className="mt-0 text-lg font-semibold text-text-primary">
          Complete Task
        </h3>

        <p className="text-text-primary">
          <strong>{task.description}</strong>
        </p>

        <p className="text-sm text-text-secondary">
          Estimated time: {task.metrics.estimatedTime} min
        </p>

        {trackedTimeMinutes !== undefined && (
          <p className="text-sm text-accent">
            ⏱ Timer tracked: {trackedTimeMinutes} min
          </p>
        )}

        <label
          htmlFor="actual-time-input"
          className="block mb-1 font-medium text-text-primary"
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
          className="w-full px-3 py-2 text-base rounded-md bg-dark-bg border border-dark-border text-text-primary placeholder-text-muted box-border focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />

        {error && (
          <p
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-500"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={submitting}
            aria-label="Cancel"
            className="px-4 py-2 rounded-md bg-dark-bg border border-dark-border text-text-secondary hover:bg-dark-hover transition-colors disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            aria-label="Confirm completion"
            data-testid="confirm-complete-btn"
            className={`px-4 py-2 rounded-md font-semibold text-white transition-colors ${
              isValid ? "bg-accent hover:bg-accent-dark" : "bg-gray-400"
            } ${submitting ? "opacity-60 cursor-not-allowed" : ""} disabled:cursor-not-allowed`}
          >
            {submitting ? "Saving…" : "Mark Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}
