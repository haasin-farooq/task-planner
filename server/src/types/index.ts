// ============================================================
// Shared TypeScript interfaces and types for AI Daily Task Planner
// ============================================================

// --- Prioritization Strategy ---

export type PrioritizationStrategy =
  | "least-effort-first"
  | "hardest-first"
  | "highest-priority-first"
  | "dependency-aware";

// --- Task Input Parser ---

export interface ParsedTask {
  id: string;
  rawText: string;
  description: string;
  isAmbiguous: boolean;
  /** ID of compound task this was split from */
  splitFrom?: string;
}

export interface ParseResult {
  tasks: ParsedTask[];
  ambiguousItems: ParsedTask[];
  errors: string[];
}

// --- Task Analyzer ---

export interface TaskMetrics {
  /** 1-5 */
  priority: number;
  /** 0-100, all tasks in a session sum to 100 */
  effortPercentage: number;
  /** 1-5 */
  difficultyLevel: number;
  /** minutes */
  estimatedTime: number;
  /** IDs of tasks this depends on */
  dependsOn: string[];
}

export interface AnalyzedTask extends ParsedTask {
  metrics: TaskMetrics;
}

export interface CircularDependencyError {
  /** Task IDs forming the cycle */
  cycle: string[];
  message: string;
}

export interface AnalysisResult {
  tasks: AnalyzedTask[];
  circularDependencies: CircularDependencyError[];
}

// --- Adaptive Learning Engine ---

export interface CompletionRecord {
  taskId: string;
  userId: string;
  description: string;
  /** minutes */
  estimatedTime: number;
  /** minutes */
  actualTime: number;
  /** 1-5 */
  difficultyLevel: number;
  completedAt: Date;
}

export interface CategoryAdjustment {
  category: string;
  /** < 1 means user is faster, > 1 means slower */
  timeMultiplier: number;
  /** negative means easier, positive means harder */
  difficultyAdjustment: number;
  sampleSize: number;
}

export interface BehavioralModel {
  userId: string;
  totalCompletedTasks: number;
  adjustments: CategoryAdjustment[];
}

// --- Analytics Aggregator ---

export interface DailyCompletionStat {
  date: string;
  tasksCompleted: number;
  avgActualTime: number;
  avgEstimatedTime: number;
}

export interface DifficultyBreakdown {
  difficultyLevel: number;
  count: number;
}

export interface PerformanceCategory {
  category: string;
  avgActualTime: number;
  avgEstimatedTime: number;
  label: "strength" | "area-for-improvement";
}

export interface AnalyticsSummary {
  dailyStats: DailyCompletionStat[];
  difficultyBreakdown: DifficultyBreakdown[];
  performanceCategories: PerformanceCategory[];
  dailyProgressPercent: number;
  insufficientData: boolean;
}

// --- Preference Profile Store ---

export interface PreferenceProfile {
  userId: string;
  strategy: PrioritizationStrategy;
  updatedAt: Date;
}
