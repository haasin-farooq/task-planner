import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import AppShell from "./components/AppShell";
import TaskInput from "./components/TaskInput";
import MetricsDisplay from "./components/MetricsDisplay";
import StrategySelector from "./components/StrategySelector";
import CompletionDialog from "./components/CompletionDialog";
import CompletionSummary from "./components/CompletionSummary";
import UnblockedNotification from "./components/UnblockedNotification";
import AnalyticsDashboard from "./components/AnalyticsDashboard";

import { analyzeTasks, getSessionTasks } from "./api/client";

import type { AnalyzedTask, ParsedTask, PrioritizationStrategy } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Placeholder user ID — a real app would get this from auth. */
const USER_ID = "default-user";

// ---------------------------------------------------------------------------
// App phases
// ---------------------------------------------------------------------------

type AppPhase = "input" | "analyzing" | "tasks" | "restoring";

/** localStorage key for persisting the active session ID. */
const SESSION_STORAGE_KEY = "taskplanner_session_id";

// ---------------------------------------------------------------------------
// Shared task data context — lets PlannerView share state with AppShell
// ---------------------------------------------------------------------------

export interface TaskDataContextValue {
  tasks: AnalyzedTask[];
  completedTaskIds: Set<string>;
}

export const TaskDataContext = createContext<TaskDataContextValue>({
  tasks: [],
  completedTaskIds: new Set(),
});

export function useTaskData(): TaskDataContextValue {
  return useContext(TaskDataContext);
}

// ---------------------------------------------------------------------------
// Main planner view
// ---------------------------------------------------------------------------

interface PlannerViewProps {
  onTaskDataChange: (
    tasks: AnalyzedTask[],
    completedTaskIds: Set<string>,
  ) => void;
}

function PlannerView({ onTaskDataChange }: PlannerViewProps) {
  // --- Phase / flow state ---
  const [phase, setPhase] = useState<AppPhase>("input");

  // --- Session state ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AnalyzedTask[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<PrioritizationStrategy>(
    "highest-priority-first",
  );

  // --- Completion tracking ---
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [actualTimes, setActualTimes] = useState<Map<string, number>>(
    new Map(),
  );

  // --- UI state ---
  const [completingTask, setCompletingTask] = useState<AnalyzedTask | null>(
    null,
  );
  const [unblockedTasks, setUnblockedTasks] = useState<
    { id: string; description: string }[]
  >([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Restore session from localStorage on mount
  // -------------------------------------------------------------------

  useEffect(() => {
    const savedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!savedSessionId) return;

    let cancelled = false;
    setPhase("restoring");

    getSessionTasks(savedSessionId)
      .then((result) => {
        if (cancelled) return;

        const completed = new Set(result.completedTaskIds);
        const times = new Map(
          Object.entries(result.actualTimes).map(
            ([id, t]) => [id, t] as [string, number],
          ),
        );

        setSessionId(result.sessionId);
        setTasks(result.tasks);
        setCompletedTaskIds(completed);
        setActualTimes(times);
        setPhase("tasks");
        onTaskDataChange(result.tasks, completed);
      })
      .catch(() => {
        if (cancelled) return;
        // Session no longer exists — clear stale key and show input
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setPhase("input");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------
  // Step 1 → 2: User confirms parsed tasks → analyze them
  // -------------------------------------------------------------------

  const handleTasksConfirmed = useCallback(
    async (parsed: ParsedTask[]) => {
      setPhase("analyzing");
      setAnalyzeError(null);

      try {
        const result = await analyzeTasks(parsed, USER_ID);

        setSessionId(result.sessionId);
        setTasks(result.tasks);
        setCompletedTaskIds(new Set());
        setActualTimes(new Map());
        setPhase("tasks");

        // Persist session ID so it survives page refresh
        localStorage.setItem(SESSION_STORAGE_KEY, result.sessionId);

        // Notify parent of new task data
        onTaskDataChange(result.tasks, new Set());
      } catch {
        setAnalyzeError("Failed to analyze tasks. Please try again.");
        setPhase("input");
      }
    },
    [onTaskDataChange],
  );

  // -------------------------------------------------------------------
  // Strategy change → re-sort tasks client-side (Req 4.1)
  // -------------------------------------------------------------------

  const handleTasksReordered = useCallback(
    (sorted: AnalyzedTask[], strategy: PrioritizationStrategy) => {
      setTasks(sorted);
      setActiveStrategy(strategy);
      onTaskDataChange(sorted, completedTaskIds);
    },
    [onTaskDataChange, completedTaskIds],
  );

  // -------------------------------------------------------------------
  // Task completion flow (Req 6.1, 8.1, 8.2, 8.4)
  // -------------------------------------------------------------------

  const handleTaskComplete = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) setCompletingTask(task);
    },
    [tasks],
  );

  const handleCompletionConfirmed = useCallback(
    (
      taskId: string,
      actualTime: number,
      newlyUnblocked: { id: string; description: string }[],
    ) => {
      const newCompleted = new Set(completedTaskIds).add(taskId);
      setCompletedTaskIds(newCompleted);
      setActualTimes((prev) => new Map(prev).set(taskId, actualTime));
      setCompletingTask(null);

      if (newlyUnblocked.length > 0) {
        setUnblockedTasks(newlyUnblocked);
      }

      // Notify parent of updated completion state
      onTaskDataChange(tasks, newCompleted);
    },
    [onTaskDataChange, tasks, completedTaskIds],
  );

  const handleCompletionCancelled = useCallback(() => {
    setCompletingTask(null);
  }, []);

  const handleDismissUnblocked = useCallback(() => {
    setUnblockedTasks([]);
  }, []);

  // -------------------------------------------------------------------
  // Start over
  // -------------------------------------------------------------------

  const handleStartOver = useCallback(() => {
    setPhase("input");
    setSessionId(null);
    setTasks([]);
    setCompletedTaskIds(new Set());
    setActualTimes(new Map());
    setAnalyzeError(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    onTaskDataChange([], new Set());
  }, [onTaskDataChange]);

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------

  const allComplete =
    tasks.length > 0 && completedTaskIds.size === tasks.length;

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto px-4">
      {/* Main content area header */}
      <div className="mb-8 pt-2">
        <h1 className="text-3xl font-bold text-[#1A1A1A] font-serif">
          What's on your <em className="text-accent">plate</em> today?
        </h1>
        <p className="text-[#6B6B6B] mt-2">
          Dump the mess. One line, many lines — doesn't matter. We untangle it
          and sort the day for you.
        </p>
      </div>

      {/* Phase: input */}
      {phase === "input" && (
        <>
          <TaskInput onConfirm={handleTasksConfirmed} />
          {analyzeError && (
            <p role="alert" aria-live="assertive" className="text-red-500 mt-2">
              {analyzeError}
            </p>
          )}
        </>
      )}

      {/* Phase: analyzing */}
      {phase === "analyzing" && (
        <p aria-live="polite" className="text-center py-8 text-[#6B6B6B]">
          Analyzing your tasks…
        </p>
      )}

      {/* Phase: restoring session */}
      {phase === "restoring" && (
        <p aria-live="polite" className="text-center py-8 text-[#6B6B6B]">
          Restoring your session…
        </p>
      )}

      {/* Phase: tasks */}
      {phase === "tasks" && (
        <div data-session-id={sessionId ?? undefined}>
          {/* Completion summary when all done (Req 8.3) */}
          {allComplete && (
            <CompletionSummary tasks={tasks} actualTimes={actualTimes} />
          )}

          {/* Strategy selector (Req 4.1, 5.2) */}
          <StrategySelector
            userId={USER_ID}
            tasks={tasks}
            onTasksReordered={handleTasksReordered}
          />

          {/* Active strategy label for screen readers */}
          <p aria-live="polite" className="text-xs text-[#6B6B6B] mt-1 mb-3">
            Sorted by: {activeStrategy.replace(/-/g, " ")}
          </p>

          {/* Task list with metrics */}
          <MetricsDisplay
            tasks={tasks}
            completedTaskIds={completedTaskIds}
            onTaskComplete={handleTaskComplete}
          />

          {/* Start over button */}
          <div className="mt-6 text-center">
            <button
              onClick={handleStartOver}
              aria-label="Start over with new tasks"
              className="px-6 py-2 rounded-md border border-dark-border bg-white text-[#6B6B6B] hover:bg-dark-bg cursor-pointer transition-colors"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {/* Completion dialog (modal) */}
      {completingTask && (
        <CompletionDialog
          task={completingTask}
          onCancel={handleCompletionCancelled}
          onComplete={handleCompletionConfirmed}
        />
      )}

      {/* Unblocked tasks notification (Req 8.4) */}
      {unblockedTasks.length > 0 && (
        <UnblockedNotification
          unblockedTasks={unblockedTasks}
          onDismiss={handleDismissUnblocked}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics view
// ---------------------------------------------------------------------------

function AnalyticsView() {
  return (
    <div className="max-w-3xl mx-auto px-4 pb-8">
      <AnalyticsDashboard userId={USER_ID} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App with routing — AppShell as layout route
// ---------------------------------------------------------------------------

function App() {
  const [taskData, setTaskData] = useState<TaskDataContextValue>({
    tasks: [],
    completedTaskIds: new Set(),
  });

  const handleTaskDataChange = useCallback(
    (tasks: AnalyzedTask[], completedTaskIds: Set<string>) => {
      setTaskData({ tasks, completedTaskIds });
    },
    [],
  );

  return (
    <TaskDataContext.Provider value={taskData}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/"
              element={<PlannerView onTaskDataChange={handleTaskDataChange} />}
            />
            <Route path="/analytics" element={<AnalyticsView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TaskDataContext.Provider>
  );
}

export default App;
