import { useState } from "react";
import axios from "axios";
import type { ParsedTask } from "../types";

/**
 * Response shape from POST /api/tasks/parse.
 */
interface ParseResult {
  tasks: ParsedTask[];
  ambiguousItems: ParsedTask[];
  errors: string[];
}

export interface TaskInputProps {
  /**
   * Called when the user confirms the parsed task list.
   * The parent component can then proceed to the analysis step.
   */
  onConfirm: (tasks: ParsedTask[]) => void;
}

/**
 * Task Input UI component.
 *
 * Provides a text area for raw task input, submits to the parse API,
 * displays the parsed task list for review, and lets the user confirm
 * or edit before proceeding.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export default function TaskInput({ onConfirm }: TaskInputProps) {
  const [rawText, setRawText] = useState("");
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[] | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------------------
  // Submit raw text to the parse API (Req 1.1)
  // -------------------------------------------------------------------

  const handleSubmit = async () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setError("Please enter at least one task.");
      return;
    }

    setError(null);
    setLoading(true);
    setParsedTasks(null);

    try {
      const response = await axios.post<ParseResult>("/api/tasks/parse", {
        rawText: trimmed,
      });

      const result = response.data;

      // Req 1.3 — show error when no tasks detected
      if (result.tasks.length === 0 && result.errors.length > 0) {
        setError(result.errors.join(" "));
        return;
      }

      if (result.tasks.length === 0) {
        setError("No tasks detected. Please enter at least one task.");
        return;
      }

      // Req 1.4 — present parsed list for review
      setParsedTasks(result.tasks);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error as string);
      } else {
        setError(
          "Something went wrong while parsing your tasks. Please try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Inline editing helpers (Req 1.4 — edit capability)
  // -------------------------------------------------------------------

  const startEditing = (task: ParsedTask) => {
    setEditingTaskId(task.id);
    setEditValue(task.description);
  };

  const saveEdit = (taskId: string) => {
    if (!parsedTasks) return;

    const trimmed = editValue.trim();
    if (!trimmed) return; // don't allow blank descriptions

    setParsedTasks(
      parsedTasks.map((t) =>
        t.id === taskId ? { ...t, description: trimmed } : t,
      ),
    );
    setEditingTaskId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setEditValue("");
  };

  const removeTask = (taskId: string) => {
    if (!parsedTasks) return;
    const updated = parsedTasks.filter((t) => t.id !== taskId);
    if (updated.length === 0) {
      setParsedTasks(null);
      setError("All tasks removed. Please enter new tasks.");
    } else {
      setParsedTasks(updated);
    }
  };

  // -------------------------------------------------------------------
  // Confirm reviewed list (Req 1.4)
  // -------------------------------------------------------------------

  const handleConfirm = () => {
    if (parsedTasks && parsedTasks.length > 0) {
      onConfirm(parsedTasks);
    }
  };

  // -------------------------------------------------------------------
  // Reset to input view
  // -------------------------------------------------------------------

  const handleBack = () => {
    setParsedTasks(null);
    setError(null);
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  // Review view — show parsed tasks for confirmation / editing
  if (parsedTasks) {
    return (
      <section
        aria-label="Review parsed tasks"
        className="rounded-xl bg-dark-card border border-dark-border p-6"
      >
        <h2 className="text-lg font-semibold text-white mb-1">
          Review Your Tasks
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Edit or remove tasks before confirming.
        </p>

        <ul role="list" aria-label="Parsed task list" className="space-y-2">
          {parsedTasks.map((task) => (
            <li
              key={task.id}
              data-testid={`task-${task.id}`}
              className="flex items-center gap-2 rounded-lg bg-dark-surface px-4 py-3 border border-dark-border"
            >
              {editingTaskId === task.id ? (
                <span
                  role="group"
                  aria-label={`Editing task: ${task.description}`}
                  className="flex items-center gap-2 w-full"
                >
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(task.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    aria-label="Edit task description"
                    autoFocus
                    className="flex-1 rounded-md bg-dark-bg border border-dark-border px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    onClick={() => saveEdit(task.id)}
                    aria-label="Save edit"
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-light transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    aria-label="Cancel edit"
                    className="rounded-md bg-dark-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span
                  role="group"
                  aria-label={`Task: ${task.description}`}
                  className="flex items-center gap-2 w-full"
                >
                  <span className="flex-1 text-sm text-gray-200">
                    {task.description}
                  </span>
                  {task.isAmbiguous && (
                    <span
                      aria-label="Ambiguous task"
                      title="This task may need clarification"
                      className="text-yellow-400"
                    >
                      {" ⚠️"}
                    </span>
                  )}
                  <button
                    onClick={() => startEditing(task)}
                    aria-label={`Edit task: ${task.description}`}
                    className="rounded-md px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-dark-border transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeTask(task.id)}
                    aria-label={`Remove task: ${task.description}`}
                    className="rounded-md px-2 py-1 text-xs text-gray-400 hover:text-red-400 hover:bg-dark-border transition-colors"
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleBack}
            className="rounded-lg bg-dark-surface border border-dark-border px-4 py-2 text-sm font-medium text-gray-300 hover:bg-dark-border transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
          >
            Confirm Tasks
          </button>
        </div>
      </section>
    );
  }

  // Input view — text area + submit
  return (
    <section
      aria-label="Task input"
      className="rounded-xl bg-dark-card border border-dark-border p-6"
    >
      {/* Card header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Enter your tasks</h2>
      </div>

      <p className="text-sm text-gray-400 mb-3">
        Paste or type your tasks for the day. They can be rough and
        unstructured.
      </p>

      <textarea
        value={rawText}
        onChange={(e) => {
          setRawText(e.target.value);
          if (error) setError(null);
        }}
        placeholder={
          "e.g.\nFinish the report\nReview pull requests\nPrepare slides for the meeting"
        }
        rows={6}
        aria-label="Raw task input"
        disabled={loading}
        className="w-full rounded-lg bg-dark-bg border border-dark-border px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      />

      {/* Helper text */}
      <div className="flex items-center justify-between mt-2 mb-4">
        <span className="text-xs text-gray-500">One task per line</span>
        <span className="text-xs text-gray-500">
          Press Cmd + Enter to analyze
        </span>
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm text-red-400 mb-3"
        >
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Parsing…" : "Parse Tasks"}
      </button>
    </section>
  );
}
