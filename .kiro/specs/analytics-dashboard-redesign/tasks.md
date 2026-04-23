# Implementation Plan: Analytics Dashboard Redesign

## Overview

This plan transforms the existing flat analytics view into a rich behavioral insights dashboard. Work proceeds backend-first (types, utilities, schema, aggregator extensions), then frontend (new types, Recharts setup, decomposed components), and finally wiring and integration. Each task builds incrementally on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Define shared TypeScript interfaces for extended analytics
  - [x] 1.1 Add new interfaces to `server/src/types/index.ts`
    - Add `CanonicalCategory` type union
    - Add `WeeklyTrendPoint`, `CategoryPerformanceStat`, `BehavioralInsight`, `DifficultyCalibrationStat`, `CategoryChange`, `OverrunTask` interfaces
    - Add `ExtendedAnalyticsSummary` interface that extends the existing `AnalyticsSummary` with optional `kpis`, `weeklyTrends`, `categoryPerformance`, `insights`, `estimationAccuracyTrend`, `difficultyCalibration`, `recentChanges`, and `dataStatus` fields
    - Preserve all existing types unchanged for backward compatibility
    - _Requirements: 2.1–2.6, 3.1–3.3, 4.1–4.4, 5.1–5.5, 6.1–6.3, 7.1–7.3, 8.1–8.4, 10.7_
  - [x] 1.2 Mirror new analytics interfaces in `client/src/types/index.ts`
    - Add the same new interfaces (`WeeklyTrendPoint`, `CategoryPerformanceStat`, `BehavioralInsight`, `DifficultyCalibrationStat`, `CategoryChange`, `OverrunTask`, `ExtendedAnalyticsSummary`) to the client types
    - Preserve all existing client types unchanged
    - _Requirements: 2.1–2.6, 3.1–3.3, 4.1–4.4, 5.1–5.5, 6.1–6.3, 7.1–7.3, 8.1–8.4_

- [x] 2. Implement CategoryNormalizer utility
  - [x] 2.1 Create `server/src/utils/category-normalizer.ts`
    - Implement the `CATEGORY_MAPPINGS` static mapping table with keywords for Writing, Development, Design, Research, Admin, Communication, Planning, Testing, Learning
    - Implement `normalize(rawCategory: string): CanonicalCategory` — lowercase, trim, substring match against keywords, return first match or "Other"
    - Implement `backfill(db: Database): void` — query all `completion_history` rows where `normalized_category IS NULL`, normalize each, and update in batch
    - Export the normalizer as a singleton or class
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_
  - [x] 2.2 Write unit tests for CategoryNormalizer
    - Test keyword matching for each canonical category
    - Test case-insensitive matching (e.g., "WRITING" → "Writing")
    - Test unmatched input returns "Other"
    - Test whitespace trimming
    - Test backfill updates rows with NULL normalized_category
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [x] 3. Add schema migration for `normalized_category` column
  - [x] 3.1 Update `server/src/db/schema.ts` to add migration
    - Add an `ALTER TABLE completion_history ADD COLUMN normalized_category TEXT DEFAULT NULL` migration step inside `runMigrations`
    - Use a try/catch or column-existence check so the migration is idempotent (safe to re-run)
    - After adding the column, call `CategoryNormalizer.backfill(db)` to populate existing records
    - _Requirements: 1.6, 1.7_
  - [x] 3.2 Write unit tests for schema migration
    - Test that `normalized_category` column exists after migration
    - Test that backfill populates normalized_category for existing records
    - Test that original `category` column values are preserved after backfill
    - _Requirements: 1.6, 1.7_

- [x] 4. Implement trend analysis utilities
  - [x] 4.1 Create `server/src/utils/trend-analysis.ts`
    - Implement `linearRegressionSlope(values: number[]): number` — simple linear regression on (index, value) pairs
    - Implement `classifyTrend(slope: number, threshold?: number): "Improving" | "Stable" | "Declining"` — classify slope against a configurable threshold
    - Implement `estimationAccuracy(estimated: number, actual: number): number` — compute `1 - |actual - estimated| / estimated`, clamped to [0, 1], return 0 when estimated is 0
    - _Requirements: 6.3_
  - [x] 4.2 Write unit tests for trend analysis utilities
    - Test linear regression with known slopes (positive, negative, flat)
    - Test trend classification for improving, stable, and declining cases
    - Test estimation accuracy clamping to [0, 1]
    - Test estimation accuracy with zero estimated time
    - _Requirements: 6.3_

- [x] 5. Checkpoint — Ensure all backend utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend AnalyticsAggregator with new computations
  - [x] 6.1 Add InsightGenerator functions to `server/src/services/analytics-aggregator.ts`
    - Implement `detectUnderestimation(stats)` — find categories with avg time overrun > 15% across ≥ 5 tasks, produce natural language insight strings
    - Implement `detectSpeedImprovements(weeklyByCategory)` — find categories with decreasing avg actual time over last 4 weeks
    - Implement `detectAccuracyImprovements(weeklyByCategory)` — find categories with increasing estimation accuracy over last 4 weeks
    - Implement `generateInsights(stats, weeklyByCategory)` — combine, rank by magnitude, return top 5
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 6.2 Extend `getSummary` to compute and return `ExtendedAnalyticsSummary`
    - Add KPI computation: totalCompleted, completionRate, avgEstimatedTime, avgActualTime, estimationAccuracy, topImprovingCategory, mostDelayedCategory
    - Add weekly trend aggregation: group completion_history by ISO week for last 8 weeks, compute tasksCompleted, totalActualTime, avgActualTime, avgEstimatedTime, estimationAccuracy per week
    - Add category performance: query by `normalized_category`, compute avg estimated/actual/overrun per category, determine consistentlyFaster and consistentlySlower lists (≥ 3 tasks, 10% threshold)
    - Add estimation accuracy trend: weekly accuracy data + linear regression trend label
    - Add difficulty calibration: per-difficulty-level stats (avg estimated, actual, overrun, count)
    - Add recent changes: compare last 2 weeks vs preceding 4 weeks per category, find largest overruns, identify limited-data categories
    - Add dataStatus: totalCompletedTasks, weeksOfData, daysOfData
    - Use `normalized_category` for all category grouping queries
    - Preserve existing `AnalyticsSummary` fields unchanged in the response
    - _Requirements: 1.5, 2.1–2.7, 3.1–3.3, 4.1–4.5, 5.1–5.6, 6.1–6.4, 7.1–7.4, 8.1–8.5, 9.1–9.3, 10.7_
  - [x] 6.3 Write unit tests for extended AnalyticsAggregator
    - Test KPI computation with known data
    - Test weekly trend aggregation produces correct week buckets
    - Test category performance uses normalized_category
    - Test insight generation produces expected insight strings
    - Test estimation accuracy trend label classification
    - Test difficulty calibration stats
    - Test recent changes detection (faster/slower categories)
    - Test backward compatibility: existing AnalyticsSummary fields still present
    - _Requirements: 2.1–2.7, 3.1–3.3, 4.1–4.5, 5.1–5.6, 6.1–6.4, 7.1–7.4, 8.1–8.5, 10.7_

- [x] 7. Integrate CategoryNormalizer into AdaptiveLearningEngine
  - [x] 7.1 Update `server/src/services/adaptive-learning-engine.ts`
    - Import and use `CategoryNormalizer.normalize()` in `recordCompletion` to populate `normalized_category` when inserting into `completion_history`
    - Preserve the original raw `category` value in the existing column
    - _Requirements: 1.1, 1.7_

- [x] 8. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Install Recharts and create chart wrapper components
  - [x] 9.1 Install Recharts dependency in `client/`
    - Run `npm install recharts` in the `client/` directory
    - _Requirements: 3.5, 10.5_
  - [x] 9.2 Create `client/src/components/analytics/TrendChart.tsx`
    - Implement a thin wrapper around Recharts `ResponsiveContainer` + `LineChart`
    - Accept `data`, `ariaLabel`, `height`, `showSecondaryLine`, `valueLabel`, `secondaryLabel`, `formatValue` props
    - Style with warm editorial design: white background, warm border, orange accent primary line, warm gray secondary line
    - Include `XAxis`, `YAxis`, `Tooltip`, `Legend` (when secondary line shown), dot markers
    - Add `aria-label` on the container for accessibility
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.2, 10.5, 11.1_
  - [x] 9.3 Create `client/src/components/analytics/BarChart.tsx`
    - Implement a thin wrapper around Recharts `ResponsiveContainer` + `BarChart`
    - Accept `data`, `ariaLabel`, `maxValue`, `layout` props
    - Style bars with orange accent (highlighted) or warm gray (normal)
    - Include `XAxis`, `YAxis`, `Tooltip` with warm styling
    - Add `aria-label` on the container for accessibility
    - _Requirements: 4.1, 10.2, 10.5, 11.1_

- [x] 10. Create LowDataState component
  - [x] 10.1 Create `client/src/components/analytics/LowDataState.tsx`
    - Accept `current`, `required`, `unit`, `sectionName` props
    - Render a warm editorial-styled message with cream background (`#FFF8F0`), orange accent, and Lora serif heading
    - Show progress indicator: "X of Y {unit} — Z more to unlock {sectionName}"
    - Handle zero-data welcome state when `current` is 0
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 11. Create dashboard section components
  - [x] 11.1 Create `client/src/components/analytics/KPIPanel.tsx`
    - Accept `kpis`, `insufficientData`, `totalCompleted` props
    - Render 6 KPI cards: total completed, completion rate, avg estimated time, avg actual time, estimation accuracy, top improving / most delayed category
    - Use inline SVG/CSS for micro-visuals (trend arrows, mini progress rings) only
    - Display low-data state via `LowDataState` when `totalCompleted < 5`
    - Horizontal row layout on desktop (≥768px), stacked on mobile
    - Use cream background, orange accents, Lora serif for headings
    - _Requirements: 2.1–2.7, 9.1, 9.2, 9.4, 10.2, 10.3, 10.4, 11.3_
  - [x] 11.2 Create `client/src/components/analytics/WeeklyTrends.tsx`
    - Accept `weeklyTrends`, `weeksOfData` props
    - Render 3 `TrendChart` instances: tasks/week, total time/week, actual vs estimated/week
    - Show `LowDataState` when `weeksOfData < 2`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 11.1, 11.5_
  - [x] 11.3 Create `client/src/components/analytics/CategoryPerformance.tsx`
    - Accept `stats`, `consistentlyFaster`, `consistentlySlower` props
    - Render a semantic HTML table with columns: category, avg estimated, avg actual, avg overrun, sample size
    - Default sort by avg overrun descending
    - Render "Consistently Faster" and "Consistently Slower" lists
    - Show insufficient-data indicator for categories with < 3 tasks
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 11.3_
  - [x] 11.4 Create `client/src/components/analytics/InsightsPanel.tsx`
    - Accept `insights`, `totalCompleted` props
    - Render up to 5 insight cards with natural language text
    - Show `LowDataState` when `totalCompleted < 10`
    - _Requirements: 5.5, 5.6, 9.1_
  - [x] 11.5 Create `client/src/components/analytics/EstimationAccuracy.tsx`
    - Accept `weeklyAccuracy`, `trendLabel`, `weeksOfData` props
    - Render 2 `TrendChart` instances: weekly accuracy %, weekly error %
    - Display trend label badge ("Improving" / "Stable" / "Declining")
    - Show `LowDataState` when `weeksOfData < 2`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 11.1_
  - [x] 11.6 Create `client/src/components/analytics/DifficultyCalibration.tsx`
    - Accept `calibration` props
    - Render a semantic HTML table: difficulty level, avg estimated, avg actual, avg overrun, task count
    - Highlight rows where actual exceeds estimated by > 20%
    - Show correlation indicator
    - Show insufficient-data indicator for levels with < 3 tasks
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 11.3_
  - [x] 11.7 Create `client/src/components/analytics/RecentChanges.tsx`
    - Accept `fasterCategories`, `slowerCategories`, `largestOverruns`, `limitedDataCategories`, `daysOfData` props
    - Render faster/slower category lists with percentage change
    - Render top 5 overrun tasks with description, estimated, actual, overrun
    - Render limited-data categories list
    - Show `LowDataState` when `daysOfData < 14`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1_

- [x] 12. Checkpoint — Ensure all component files compile without errors
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Refactor AnalyticsDashboard to compose new sub-components
  - [x] 13.1 Refactor `client/src/components/AnalyticsDashboard.tsx`
    - Update the fetch call to type the response as `ExtendedAnalyticsSummary`
    - Keep the existing `DateRangeSelector` inline sub-component
    - Replace the existing inline chart/table sub-components (`DailyCompletionChart`, `TimeComparison`, `DifficultyBreakdownDisplay`, `PerformanceInsights`) with the new decomposed components
    - Render sections in order: KPIPanel → WeeklyTrends → CategoryPerformance → InsightsPanel → EstimationAccuracy → DifficultyCalibration → RecentChanges
    - Pass data from `ExtendedAnalyticsSummary` to each sub-component via props
    - Conditionally render each section only when its data is present (optional fields)
    - Preserve the existing insufficient-data banner for backward compatibility
    - Handle the zero-completed-tasks welcome state
    - Apply warm editorial design system: cream backgrounds, orange accents, Lora serif headings
    - Ensure all sections have proper `aria-label` attributes and semantic HTML
    - _Requirements: 9.3, 10.1, 10.2, 10.3, 10.4, 10.6, 11.1, 11.2, 11.3, 11.4_
  - [x] 13.2 Write unit tests for refactored AnalyticsDashboard
    - Test that all sections render when full data is provided
    - Test that sections are hidden when optional data is absent (backward compatibility)
    - Test low-data states render correctly for each section
    - Test date range selector updates trigger re-fetch
    - Test accessibility: aria-labels present, semantic HTML used
    - _Requirements: 9.1, 9.2, 9.3, 10.1, 10.7, 11.1, 11.2, 11.3_

- [x] 14. Final checkpoint — Ensure all tests pass and build succeeds
  - Run `npm run build` in both `client/` and `server/` directories
  - Run `npm test` in both `client/` and `server/` directories
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Recharts is used for all main chart visualizations; only micro-visuals (KPI trend arrows, mini progress rings) use inline SVG/CSS
- The `ExtendedAnalyticsSummary` extends the existing `AnalyticsSummary` with all new fields as optional, preserving full backward compatibility
- The original `category` column in `completion_history` is never modified — `normalized_category` is added alongside it
