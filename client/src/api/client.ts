/**
 * Typed API client for all AI Daily Task Planner backend endpoints.
 *
 * Centralises HTTP calls so components don't import axios directly.
 * Each function maps 1-to-1 with a REST endpoint defined in server/src/app.ts.
 */

import axios from "axios";
import type {
  AnalyzedTask,
  AnalyticsSummary,
  CategoryEntity,
  ConsolidationSuggestion,
  ParsedTask,
  PrioritizationStrategy,
} from "../types";

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ParseResult {
  tasks: ParsedTask[];
  ambiguousItems: ParsedTask[];
  errors: string[];
}

export interface AnalyzeResult {
  sessionId: string;
  tasks: AnalyzedTask[];
  circularDependencies: { cycle: string[]; message: string }[];
}

export interface CompletionResult {
  taskId: string;
  completed: boolean;
  actualTime: number;
  unblockedTasks: { id: string; description: string }[];
}

export interface PreferenceResult {
  userId: string;
  strategy: PrioritizationStrategy;
  updatedAt: string | null;
}

export interface SessionTasksResult {
  sessionId: string;
  tasks: AnalyzedTask[];
  completedTaskIds: string[];
  actualTimes: Record<string, number>;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** POST /api/tasks/parse — Parse raw text into a task list. */
export async function parseTasks(rawText: string): Promise<ParseResult> {
  const response = await axios.post<ParseResult>("/api/tasks/parse", {
    rawText,
  });
  return response.data;
}

/** POST /api/tasks/analyze — Analyze confirmed tasks and assign metrics. */
export async function analyzeTasks(
  tasks: ParsedTask[],
  userId: string,
  rawInput?: string,
): Promise<AnalyzeResult> {
  const response = await axios.post<AnalyzeResult>("/api/tasks/analyze", {
    tasks,
    userId,
    rawInput,
  });
  return response.data;
}

/** GET /api/tasks/:sessionId — Fetch tasks for a session. */
export async function getSessionTasks(
  sessionId: string,
): Promise<SessionTasksResult> {
  const response = await axios.get<SessionTasksResult>(
    `/api/tasks/${encodeURIComponent(sessionId)}`,
  );
  return response.data;
}

/** PATCH /api/tasks/:taskId/complete — Mark a task as complete. */
export async function completeTask(
  taskId: string,
  actualTime: number,
): Promise<CompletionResult> {
  const response = await axios.patch<CompletionResult>(
    `/api/tasks/${encodeURIComponent(taskId)}/complete`,
    { actualTime },
  );
  return response.data;
}

/** GET /api/preferences/:userId — Get user preference profile. */
export async function getPreference(userId: string): Promise<PreferenceResult> {
  const response = await axios.get<PreferenceResult>(
    `/api/preferences/${encodeURIComponent(userId)}`,
  );
  return response.data;
}

/** PUT /api/preferences/:userId — Save user preference profile. */
export async function savePreference(
  userId: string,
  strategy: PrioritizationStrategy,
): Promise<PreferenceResult> {
  const response = await axios.put<PreferenceResult>(
    `/api/preferences/${encodeURIComponent(userId)}`,
    { strategy },
  );
  return response.data;
}

/** GET /api/analytics/:userId — Get analytics summary for a date range. */
export async function getAnalytics(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AnalyticsSummary> {
  const response = await axios.get<AnalyticsSummary>(
    `/api/analytics/${encodeURIComponent(userId)}`,
    { params: { startDate, endDate } },
  );
  return response.data;
}

/** DELETE /api/learning/:userId — Reset the user's behavioral model. */
export async function resetLearningModel(
  userId: string,
): Promise<{ userId: string; reset: boolean }> {
  const response = await axios.delete<{ userId: string; reset: boolean }>(
    `/api/learning/${encodeURIComponent(userId)}`,
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Category management
// ---------------------------------------------------------------------------

/** GET /api/categories?userId=... — Get active categories for a user. */
export async function getCategories(userId: string): Promise<CategoryEntity[]> {
  const response = await axios.get<CategoryEntity[]>("/api/categories", {
    params: { userId },
  });
  return response.data;
}

/** POST /api/categories — Create a category manually. */
export async function createCategory(
  name: string,
  userId: string,
): Promise<CategoryEntity> {
  const response = await axios.post<CategoryEntity>("/api/categories", {
    name,
    userId,
  });
  return response.data;
}

/** PATCH /api/categories/:id/archive — Archive a category. */
export async function archiveCategory(
  categoryId: number,
): Promise<CategoryEntity> {
  const response = await axios.patch<CategoryEntity>(
    `/api/categories/${encodeURIComponent(categoryId)}/archive`,
  );
  return response.data;
}

/** POST /api/categories/consolidate — Trigger consolidation analysis. */
export async function consolidateCategories(
  userId: string,
): Promise<{ suggestions: ConsolidationSuggestion[] }> {
  const response = await axios.post<{
    suggestions: ConsolidationSuggestion[];
  }>("/api/categories/consolidate", { userId });
  return response.data;
}

/** POST /api/categories/consolidate/apply — Apply approved consolidation suggestions. */
export async function applyConsolidation(
  userId: string,
  suggestionIds: string[],
  suggestions: ConsolidationSuggestion[],
): Promise<{
  applied: string[];
  errors: { suggestionId: string; error: string }[];
}> {
  const response = await axios.post<{
    applied: string[];
    errors: { suggestionId: string; error: string }[];
  }>("/api/categories/consolidate/apply", {
    userId,
    suggestionIds,
    suggestions,
  });
  return response.data;
}
