import { useState, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";

import TaskInput from "./components/TaskInput";
import MetricsDisplay from "./components/MetricsDisplay";
import StrategySelector from "./components/StrategySelector";
import ProgressIndicator from "./components/ProgressIndicator";
import CompletionDialog from "./components/CompletionDialog";
import CompletionSummary from "./components/CompletionSummary";
import UnblockedNotification from "./components/UnblockedNotification";
import AnalyticsDashboard from "./components/AnalyticsDashboard";

import { analyzeTasks } from "./api/client";

import type { AnalyzedTask, ParsedTask, PrioritizationStrategy } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Placeholder user ID — a real app would get this from auth. */
const USER_ID = "default-user";

// ---------------------------------------------------------------------------
// App phases
// ---------------------------------------------------------------------------

type AppPhase = "input" | "analyzing" | "tasks";

// ---------------------------------------------------------------------------
// Navigation bar (shared across routes)
// ---------------------------------------------------------------------------

function NavBar() {
  const location = useLocation();
  const isAnalytics = location.pathname === "/analytics";

  return (
    <nav
      aria-label="Main navigation"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.75rem 1.5rem",
        borderBottom: "1px solid #e5e7eb",
        marginBottom: "1.5rem",
      }}
    >
      <Link
        to="/"
        style={{
          textDecoration: "none",
          color: "#111827",
          fontSize: "1.25rem",
          fontWeight: 700,
        }}
      >
        AI Daily Task Planner
      </Link>

      <Link
        to={isAnalytics ? "/" : "/analytics"}
        aria-label={isAnalytics ? "Back to tasks" : "View analytics"}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "0.375rem",
          border: "1px solid #d1d5db",
          backgroundColor: "#ffffff",
          textDecoration: "none",
          color: "#374151",
          fontWeight: 500,
        }}
      >
        {isAnalytics ? "← Tasks" : "Analytics"}
      </Link>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main planner view
// ---------------------------------------------------------------------------

function PlannerView() {
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
  // Step 1 → 2: User confirms parsed tasks → analyze them
  // -------------------------------------------------------------------

  const handleTasksConfirmed = useCallback(async (parsed: ParsedTask[]) => {
    setPhase("analyzing");
    setAnalyzeError(null);

    try {
      const result = await analyzeTasks(parsed, USER_ID);

      setSessionId(result.sessionId);
      setTasks(result.tasks);
      setCompletedTaskIds(new Set());
      setActualTimes(new Map());
      setPhase("tasks");
    } catch {
      setAnalyzeError("Failed to analyze tasks. Please try again.");
      setPhase("input");
    }
  }, []);

  // -------------------------------------------------------------------
  // Strategy change → re-sort tasks client-side (Req 4.1)
  // -------------------------------------------------------------------

  const handleTasksReordered = useCallback(
    (sorted: AnalyzedTask[], strategy: PrioritizationStrategy) => {
      setTasks(sorted);
      setActiveStrategy(strategy);
    },
    [],
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
      setCompletedTaskIds((prev) => new Set(prev).add(taskId));
      setActualTimes((prev) => new Map(prev).set(taskId, actualTime));
      setCompletingTask(null);

      if (newlyUnblocked.length > 0) {
        setUnblockedTasks(newlyUnblocked);
      }
    },
    [],
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
  }, []);

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------

  const allComplete =
    tasks.length > 0 && completedTaskIds.size === tasks.length;

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "0 1rem" }}>
      {/* Phase: input */}
      {phase === "input" && (
        <>
          <TaskInput onConfirm={handleTasksConfirmed} />
          {analyzeError && (
            <p
              role="alert"
              aria-live="assertive"
              style={{ color: "#dc2626", marginTop: "0.5rem" }}
            >
              {analyzeError}
            </p>
          )}
        </>
      )}

      {/* Phase: analyzing */}
      {phase === "analyzing" && (
        <p
          aria-live="polite"
          style={{ textAlign: "center", padding: "2rem 0" }}
        >
          Analyzing your tasks…
        </p>
      )}

      {/* Phase: tasks */}
      {phase === "tasks" && (
        <div data-session-id={sessionId ?? undefined}>
          {/* Completion summary when all done (Req 8.3) */}
          {allComplete && (
            <CompletionSummary tasks={tasks} actualTimes={actualTimes} />
          )}

          {/* Progress indicator (Req 7.6, 8.2) */}
          <ProgressIndicator
            tasks={tasks}
            completedTaskIds={completedTaskIds}
          />

          {/* Strategy selector (Req 4.1, 5.2) */}
          <StrategySelector
            userId={USER_ID}
            tasks={tasks}
            onTasksReordered={handleTasksReordered}
          />

          {/* Active strategy label for screen readers */}
          <p
            aria-live="polite"
            style={{
              fontSize: "0.75rem",
              color: "#9ca3af",
              margin: "0.25rem 0 0.75rem",
            }}
          >
            Sorted by: {activeStrategy.replace(/-/g, " ")}
          </p>

          {/* Task list with metrics */}
          <MetricsDisplay
            tasks={tasks}
            completedTaskIds={completedTaskIds}
            onTaskComplete={handleTaskComplete}
          />

          {/* Start over button */}
          <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
            <button
              onClick={handleStartOver}
              aria-label="Start over with new tasks"
              style={{
                padding: "0.5rem 1.5rem",
                borderRadius: "0.375rem",
                border: "1px solid #d1d5db",
                backgroundColor: "#ffffff",
                cursor: "pointer",
              }}
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
    </main>
  );
}

// ---------------------------------------------------------------------------
// Analytics view
// ---------------------------------------------------------------------------

function AnalyticsView() {
  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "0 1rem" }}>
      <AnalyticsDashboard userId={USER_ID} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Root App with routing
// ---------------------------------------------------------------------------

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<PlannerView />} />
        <Route path="/analytics" element={<AnalyticsView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
