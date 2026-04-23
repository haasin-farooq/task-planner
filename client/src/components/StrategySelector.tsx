import { useEffect, useState } from "react";
import axios from "axios";
import type { AnalyzedTask, PrioritizationStrategy } from "../types";
import { orderTasks } from "../utils/task-organizer";

const STRATEGIES: { value: PrioritizationStrategy; label: string }[] = [
  { value: "highest-priority-first", label: "Highest Priority First" },
  { value: "least-effort-first", label: "Least Effort First" },
  { value: "hardest-first", label: "Hardest First" },
  { value: "dependency-aware", label: "Dependency-Aware" },
];

export interface StrategySelectorProps {
  /** Current user ID for preference persistence. */
  userId: string;
  /** The current unordered (or previously ordered) task list. */
  tasks: AnalyzedTask[];
  /** Called with the re-sorted task list whenever the strategy changes. */
  onTasksReordered: (
    sortedTasks: AnalyzedTask[],
    strategy: PrioritizationStrategy,
  ) => void;
}

/**
 * Strategy Selector component.
 *
 * Renders a button group for the 4 prioritization strategies.
 * Loads the user's saved preference on mount and applies it.
 * On strategy change, persists the preference and re-sorts the
 * task list client-side using the TaskOrganizer.
 *
 * Requirements: 4.1, 4.7, 5.1, 5.2, 5.3, 5.4
 */
export default function StrategySelector({
  userId,
  tasks,
  onTasksReordered,
}: StrategySelectorProps) {
  const [activeStrategy, setActiveStrategy] = useState<PrioritizationStrategy>(
    "highest-priority-first",
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Load saved preference on mount (Req 5.2)
  // Falls back to "highest-priority-first" when none exists (Req 5.4)
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadPreference() {
      try {
        const response = await axios.get<{ strategy: PrioritizationStrategy }>(
          `/api/preferences/${encodeURIComponent(userId)}`,
        );
        if (!cancelled) {
          const strategy = response.data.strategy ?? "highest-priority-first";
          setActiveStrategy(strategy);
          // Apply the loaded strategy to the current task list
          const sorted = orderTasks(tasks, strategy);
          onTasksReordered(sorted, strategy);
        }
      } catch {
        // If no profile exists the API may 404 — use default (Req 5.4)
        if (!cancelled) {
          const defaultStrategy: PrioritizationStrategy =
            "highest-priority-first";
          setActiveStrategy(defaultStrategy);
          const sorted = orderTasks(tasks, defaultStrategy);
          onTasksReordered(sorted, defaultStrategy);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreference();

    return () => {
      cancelled = true;
    };
    // Only run on mount (userId change triggers a fresh load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // -------------------------------------------------------------------
  // Handle strategy change (Req 4.1, 4.7, 5.1, 5.3)
  // -------------------------------------------------------------------
  const handleStrategyChange = async (strategy: PrioritizationStrategy) => {
    if (strategy === activeStrategy || saving) return;

    setActiveStrategy(strategy);
    setError(null);

    // Re-sort client-side immediately for responsiveness (Req 4.7 — < 2 s)
    const sorted = orderTasks(tasks, strategy);
    onTasksReordered(sorted, strategy);

    // Persist preference in background (Req 5.1, 5.3)
    setSaving(true);
    try {
      await axios.put(`/api/preferences/${encodeURIComponent(userId)}`, {
        strategy,
      });
    } catch {
      setError("Failed to save preference. Your selection is applied locally.");
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <section aria-label="Prioritization strategy">
      <h3 className="text-sm font-semibold text-[#6B6B6B] mb-2">
        Sort Strategy
      </h3>

      {loading ? (
        <p className="text-sm text-[#6B6B6B]" aria-live="polite">
          Loading preference…
        </p>
      ) : (
        <div
          role="group"
          aria-label="Prioritization strategies"
          className="flex flex-wrap gap-2"
        >
          {STRATEGIES.map(({ value, label }) => {
            const isActive = value === activeStrategy;
            return (
              <button
                key={value}
                onClick={() => handleStrategyChange(value)}
                disabled={saving}
                aria-pressed={isActive}
                aria-label={`Sort by ${label}`}
                className={[
                  "px-3 py-2 rounded-full text-sm transition-colors",
                  isActive
                    ? "bg-[#2A2A2A] text-white font-semibold"
                    : "border border-dark-border bg-white text-[#6B6B6B] hover:bg-dark-bg hover:text-[#1A1A1A]",
                  saving ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {saving && (
        <p className="text-xs text-[#6B6B6B] mt-1" aria-live="polite">
          Saving…
        </p>
      )}

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm text-red-500 mt-1"
        >
          {error}
        </p>
      )}
    </section>
  );
}
