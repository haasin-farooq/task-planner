// ============================================================
// Client-side TypeScript interfaces for AI Daily Task Planner
// Mirrors the server types needed by client components.
// ============================================================

export type PrioritizationStrategy =
  | "least-effort-first"
  | "hardest-first"
  | "highest-priority-first"
  | "dependency-aware";

export interface ParsedTask {
  id: string;
  rawText: string;
  description: string;
  isAmbiguous: boolean;
  /** ID of compound task this was split from */
  splitFrom?: string;
}

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

// --- Analytics ---

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

// --- New analytics types ---

/** Time allocation breakdown by category */
export interface TimeAllocationEntry {
  category: string;
  totalActualTime: number;
  totalEstimatedTime: number;
  percentOfTotal: number;
  taskCount: number;
}

/** Estimation error details */
export interface EstimationErrorStats {
  avgErrorPercent: number;
  overestimationCount: number;
  underestimationCount: number;
  biggestOverruns: OverrunTask[];
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
  dayName: string;
  dayIndex: number;
  tasksCompleted: number;
  avgActualTime: number;
  avgEstimatedTime: number;
  estimationAccuracy: number;
}

/** Category speed insight */
export interface CategorySpeedInsight {
  category: string;
  avgActualTime: number;
  avgEstimatedTime: number;
  avgRatio: number;
  sampleSize: number;
}

/** AI learning progress for a category */
export interface CategoryLearningStatus {
  category: string;
  sampleSize: number;
  maturity: "new" | "learning" | "ready";
  hasPersonalization: boolean;
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
  taskVariancePercent: number;
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
  expectedTime: number;
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
