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
import { CategoryRepository } from "./db/category-repository.js";
import type {
  CategoryConsolidator,
  ConsolidationSuggestion,
} from "./services/category-consolidator.js";
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
  categoryRepo: CategoryRepository;
  categoryConsolidator?: CategoryConsolidator;
}

/**
 * Create and return a fully-configured Express application.
 *
 * Accepts pre-built service instances so the app is easy to test with
 * in-memory databases and mock LLM clients.
 */
export function createApp(deps: AppDependencies): express.Express {
  const {
    db,
    parser,
    analyzer,
    learningEngine,
    analytics,
    preferenceStore,
    categoryRepo,
    categoryConsolidator,
  } = deps;

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
  // GET /api/categories — List all categories (Req 10.1)
  // -----------------------------------------------------------------------

  app.get(
    "/api/categories",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.query.userId as string | undefined;
        if (userId) {
          const categories = categoryRepo.getActiveByUserId(userId);
          res.json(categories);
        } else {
          // Legacy: return all categories when no userId is provided
          const categories = categoryRepo.getAll();
          res.json(categories);
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/categories/merge — Merge source category into target (Req 8.1–8.5, 10.2, 10.4, 10.5)
  // -----------------------------------------------------------------------

  app.post(
    "/api/categories/merge",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sourceCategoryId, targetCategoryId } = req.body;

        // Validate required fields
        if (sourceCategoryId == null || targetCategoryId == null) {
          res.status(400).json({
            error:
              "Missing required fields: sourceCategoryId, targetCategoryId",
          });
          return;
        }

        // Validate source !== target
        if (sourceCategoryId === targetCategoryId) {
          res
            .status(400)
            .json({ error: "Cannot merge a category with itself" });
          return;
        }

        // Validate both categories exist
        const sourceCategory = categoryRepo.findById(sourceCategoryId);
        if (!sourceCategory) {
          res.status(404).json({ error: "Source category not found" });
          return;
        }

        const targetCategory = categoryRepo.findById(targetCategoryId);
        if (!targetCategory) {
          res.status(404).json({ error: "Target category not found" });
          return;
        }

        // Execute merge via repository (soft-delete: sets status='merged',
        // populates merged_into_category_id, updates all references)
        categoryRepo.merge(sourceCategoryId, targetCategoryId);

        res.json({
          message: `Category "${sourceCategory.name}" merged into "${targetCategory.name}"`,
          targetCategoryId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /api/categories/:categoryId — Rename a category (Req 9.1–9.4, 10.3–10.5)
  // -----------------------------------------------------------------------

  app.patch(
    "/api/categories/:categoryId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const categoryId = Number(req.params.categoryId);
        const { name } = req.body;

        if (!name || typeof name !== "string" || name.trim() === "") {
          res.status(400).json({ error: "Missing required field: name" });
          return;
        }

        const updated = categoryRepo.rename(categoryId, name.trim());
        res.json(updated);
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === "Category not found") {
            res.status(404).json({ error: err.message });
            return;
          }
          if (err.message === "A category with this name already exists") {
            res.status(409).json({ error: err.message });
            return;
          }
        }
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/categories — Create a category manually (Req 14.4, 14.6, 14.7)
  // -----------------------------------------------------------------------

  app.post(
    "/api/categories",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, userId } = req.body;

        if (!name || typeof name !== "string" || name.trim() === "") {
          res.status(400).json({ error: "Missing required field: name" });
          return;
        }

        if (!userId || typeof userId !== "string" || userId.trim() === "") {
          res.status(400).json({ error: "Missing required field: userId" });
          return;
        }

        const trimmedName = name.trim();

        // Check for duplicate name for this user
        const existing = categoryRepo.findByNameAndUserId(trimmedName, userId);
        if (existing) {
          res
            .status(409)
            .json({ error: "A category with this name already exists" });
          return;
        }

        // Ensure user exists
        db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);

        const category = categoryRepo.create(trimmedName, userId, "user");
        res.status(201).json(category);
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /api/categories/:categoryId/archive — Archive a category (Req 14.5, 14.7)
  // -----------------------------------------------------------------------

  app.patch(
    "/api/categories/:categoryId/archive",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const categoryId = Number(req.params.categoryId);

        const category = categoryRepo.findById(categoryId);
        if (!category) {
          res.status(404).json({ error: "Category not found" });
          return;
        }

        categoryRepo.archive(categoryId);

        const updated = categoryRepo.findById(categoryId)!;
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/categories/consolidate — Trigger consolidation analysis (Req 8.1)
  // -----------------------------------------------------------------------

  app.post(
    "/api/categories/consolidate",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = req.body;

        if (!userId || typeof userId !== "string" || userId.trim() === "") {
          res.status(400).json({ error: "Missing required field: userId" });
          return;
        }

        if (!categoryConsolidator) {
          res
            .status(501)
            .json({ error: "Category consolidation is not configured" });
          return;
        }

        const categories = categoryRepo.getActiveByUserId(userId);
        const suggestions = await categoryConsolidator.analyze(categories);

        res.json({ suggestions });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /api/categories/consolidate/apply — Apply consolidation suggestions (Req 8.2, 8.3, 8.4, 8.5)
  // -----------------------------------------------------------------------

  app.post(
    "/api/categories/consolidate/apply",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId, suggestionIds, suggestions } = req.body;

        if (!userId || typeof userId !== "string" || userId.trim() === "") {
          res.status(400).json({ error: "Missing required field: userId" });
          return;
        }

        if (!Array.isArray(suggestionIds) || suggestionIds.length === 0) {
          res
            .status(400)
            .json({ error: "Missing required field: suggestionIds" });
          return;
        }

        if (!Array.isArray(suggestions) || suggestions.length === 0) {
          res
            .status(400)
            .json({ error: "Missing required field: suggestions" });
          return;
        }

        const applied: string[] = [];
        const errors: { suggestionId: string; error: string }[] = [];

        // Filter suggestions to only those in the approved list
        const approvedSuggestions = (
          suggestions as ConsolidationSuggestion[]
        ).filter((s) => suggestionIds.includes(s.id));

        for (const suggestion of approvedSuggestions) {
          try {
            if (suggestion.action === "merge") {
              if (
                suggestion.sourceCategoryId == null ||
                suggestion.targetCategoryId == null
              ) {
                errors.push({
                  suggestionId: suggestion.id,
                  error: "Missing source or target category ID for merge",
                });
                continue;
              }
              categoryRepo.merge(
                suggestion.sourceCategoryId,
                suggestion.targetCategoryId,
              );
              applied.push(suggestion.id);
            } else if (suggestion.action === "rename") {
              if (suggestion.categoryId == null || !suggestion.proposedName) {
                errors.push({
                  suggestionId: suggestion.id,
                  error: "Missing category ID or proposed name for rename",
                });
                continue;
              }
              categoryRepo.rename(
                suggestion.categoryId,
                suggestion.proposedName,
              );
              applied.push(suggestion.id);
            } else if (suggestion.action === "split") {
              if (
                suggestion.categoryId == null ||
                !suggestion.proposedNames ||
                suggestion.proposedNames.length < 2
              ) {
                errors.push({
                  suggestionId: suggestion.id,
                  error: "Missing category ID or proposed names for split",
                });
                continue;
              }
              // Create new categories for the split; leave existing references on original
              for (const newName of suggestion.proposedNames) {
                categoryRepo.create(newName, userId, "system");
              }
              // Archive the original category
              categoryRepo.archive(suggestion.categoryId);
              applied.push(suggestion.id);
            }
          } catch (err) {
            errors.push({
              suggestionId: suggestion.id,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }
        }

        res.json({ applied, errors });
      } catch (err) {
        next(err);
      }
    },
  );

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

        // Include completion status so the client can restore state on reload
        const completedTaskIds = taskRows
          .filter((r) => r.is_completed)
          .map((r) => r.id);

        const actualTimes: Record<string, number> = {};
        for (const row of taskRows) {
          if (row.is_completed && row.actual_time != null) {
            actualTimes[row.id] = row.actual_time;
          }
        }

        res.json({ sessionId, tasks, completedTaskIds, actualTimes });
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
          res.status(400).json({
            error: "Missing required query parameters: startDate, endDate",
          });
          return;
        }

        if (typeof startDate !== "string" || typeof endDate !== "string") {
          res.status(400).json({
            error: "startDate and endDate must be strings in YYYY-MM-DD format",
          });
          return;
        }

        // Basic date format validation
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
          res.status(400).json({
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
