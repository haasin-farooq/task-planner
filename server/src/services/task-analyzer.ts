/**
 * TaskAnalyzer — assigns AI-generated metrics to parsed tasks using an LLM,
 * incorporating the user's behavioural model from the Adaptive Learning Engine.
 *
 * Responsibilities:
 * - Fetch the user's behavioural model for adjustment context
 * - Send tasks + adjustments to the LLM for metric assignment
 * - Validate and clamp returned metrics (priority, difficulty, estimated time)
 * - Normalize effort percentages so they sum to 100
 * - Validate dependency references and strip invalid ones
 * - Detect and flag circular dependencies
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.3
 */

import OpenAI from "openai";
import type {
  ParsedTask,
  AnalyzedTask,
  AnalysisResult,
  TaskMetrics,
  BehavioralModel,
} from "../types/index.js";
import { validateTaskMetrics, clampMetrics } from "../utils/validation.js";
import { normalizeEffort } from "../utils/effort-normalization.js";
import {
  validateDependencyRefs,
  detectCycles,
} from "../utils/dependency-graph.js";
import { AdaptiveLearningEngine } from "./adaptive-learning-engine.js";
import type { AICategoryAssigner } from "./ai-category-assigner.js";
import type { CategoryRepository } from "../db/category-repository.js";

// ---------------------------------------------------------------------------
// LLM prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(model: BehavioralModel): string {
  let adjustmentContext = "";

  // Only include behavioural adjustments when the user has enough data (Req 6.3)
  const applicableAdjustments = model.adjustments.filter(
    (a) => a.sampleSize >= 10,
  );

  if (model.totalCompletedTasks >= 10 && applicableAdjustments.length > 0) {
    const lines = applicableAdjustments.map(
      (a) =>
        `- Category "${a.category}": timeMultiplier=${a.timeMultiplier.toFixed(2)}, difficultyAdjustment=${a.difficultyAdjustment.toFixed(2)} (based on ${a.sampleSize} tasks)`,
    );
    adjustmentContext = `\n\nThe user has historical completion data. Adjust your estimates using these behavioural factors:\n${lines.join("\n")}\n- A timeMultiplier < 1 means the user is faster than average — reduce estimatedTime.\n- A timeMultiplier > 1 means the user is slower — increase estimatedTime.\n- Apply difficultyAdjustment similarly to difficultyLevel (negative = easier, positive = harder).`;
  }

  return `You are a task-analysis assistant. You will receive a JSON array of tasks, each with an "id" and "description".

For each task, assign the following metrics:
- priority: integer 1-5 (1 = lowest, 5 = highest importance)
- effortPercentage: a positive number representing relative effort (will be normalized later)
- difficultyLevel: integer 1-5 (1 = easiest, 5 = hardest)
- estimatedTime: positive integer in minutes
- dependsOn: array of task IDs that this task depends on (empty array if none)

Rules:
1. Every task must have all five metric fields.
2. dependsOn must only reference IDs from the provided task list.
3. Do NOT create circular dependencies.
4. Return ONLY valid JSON matching the schema below — no markdown fences, no commentary.
${adjustmentContext}

JSON schema:
{
  "tasks": [
    {
      "id": "<task id>",
      "priority": <1-5>,
      "effortPercentage": <positive number>,
      "difficultyLevel": <1-5>,
      "estimatedTime": <positive integer minutes>,
      "dependsOn": ["<task-id>", ...]
    }
  ]
}`;
}

const STRICT_RETRY_PROMPT = `You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.
The JSON must have a single key "tasks" containing an array of objects. Each object must have:
- "id" (string): the task ID from the input
- "priority" (integer 1-5)
- "effortPercentage" (positive number)
- "difficultyLevel" (integer 1-5)
- "estimatedTime" (positive integer, minutes)
- "dependsOn" (array of task ID strings, or empty array)

Now analyze the following tasks and return ONLY the JSON:`;

// ---------------------------------------------------------------------------
// LLM response types
// ---------------------------------------------------------------------------

interface LLMTaskMetrics {
  id: string;
  priority: number;
  effortPercentage: number;
  difficultyLevel: number;
  estimatedTime: number;
  dependsOn: string[];
}

interface LLMAnalyzeResponse {
  tasks: LLMTaskMetrics[];
}

// ---------------------------------------------------------------------------
// TaskAnalyzer
// ---------------------------------------------------------------------------

export class TaskAnalyzer {
  private client: OpenAI;
  private model: string;
  private learningEngine: AdaptiveLearningEngine;
  private categoryAssigner?: AICategoryAssigner;
  private categoryRepo?: CategoryRepository;

  constructor(
    learningEngine: AdaptiveLearningEngine,
    client?: OpenAI,
    model?: string,
    categoryAssigner?: AICategoryAssigner,
    categoryRepo?: CategoryRepository,
  ) {
    this.learningEngine = learningEngine;
    this.client = client ?? new OpenAI();
    this.model = model ?? "gpt-4o-mini";
    this.categoryAssigner = categoryAssigner;
    this.categoryRepo = categoryRepo;
  }

  /**
   * Analyze a list of parsed tasks: fetch the user's behavioural model,
   * call the LLM for metric assignment, then validate, clamp, normalize,
   * and check dependencies.
   */
  async analyze(tasks: ParsedTask[], userId: string): Promise<AnalysisResult> {
    if (tasks.length === 0) {
      return { tasks: [], circularDependencies: [] };
    }

    // 1. Fetch behavioural model for adjustment context (Req 6.3)
    const behavioralModel = this.learningEngine.getBehavioralModel(userId);

    // 2. Call LLM for metric assignment
    const taskInput = tasks.map((t) => ({
      id: t.id,
      description: t.description,
    }));
    let llmMetrics = await this.callLLM(taskInput, behavioralModel, false);

    // Retry once with stricter prompt on failure
    if (llmMetrics === null) {
      llmMetrics = await this.callLLM(taskInput, behavioralModel, true);
    }

    // Both attempts failed — return tasks with default metrics
    if (llmMetrics === null) {
      return this.buildDefaultResult(tasks);
    }

    // 3. Map LLM output back to tasks, validate, and clamp
    const metricsById = new Map(llmMetrics.map((m) => [m.id, m]));
    const validTaskIds = new Set(tasks.map((t) => t.id));

    const analyzedTasks: AnalyzedTask[] = tasks.map((task) => {
      const llm = metricsById.get(task.id);
      const rawMetrics: TaskMetrics = llm
        ? {
            priority: llm.priority,
            effortPercentage: llm.effortPercentage,
            difficultyLevel: llm.difficultyLevel,
            estimatedTime: llm.estimatedTime,
            dependsOn: Array.isArray(llm.dependsOn)
              ? llm.dependsOn.filter((id) => typeof id === "string")
              : [],
          }
        : this.defaultMetrics(tasks.length);

      // Clamp out-of-range values (Req 2.1, 2.3, 2.4)
      const clamped = clampMetrics(rawMetrics);

      return {
        ...task,
        metrics: clamped,
      };
    });

    // 4. Normalize effort percentages to sum to 100 (Req 2.2)
    const effortValues = analyzedTasks.map((t) => t.metrics.effortPercentage);
    const normalizedEffort = normalizeEffort(effortValues);
    for (let i = 0; i < analyzedTasks.length; i++) {
      analyzedTasks[i].metrics.effortPercentage = normalizedEffort[i];
    }

    // 5. Strip invalid dependency references (Req 2.5)
    const invalidRefs = validateDependencyRefs(analyzedTasks);
    if (invalidRefs.length > 0) {
      const invalidSet = new Set(invalidRefs);
      for (const task of analyzedTasks) {
        task.metrics.dependsOn = task.metrics.dependsOn.filter(
          (id) => !invalidSet.has(id),
        );
      }
    }

    // Also strip self-references
    for (const task of analyzedTasks) {
      task.metrics.dependsOn = task.metrics.dependsOn.filter(
        (id) => id !== task.id,
      );
    }

    // 6. Detect circular dependencies (Req 2.6)
    const circularDependencies = detectCycles(analyzedTasks);

    // 7. Assign categories via AI using per-user categories (Req 16.1, 16.2, 16.3, 16.4)
    if (this.categoryAssigner && this.categoryRepo) {
      const activeCategories = this.categoryRepo.getActiveNamesByUserId(userId);
      const activeCategoryCount = this.categoryRepo.countActiveByUserId(userId);

      for (const analyzedTask of analyzedTasks) {
        const assignmentResult = await this.categoryAssigner.assign(
          analyzedTask.description,
          activeCategories,
          activeCategoryCount,
          analyzedTask.rawText,
        );

        const categoryEntity = this.categoryRepo.create(
          assignmentResult.finalCategory,
          userId,
          assignmentResult.source === "llm" ? "llm" : "fallback",
        );

        analyzedTask.category = categoryEntity.name;
        analyzedTask.categoryId = categoryEntity.id;
        analyzedTask.categoryConfidence = assignmentResult.confidence;
      }
    }

    return {
      tasks: analyzedTasks,
      circularDependencies,
    };
  }

  // -----------------------------------------------------------------------
  // LLM interaction
  // -----------------------------------------------------------------------

  private async callLLM(
    taskInput: Array<{ id: string; description: string }>,
    behavioralModel: BehavioralModel,
    strict: boolean,
  ): Promise<LLMTaskMetrics[] | null> {
    try {
      const userContent = JSON.stringify(taskInput, null, 2);

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        strict
          ? [
              {
                role: "user",
                content: `${STRICT_RETRY_PROMPT}\n\n${userContent}`,
              },
            ]
          : [
              {
                role: "system",
                content: buildSystemPrompt(behavioralModel),
              },
              { role: "user", content: userContent },
            ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.3,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = this.extractJSON(content);
      if (!parsed) {
        return null;
      }

      return this.validateLLMResponse(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Try to extract a JSON object from the LLM response string.
   * Handles cases where the LLM wraps JSON in markdown code fences.
   */
  private extractJSON(raw: string): unknown | null {
    const trimmed = raw.trim();

    // Try direct parse first
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }

    // Strip markdown code fences and retry
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }

    return null;
  }

  /**
   * Validate that the parsed JSON conforms to the expected shape.
   */
  private validateLLMResponse(data: unknown): LLMTaskMetrics[] | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.tasks)) {
      return null;
    }

    const tasks: LLMTaskMetrics[] = [];

    for (const item of obj.tasks) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const t = item as Record<string, unknown>;

      if (typeof t.id !== "string") {
        continue;
      }

      tasks.push({
        id: t.id,
        priority: typeof t.priority === "number" ? t.priority : 3,
        effortPercentage:
          typeof t.effortPercentage === "number" ? t.effortPercentage : 10,
        difficultyLevel:
          typeof t.difficultyLevel === "number" ? t.difficultyLevel : 3,
        estimatedTime:
          typeof t.estimatedTime === "number" ? t.estimatedTime : 30,
        dependsOn: Array.isArray(t.dependsOn)
          ? t.dependsOn.filter((d): d is string => typeof d === "string")
          : [],
      });
    }

    return tasks.length > 0 ? tasks : null;
  }

  // -----------------------------------------------------------------------
  // Fallback helpers
  // -----------------------------------------------------------------------

  /**
   * Build a result with default metrics when the LLM fails entirely.
   */
  private buildDefaultResult(tasks: ParsedTask[]): AnalysisResult {
    const equalEffort = normalizeEffort(tasks.map(() => 1));

    const analyzedTasks: AnalyzedTask[] = tasks.map((task, i) => ({
      ...task,
      metrics: {
        priority: 3,
        effortPercentage: equalEffort[i],
        difficultyLevel: 3,
        estimatedTime: 30,
        dependsOn: [],
      },
    }));

    return {
      tasks: analyzedTasks,
      circularDependencies: [],
    };
  }

  /**
   * Default metrics for a single task when the LLM didn't return data for it.
   */
  private defaultMetrics(totalTasks: number): TaskMetrics {
    return {
      priority: 3,
      effortPercentage: totalTasks > 0 ? 100 / totalTasks : 100,
      difficultyLevel: 3,
      estimatedTime: 30,
      dependsOn: [],
    };
  }
}
