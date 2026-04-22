/**
 * Express application with all REST API route handlers for the AI Daily Task Planner.
 *
 * Endpoints:
 *   POST   /api/tasks/parse            — Parse raw text into task list
 *   POST   /api/tasks/analyze          — Analyze confirmed tasks, assign metrics
 *   GET    /api/tasks/:sessionId       — Get tasks for a session
 *   PATCH  /api/tasks/:taskId/complete — Mark task complete with actual time
 *   GET    /api/preferences/:userId    — Get user preference profile
 *   PUT    /api/preferences/:userId    — Update user preference profile
 *   GET    /api/analytics/:userId      — Get analytics summary
 *   DELETE /api/learning/:userId       — Reset behavioral model
 *
 * Requirements: 1.1, 1.3, 1.4, 2.1–2.6, 5.1, 5.3, 6.1, 6.6, 7.1, 8.4
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";

import { TaskInputParser } from "./services/task-input-parser.js";
import { TaskAnalyzer } from "./services/task-analyzer.js";
import { AdaptiveLearningEngine } from "./services/adaptive-learning-engine.js";
import { AnalyticsAggregator } from "./services/analytics-aggregator.js";
import { PreferenceProfileStore } from "./services/preference-profile-store.js";
import { getUnblockedTasks } from "./utils/dependency-graph.js";
import type {
  AnalyzedTask,
  CompletionRecord,
  PrioritizationStrategy,
  TaskMetrics,
} from "./types/index.js";

// ---------------------------------------------------------------------------
// Row types for SQLite queries
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  session_id: string;
  description: string;
  raw_text: string;
  is_ambiguous: number;
  priority: number | null;
  effort_percentage: number | null;
  difficulty_level: number | null;
  estimated_time: number | null;
  is_completed: number;
  actual_time: number | null;
  completed_at: string | null;
  created_at: string;
}

interface DependencyRow {
  depends_on_task_id: string;
}

// ---------------------------------------------------------------------------
// Valid strategies for input validation
// ---------------------------------------------------------------------------

const VALID_STRATEGIES: PrioritizationStrategy[] = [
  "least-effort-first",
  "hardest-first",
  "highest-priority-first",
  "dependency-aware",
];

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export interface AppDependencies {
  db: Database.Database;
  parser: TaskInputParser;
  analyzer: TaskAnalyzer;
  learningEngine: AdaptiveLearningEngine;
  analytics: AnalyticsAggregator;
  preferenceStore: PreferenceProfileStore;
}

/**
 * Create and return a fully-configured Express application.
 *
 * Accepts pre-built service instances so the app is easy to test with
 * in-memory databases and mock LLM clients.
 */
export function createApp(deps: AppDependencies): express.Express {
  const { db, parser, analyzer, learningEngine, analytics, preferenceStore } =
    deps;

  const app = express();

  // -----------------------------------------------------------------------
  // Middleware
  // -----------------------------------------------------------------------

  app.use(cors());
  app.use(express.json());

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // -----------------------------------------------------------------------
  // POST /api/tasks/parse — Parse raw text into task list (Req 1.1, 1.3)
  // -----------------------------------------------------------------------

  app.post(
    "/api/tasks/parse",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { rawText } = req.body;

        if (rawText === undefined || rawText === null) {
          res.status(400).json({ error: "Missing required field: rawText" });
          return;
        }

        if (typeof rawText !== "string") {
          res.status(400).json({ error: "rawText must be a string" });
          return;
        }

        const result = await parser.parse(rawText);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/tasks/analyze — Analyze confirmed tasks (Req 2.1–2.6, 6.3)
  // -----------------------------------------------------------------------

  app.post(
    "/api/tasks/analyze",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { tasks, userId, rawInput } = req.body;

        if (!userId || typeof userId !== "string") {
          res
            .status(400)
            .json({ error: "Missing or invalid required field: userId" });
          return;
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
          res.status(400).json({ error: "tasks must be a non-empty array" });
          return;
        }

        // Ensure user exists
        db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);

        const result = await analyzer.analyze(tasks, userId);

        // Persist session and tasks to DB
        const sessionId = uuidv4();
        const sessionRawInput = typeof rawInput === "string" ? rawInput : "";

        db.prepare(
          "INSERT INTO task_sessions (id, user_id, raw_input) VALUES (?, ?, ?)",
        ).run(sessionId, userId, sessionRawInput);

        const insertTask = db.prepare(
          `INSERT INTO tasks (id, session_id, description, raw_text, is_ambiguous,
         priority, effort_percentage, difficulty_level, estimated_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        const insertDep = db.prepare(
          "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
        );

        const persistAll = db.transaction(() => {
          for (const task of result.tasks) {
            insertTask.run(
              task.id,
              sessionId,
              task.description,
              task.rawText,
              task.isAmbiguous ? 1 : 0,
              task.metrics.priority,
              task.metrics.effortPercentage,
              task.metrics.difficultyLevel,
              task.metrics.estimatedTime,
            );

            for (const depId of task.metrics.dependsOn) {
              insertDep.run(task.id, depId);
            }
          }
        });

        persistAll();

        res.json({
          sessionId,
          ...result,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/tasks/:sessionId — Fetch tasks for a session
  // -----------------------------------------------------------------------

  app.get(
    "/api/tasks/:sessionId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sessionId } = req.params;

        const taskRows = db
          .prepare(
            "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at",
          )
          .all(sessionId) as TaskRow[];

        if (taskRows.length === 0) {
          res.status(404).json({ error: "Session not found or has no tasks" });
          return;
        }

        const tasks: AnalyzedTask[] = taskRows.map((row) => {
          const depRows = db
            .prepare(
              "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?",
            )
            .all(row.id) as DependencyRow[];

          return rowToAnalyzedTask(row, depRows);
        });

        res.json({ sessionId, tasks });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /api/tasks/:taskId/complete — Mark task complete (Req 6.1, 8.4)
  // -----------------------------------------------------------------------

  app.patch(
    "/api/tasks/:taskId/complete",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { taskId } = req.params;
        const { actualTime } = req.body;

        if (actualTime === undefined || actualTime === null) {
          res.status(400).json({ error: "Missing required field: actualTime" });
          return;
        }

        if (typeof actualTime !== "number" || actualTime <= 0) {
          res
            .status(400)
            .json({ error: "actualTime must be a positive number" });
          return;
        }

        // Fetch the task
        const taskRow = db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(taskId) as TaskRow | undefined;

        if (!taskRow) {
          res.status(404).json({ error: "Task not found" });
          return;
        }

        if (taskRow.is_completed) {
          res.status(409).json({ error: "Task is already completed" });
          return;
        }

        // Mark task as complete
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE tasks SET is_completed = 1, actual_time = ?, completed_at = ? WHERE id = ?",
        ).run(actualTime, now, taskId);

        // Fetch session to get userId
        const sessionRow = db
          .prepare("SELECT user_id FROM task_sessions WHERE id = ?")
          .get(taskRow.session_id) as { user_id: string } | undefined;

        if (sessionRow) {
          // Record completion in the adaptive learning engine (Req 6.1)
          const completionRecord: CompletionRecord = {
            taskId,
            userId: sessionRow.user_id,
            description: taskRow.description,
            estimatedTime: taskRow.estimated_time ?? 30,
            actualTime,
            difficultyLevel: taskRow.difficulty_level ?? 3,
            completedAt: new Date(now),
          };

          learningEngine.recordCompletion(completionRecord);
        }

        // Determine newly unblocked tasks (Req 8.4)
        const allTaskRows = db
          .prepare("SELECT * FROM tasks WHERE session_id = ?")
          .all(taskRow.session_id) as TaskRow[];

        const allTasks: AnalyzedTask[] = allTaskRows.map((row) => {
          const depRows = db
            .prepare(
              "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?",
            )
            .all(row.id) as DependencyRow[];
          return rowToAnalyzedTask(row, depRows);
        });

        // Build the completed set (including the task we just completed)
        const completedIds = new Set(
          allTaskRows
            .filter((r) => r.is_completed || r.id === taskId)
            .map((r) => r.id),
        );

        const unblockedTasks = getUnblockedTasks(allTasks, completedIds);

        res.json({
          taskId,
          completed: true,
          actualTime,
          unblockedTasks: unblockedTasks.map((t) => ({
            id: t.id,
            description: t.description,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/preferences/:userId — Get preference profile (Req 5.1, 5.4)
  // -----------------------------------------------------------------------

  app.get(
    "/api/preferences/:userId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;

        const profile = preferenceStore.get(userId);

        if (!profile) {
          // Return default strategy when no profile exists (Req 5.4)
          res.json({
            userId,
            strategy: "highest-priority-first" as PrioritizationStrategy,
            updatedAt: null,
          });
          return;
        }

        res.json(profile);
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // PUT /api/preferences/:userId — Save preference profile (Req 5.3)
  // -----------------------------------------------------------------------

  app.put(
    "/api/preferences/:userId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;
        const { strategy } = req.body;

        if (!strategy || typeof strategy !== "string") {
          res
            .status(400)
            .json({ error: "Missing or invalid required field: strategy" });
          return;
        }

        if (!VALID_STRATEGIES.includes(strategy as PrioritizationStrategy)) {
          res.status(400).json({
            error: `Invalid strategy. Must be one of: ${VALID_STRATEGIES.join(", ")}`,
          });
          return;
        }

        preferenceStore.save(userId, strategy as PrioritizationStrategy);

        res.json({ userId, strategy });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /api/analytics/:userId — Get analytics summary (Req 7.1)
  // -----------------------------------------------------------------------

  app.get(
    "/api/analytics/:userId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
          res
            .status(400)
            .json({
              error: "Missing required query parameters: startDate, endDate",
            });
          return;
        }

        if (typeof startDate !== "string" || typeof endDate !== "string") {
          res
            .status(400)
            .json({
              error:
                "startDate and endDate must be strings in YYYY-MM-DD format",
            });
          return;
        }

        // Basic date format validation
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
          res
            .status(400)
            .json({
              error: "startDate and endDate must be in YYYY-MM-DD format",
            });
          return;
        }

        const summary = analytics.getSummary(userId, startDate, endDate);
        res.json(summary);
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /api/learning/:userId — Reset behavioral model (Req 6.6)
  // -----------------------------------------------------------------------

  app.delete(
    "/api/learning/:userId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.params;

        learningEngine.resetModel(userId);

        res.json({ userId, reset: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Global error handler
  // -----------------------------------------------------------------------

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a database task row + dependency rows into an AnalyzedTask object.
 */
function rowToAnalyzedTask(
  row: TaskRow,
  depRows: DependencyRow[],
): AnalyzedTask {
  const metrics: TaskMetrics = {
    priority: row.priority ?? 3,
    effortPercentage: row.effort_percentage ?? 0,
    difficultyLevel: row.difficulty_level ?? 3,
    estimatedTime: row.estimated_time ?? 30,
    dependsOn: depRows.map((d) => d.depends_on_task_id),
  };

  return {
    id: row.id,
    rawText: row.raw_text,
    description: row.description,
    isAmbiguous: Boolean(row.is_ambiguous),
    metrics,
  };
}
