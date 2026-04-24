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

// --- Category Entities ---

export interface CategoryEntity {
  id: number;
  name: string;
  userId: string;
  status: "active" | "merged" | "archived";
  createdBy: "llm" | "user" | "system" | "fallback";
  mergedIntoCategoryId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAssignmentResult {
  /** The raw string returned by the LLM, or null if fallback was used */
  rawLLMCategory: string | null;
  /** The resolved category name (existing or newly created) */
  finalCategory: string;
  /** Whether the LLM proposed a new category (not in the existing list) */
  isNew: boolean;
  /** LLM confidence score 0.0-1.0, or 0.0 for fallback */
  confidence: number;
  /** How the category was assigned */
  source: "llm" | "fallback";
  /** When confidence < 0.5 and isNew, the closest existing category */
  closestExisting: string | null;
  /** Whether the assignment is flagged as low confidence */
  lowConfidence: boolean;
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
  /** Final category name from AI assignment or fallback */
  category?: string;
  /** Foreign key to categories table */
  categoryId?: number;
  /** LLM confidence score for the category assignment (0.0-1.0) */
  categoryConfidence?: number;
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
  /** The AI-assigned category name (from task analysis). When provided, used directly instead of keyword normalization. */
  category?: string | null;
  /** The category_id foreign key (from task analysis). When provided, used directly for completion_history. */
  categoryId?: number | null;
  /** minutes */
  estimatedTime: number;
  /** minutes */
  actualTime: number;
  /** 1-5 */
  difficultyLevel: number;
  completedAt: Date;
  /** The raw category string returned by the LLM (before resolution), or null if fallback */
  rawLLMCategory?: string | null;
  /** LLM confidence score for the category assignment (0.0-1.0) */
  categoryConfidence?: number | null;
  /** How the category was assigned: 'llm', 'fallback', or 'user' */
  categorySource?: "llm" | "fallback" | "user" | null;
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

// --- Extended Analytics (Analytics Dashboard Redesign) ---

// --- Category Consolidation ---

export type SuggestionAction = "merge" | "rename" | "split";

export interface ConsolidationSuggestion {
  id: string; // UUID for tracking
  action: SuggestionAction;
  // For merge:
  sourceCategoryId?: number;
  sourceCategoryName?: string;
  targetCategoryId?: number;
  targetCategoryName?: string;
  // For rename / split:
  categoryId?: number;
  currentName?: string;
  // For rename:
  proposedName?: string;
  // For split:
  proposedNames?: string[];
  // Common:
  reason: string;
}

/**
 * @deprecated Categories are now dynamic and AI-driven per user.
 * This type is retained only for backward compatibility with the keyword normalizer fallback.
 * Use dynamic category names from the CategoryEntity instead.
 */
export type CanonicalCategory =
  | "Writing"
  | "Development"
  | "Design"
  | "Research"
  | "Admin"
  | "Communication"
  | "Planning"
  | "Testing"
  | "Learning"
  | "Other";

/** Weekly aggregation bucket for trend analysis */
export interface WeeklyTrendPoint {
  weekStart: string; // ISO date of Monday
  weekEnd: string; // ISO date of Sunday
  tasksCompleted: number;
  totalActualTime: number;
  avgActualTime: number;
  avgEstimatedTime: number;
  estimationAccuracy: number; // 0-1
  avgAbsolutePercentError: number; // 0-100
}

/** Per-category performance stats */
export interface CategoryPerformanceStat {
  category: string; // canonical category
  avgEstimatedTime: number;
  avgActualTime: number;
  avgTimeOverrun: number; // actual - estimated, in minutes
  sampleSize: number;
}

/** A natural language behavioral insight */
export interface BehavioralInsight {
  text: string;
  magnitude: number; // for ordering by significance
  type: "underestimation" | "speed-improvement" | "accuracy-improvement";
  category: string;
}

/** Per-difficulty-level calibration stats */
export interface DifficultyCalibrationStat {
  difficultyLevel: number; // 1-5
  avgEstimatedTime: number;
  avgActualTime: number;
  avgTimeOverrun: number;
  taskCount: number;
}

/** A recent behavioral change for a category */
export interface CategoryChange {
  category: string;
  percentageChange: number; // negative = faster, positive = slower
  recentAvgTime: number;
  previousAvgTime: number;
}

/** A task with a large time overrun */
export interface OverrunTask {
  description: string;
  estimatedTime: number;
  actualTime: number;
  overrunMinutes: number;
}

/** Extended analytics summary — superset of AnalyticsSummary */
export interface ExtendedAnalyticsSummary extends AnalyticsSummary {
  // New fields (all optional for backward compatibility)
  kpis?: {
    totalCompleted: number;
    completionRate: number; // percentage
    avgEstimatedTime: number;
    avgActualTime: number;
    estimationAccuracy: number; // percentage
    topImprovingCategory: string | null;
    mostDelayedCategory: string | null;
  };
  weeklyTrends?: WeeklyTrendPoint[];
  categoryPerformance?: {
    stats: CategoryPerformanceStat[];
    consistentlyFaster: string[]; // category names
    consistentlySlower: string[]; // category names
  };
  insights?: BehavioralInsight[];
  estimationAccuracyTrend?: {
    weeklyAccuracy: WeeklyTrendPoint[];
    trendLabel: "Improving" | "Stable" | "Declining";
  };
  difficultyCalibration?: DifficultyCalibrationStat[];
  recentChanges?: {
    fasterCategories: CategoryChange[];
    slowerCategories: CategoryChange[];
    largestOverruns: OverrunTask[];
    limitedDataCategories: string[];
  };
  dataStatus?: {
    totalCompletedTasks: number;
    weeksOfData: number;
    daysOfData: number;
  };
  timeAllocation?: TimeAllocationEntry[];
  estimationErrors?: EstimationErrorStats;
  dayOfWeekPatterns?: DayOfWeekPattern[];
  speedInsights?: {
    fastest: CategorySpeedInsight[];
    slowest: CategorySpeedInsight[];
    quickWins: CategorySpeedInsight[];
    consistentOverruns: CategorySpeedInsight[];
  };
  aiLearningProgress?: CategoryLearningStatus[];
  productivityConsistency?: ProductivityConsistency;
  anomalies?: AnomalyEntry[];
  periodComparison?: PeriodComparison;
  recommendations?: Recommendation[];
}

// --- New analytics types ---

/** Time allocation breakdown by category */
export interface TimeAllocationEntry {
  category: string;
  totalActualTime: number;
  totalEstimatedTime: number;
  percentOfTotal: number; // 0-100
  taskCount: number;
}

/** Estimation error details */
export interface EstimationErrorStats {
  avgErrorPercent: number; // average absolute error %
  overestimationCount: number; // tasks where estimated > actual
  underestimationCount: number; // tasks where estimated < actual
  biggestOverruns: OverrunTask[]; // top 5 tasks that took longest vs estimate
  biggestUnderruns: {
    description: string;
    estimatedTime: number;
    actualTime: number;
    savedMinutes: number;
  }[];
  errorByCategory: {
    category: string;
    avgErrorPercent: number;
    sampleSize: number;
  }[];
}

/** Day-of-week pattern entry */
export interface DayOfWeekPattern {
  dayName: string; // "Monday", "Tuesday", etc.
  dayIndex: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  tasksCompleted: number;
  avgActualTime: number;
  avgEstimatedTime: number;
  estimationAccuracy: number; // 0-100
}

/** Category speed insight */
export interface CategorySpeedInsight {
  category: string;
  avgActualTime: number;
  avgEstimatedTime: number;
  avgRatio: number; // actual/estimated ratio
  sampleSize: number;
}

/** AI learning progress for a category */
export interface CategoryLearningStatus {
  category: string;
  sampleSize: number;
  maturity: "new" | "learning" | "ready"; // <3 = new, 3-9 = learning, 10+ = ready
  hasPersonalization: boolean; // sampleSize >= 10
  recentAccuracyTrend: "improving" | "stable" | "declining" | "insufficient";
}

/** Productivity consistency metrics */
export interface ProductivityConsistency {
  weeklyScores: {
    weekStart: string;
    tasksCompleted: number;
    totalTime: number;
  }[];
  avgWeeklyTasks: number;
  taskVariancePercent: number; // coefficient of variation
  consistencyLabel:
    | "very-consistent"
    | "consistent"
    | "variable"
    | "highly-variable";
}

/** An anomalous task or category */
export interface AnomalyEntry {
  type: "slow-task" | "category-spike" | "unusual-duration";
  description: string;
  category: string;
  actualTime: number;
  expectedTime: number; // category average or estimated
  deviationPercent: number;
  completedAt: string;
}

/** Period comparison data */
export interface PeriodComparison {
  current: {
    tasksCompleted: number;
    totalActualTime: number;
    avgActualTime: number;
    estimationAccuracy: number;
  };
  previous: {
    tasksCompleted: number;
    totalActualTime: number;
    avgActualTime: number;
    estimationAccuracy: number;
  };
  deltas: {
    tasksCompleted: number;
    totalActualTime: number;
    avgActualTime: number;
    estimationAccuracy: number;
  };
  mostChangedCategory: { category: string; changePercent: number } | null;
}

/** Category drill-down detail */
export interface CategoryDrillDown {
  category: string;
  totalTasks: number;
  totalActualTime: number;
  totalEstimatedTime: number;
  avgActualTime: number;
  avgEstimatedTime: number;
  avgOverrun: number;
  recentTasks: {
    description: string;
    estimatedTime: number;
    actualTime: number;
    completedAt: string;
  }[];
  weeklyTrend: {
    weekStart: string;
    avgActualTime: number;
    avgEstimatedTime: number;
    taskCount: number;
  }[];
  speedTrend: "improving" | "stable" | "declining" | "insufficient";
}

/** Actionable recommendation */
export interface Recommendation {
  id: string;
  text: string;
  type:
    | "buffer"
    | "improvement"
    | "overestimation"
    | "consistency"
    | "learning";
  category?: string;
  priority: "high" | "medium" | "low";
}
