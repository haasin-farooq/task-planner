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
      <section aria-label="Review parsed tasks">
        <h2>Review Your Tasks</h2>
        <p>Edit or remove tasks before confirming.</p>

        <ul role="list" aria-label="Parsed task list">
          {parsedTasks.map((task) => (
            <li key={task.id} data-testid={`task-${task.id}`}>
              {editingTaskId === task.id ? (
                <span
                  role="group"
                  aria-label={`Editing task: ${task.description}`}
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
                  />
                  <button
                    onClick={() => saveEdit(task.id)}
                    aria-label="Save edit"
                  >
                    Save
                  </button>
                  <button onClick={cancelEdit} aria-label="Cancel edit">
                    Cancel
                  </button>
                </span>
              ) : (
                <span role="group" aria-label={`Task: ${task.description}`}>
                  <span>{task.description}</span>
                  {task.isAmbiguous && (
                    <span
                      aria-label="Ambiguous task"
                      title="This task may need clarification"
                    >
                      {" ⚠️"}
                    </span>
                  )}
                  <button
                    onClick={() => startEditing(task)}
                    aria-label={`Edit task: ${task.description}`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeTask(task.id)}
                    aria-label={`Remove task: ${task.description}`}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>

        <div>
          <button onClick={handleBack}>Back</button>
          <button onClick={handleConfirm}>Confirm Tasks</button>
        </div>
      </section>
    );
  }

  // Input view — text area + submit
  return (
    <section aria-label="Task input">
      <h2>Enter Your Tasks</h2>
      <p>
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
      />

      {error && (
        <p role="alert" aria-live="assertive" style={{ color: "red" }}>
          {error}
        </p>
      )}

      <button onClick={handleSubmit} disabled={loading}>
        {loading ? "Parsing…" : "Parse Tasks"}
      </button>
    </section>
  );
}
