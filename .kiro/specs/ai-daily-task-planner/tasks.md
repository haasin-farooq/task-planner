# Implementation Plan: AI Daily Task Planner

## Overview

This plan implements the AI Daily Task Planner as a full-stack TypeScript application with a React frontend, Node.js/Express backend, SQLite database, and OpenAI LLM integration. Tasks are ordered so each step builds on the previous, starting with project scaffolding and core data models, then backend logic, API layer, frontend components, and finally integration wiring. Property-based tests use fast-check and are placed close to the components they validate.

## Tasks

- [ ] 1. Project scaffolding and database setup
  - [x] 1.1 Initialize monorepo with TypeScript, React frontend (Vite), and Node.js/Express backend
    - Create top-level project structure with `client/` and `server/` directories
    - Configure `tsconfig.json` for both client and server
    - Install dependencies: express, better-sqlite3, openai, uuid for server; react, react-dom, axios for client
    - Install dev dependencies: vitest, fast-check, @testing-library/react
    - _Requirements: N/A (scaffolding)_

  - [x] 1.2 Create SQLite database schema and migration script
    - Implement `server/src/db/schema.ts` with all CREATE TABLE statements from the design (users, preference_profiles, task_sessions, tasks, task_dependencies, completion_history, behavioral_adjustments)
    - Create `server/src/db/connection.ts` for database initialization and connection management
    - Include all CHECK constraints (priority 1-5, difficulty 1-5, effort 0-100)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.3 Define shared TypeScript interfaces and types
    - Create `server/src/types/index.ts` with all interfaces from the design: ParsedTask, ParseResult, TaskMetrics, AnalyzedTask, AnalysisResult, CompletionRecord, BehavioralModel, CategoryAdjustment, AnalyticsSummary, DailyCompletionStat, DifficultyBreakdown, PerformanceCategory, PreferenceProfile, PrioritizationStrategy
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1_

- [ ] 2. Implement core validation and utility functions
  - [x] 2.1 Implement metrics validation function
    - Create `server/src/utils/validation.ts`
    - Implement `validateTaskMetrics(metrics: TaskMetrics): boolean` that checks priority in [1,5], difficultyLevel in [1,5], estimatedTime > 0
    - Implement `clampMetrics(metrics: TaskMetrics): TaskMetrics` that clamps out-of-range values
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 2.2 Write property test for metrics validation (Property 1)
    - **Property 1: Task metrics are in valid ranges**
    - Generate random metric objects with values inside and outside valid ranges; verify validation correctly accepts/rejects
    - **Validates: Requirements 2.1, 2.3, 2.4**

  - [x] 2.3 Implement effort normalization function
    - Create `server/src/utils/effort-normalization.ts`
    - Implement `normalizeEffort(values: number[]): number[]` that scales an array of positive numbers so they sum to exactly 100
    - Handle edge cases: single task gets 100%, zero values, negative values
    - _Requirements: 2.2_

  - [x] 2.4 Write property test for effort normalization (Property 2)
    - **Property 2: Effort percentages sum to 100**
    - Generate random arrays of positive numbers; verify normalized output sums to 100 (±0.01 tolerance)
    - **Validates: Requirements 2.2**

  - [x] 2.5 Implement dependency validation and cycle detection
    - Create `server/src/utils/dependency-graph.ts`
    - Implement `validateDependencyRefs(tasks: AnalyzedTask[]): string[]` that returns invalid dependency IDs
    - Implement `detectCycles(tasks: AnalyzedTask[]): CircularDependencyError[]` using DFS-based cycle detection
    - Implement `getUnblockedTasks(tasks: AnalyzedTask[], completedIds: Set<string>): AnalyzedTask[]` that returns tasks whose dependencies are all completed
    - _Requirements: 2.5, 2.6, 8.4_

  - [x] 2.6 Write property test for dependency reference validation (Property 3)
    - **Property 3: Dependency references are valid**
    - Generate random task lists with random dependency references; verify validator catches all invalid refs
    - **Validates: Requirements 2.5**

  - [x] 2.7 Write property test for circular dependency detection (Property 4)
    - **Property 4: Circular dependency detection**
    - Generate random directed graphs (some with cycles, some DAGs); verify detector correctly identifies cycles and reports none for DAGs
    - **Validates: Requirements 2.6**

  - [x] 2.8 Write property test for task completion unblocking (Property 13)
    - **Property 13: Task completion unblocks dependents**
    - Generate random DAGs with some tasks completed; verify unblocked set is exactly those tasks whose every dependency is completed
    - **Validates: Requirements 8.4**

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement Task Organizer (client-side sorting)
  - [x] 4.1 Implement TaskOrganizer with all four prioritization strategies
    - Create `client/src/utils/task-organizer.ts`
    - Implement `orderTasks(tasks: AnalyzedTask[], strategy: PrioritizationStrategy): AnalyzedTask[]`
    - Implement "least-effort-first": ascending by effortPercentage, tiebreak by descending priority
    - Implement "hardest-first": descending by difficultyLevel, tiebreak by descending priority
    - Implement "highest-priority-first": descending by priority, tiebreak by descending priority (stable)
    - Implement "dependency-aware": topological sort respecting dependency edges
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.2 Write property test for strategy-based sorting (Property 5)
    - **Property 5: Strategy-based sorting correctness**
    - Generate random task arrays with random metrics; for each of the three simple strategies, verify output is correctly ordered with priority tiebreaker
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6**

  - [x] 4.3 Write property test for dependency-aware ordering (Property 6)
    - **Property 6: Dependency-aware ordering respects dependencies**
    - Generate random DAGs; verify output is a valid topological sort where no task appears before its dependencies
    - **Validates: Requirements 4.5**

- [x] 5. Implement Preference Profile Store
  - [x] 5.1 Implement PreferenceProfileStore with SQLite persistence
    - Create `server/src/services/preference-profile-store.ts`
    - Implement `get(userId: string): PreferenceProfile | null` — returns saved profile or null
    - Implement `save(userId: string, strategy: PrioritizationStrategy): void` — upserts preference
    - Default to "highest-priority-first" when no profile exists
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 Write property test for preference round-trip (Property 7)
    - **Property 7: Preference profile round-trip**
    - Generate random valid strategies; save then load and verify the returned strategy matches
    - **Validates: Requirements 5.1, 5.3**

  - [x] 5.3 Write unit tests for preference defaults
    - Test that `get()` returns null for non-existent user
    - Test that default strategy is "highest-priority-first" when no profile exists
    - _Requirements: 5.2, 5.4_

- [ ] 6. Implement Adaptive Learning Engine
  - [x] 6.1 Implement AdaptiveLearningEngine with behavioral model tracking
    - Create `server/src/services/adaptive-learning-engine.ts`
    - Implement `recordCompletion(record: CompletionRecord): void` — stores completion in DB and updates behavioral_adjustments
    - Implement `getBehavioralModel(userId: string): BehavioralModel` — reads adjustments from DB, returns default model if no data
    - Implement `resetModel(userId: string): void` — clears all behavioral_adjustments and completion_history for user
    - Calculate timeMultiplier as rolling average of (actualTime / estimatedTime) per category
    - Only apply adjustments when sampleSize >= 10
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.2 Write property test for adaptive learning adjustment direction (Property 8)
    - **Property 8: Adaptive learning adjustment direction**
    - Generate sequences of completion records where user is consistently faster or slower; verify timeMultiplier direction is correct and only applied when 10+ tasks completed
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**

  - [x] 6.3 Write unit test for model reset
    - Test that resetModel clears all adjustments and reverts to defaults
    - _Requirements: 6.6_

- [ ] 7. Implement Analytics Aggregator
  - [x] 7.1 Implement AnalyticsAggregator with dashboard metrics computation
    - Create `server/src/services/analytics-aggregator.ts`
    - Implement `getSummary(userId, startDate, endDate): AnalyticsSummary` — queries completion_history and computes dailyStats, difficultyBreakdown, performanceCategories, insufficientData flag
    - Implement `getDailyProgress(userId, date): number` — returns (completed / total) × 100 for the given date's session
    - Set `insufficientData: true` when fewer than 5 completed tasks in range
    - Label categories as "strength" or "area-for-improvement" based on actual vs estimated time comparison
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]\* 7.2 Write property test for analytics aggregation (Property 9)
    - **Property 9: Analytics aggregation correctness**
    - Generate random completion records; verify daily counts, average times, and difficulty breakdown match expected values
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]\* 7.3 Write property test for performance category labeling (Property 10)
    - **Property 10: Performance category labeling**
    - Generate random category-grouped records; verify "area-for-improvement" when actual > estimated, "strength" when actual < estimated
    - **Validates: Requirements 7.4, 7.5**

  - [ ]\* 7.4 Write property test for daily progress calculation (Property 11)
    - **Property 11: Daily progress calculation**
    - Generate random (total, completed) pairs; verify progress equals (M / N) × 100, and 0% when N = 0
    - **Validates: Requirements 7.6**

  - [ ]\* 7.5 Write property test for insufficient data threshold (Property 12)
    - **Property 12: Insufficient data threshold**
    - Generate random record counts; verify insufficientData is true iff count < 5
    - **Validates: Requirements 7.7**

- [x] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Task Input Parser and Task Analyzer (LLM integration)
  - [x] 9.1 Implement TaskInputParser with LLM-based text parsing
    - Create `server/src/services/task-input-parser.ts`
    - Implement `parse(rawText: string): Promise<ParseResult>` — sends raw text to OpenAI with a structured prompt requesting JSON output
    - Handle empty/whitespace input by returning error message "No tasks detected. Please enter at least one task."
    - Split compound tasks, flag ambiguous items
    - Implement retry logic for malformed LLM responses (1 retry with stricter prompt)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 9.2 Implement TaskAnalyzer with LLM-based metric assignment
    - Create `server/src/services/task-analyzer.ts`
    - Implement `analyze(tasks: ParsedTask[], userId: string): Promise<AnalysisResult>` — fetches behavioral model, sends tasks to OpenAI with adjustment context, validates and normalizes returned metrics
    - Use `validateTaskMetrics` and `clampMetrics` from validation utils
    - Use `normalizeEffort` to ensure effort sums to 100
    - Use `validateDependencyRefs` and `detectCycles` from dependency-graph utils
    - Strip invalid dependency references, flag circular dependencies
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.3_

  - [x] 9.3 Write unit tests for TaskInputParser
    - Test empty input returns error
    - Test that parsed results contain expected fields
    - Test retry logic on malformed LLM response (mock OpenAI client)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 9.4 Write unit tests for TaskAnalyzer
    - Test metrics clamping and normalization on mock LLM output
    - Test circular dependency flagging
    - Test behavioral model integration
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 10. Implement REST API endpoints
  - [x] 10.1 Create Express app with route handlers for all 8 endpoints
    - Create `server/src/app.ts` with Express setup, JSON middleware, error handling
    - Implement `POST /api/tasks/parse` — calls TaskInputParser, returns parsed tasks
    - Implement `POST /api/tasks/analyze` — calls TaskAnalyzer, stores results in DB, returns analyzed tasks
    - Implement `GET /api/tasks/:sessionId` — fetches tasks for a session from DB
    - Implement `PATCH /api/tasks/:taskId/complete` — marks task complete, records actual time, updates behavioral model, returns unblocked tasks
    - Implement `GET /api/preferences/:userId` — returns preference profile (default if none)
    - Implement `PUT /api/preferences/:userId` — saves preference profile
    - Implement `GET /api/analytics/:userId` — returns analytics summary for date range
    - Implement `DELETE /api/learning/:userId` — resets behavioral model
    - Add input validation and error handling for all endpoints
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.1, 5.3, 6.1, 6.6, 7.1, 8.4_

  - [x] 10.2 Write unit tests for API endpoints
    - Test each endpoint with valid and invalid inputs using supertest
    - Test error responses for missing/invalid parameters
    - Test that PATCH complete returns unblocked tasks
    - _Requirements: 1.3, 2.6, 5.4, 8.4_

- [x] 11. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement React frontend components
  - [x] 12.1 Create Task Input UI component
    - Create `client/src/components/TaskInput.tsx`
    - Implement text area for raw task input with submit button
    - Call `POST /api/tasks/parse` on submit
    - Display parsed task list for user review with confirm/edit capability
    - Show error message when no tasks detected
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 12.2 Create Metrics Display component
    - Create `client/src/components/MetricsDisplay.tsx`
    - Display priority, effort percentage, dependency count, difficulty level, and estimated time for each task
    - Show dependency list on task selection
    - Visually distinguish completed tasks (strikethrough or dimmed styling)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1_

  - [x] 12.3 Create Strategy Selector component
    - Create `client/src/components/StrategySelector.tsx`
    - Render dropdown or button group for the 4 prioritization strategies
    - Load saved preference on mount via `GET /api/preferences/:userId`
    - On strategy change, save via `PUT /api/preferences/:userId` and re-sort task list client-side using TaskOrganizer
    - _Requirements: 4.1, 4.7, 5.1, 5.2, 5.3, 5.4_

  - [x] 12.4 Create Analytics Dashboard component
    - Create `client/src/components/AnalyticsDashboard.tsx`
    - Fetch analytics via `GET /api/analytics/:userId` with date range selector
    - Display daily completion chart, average time comparison, difficulty breakdown
    - Display strengths and areas for improvement
    - Show "insufficient data" message when fewer than 5 tasks
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_

  - [x] 12.5 Create Progress and Completion components
    - Create `client/src/components/ProgressIndicator.tsx` — shows daily progress percentage bar
    - Create `client/src/components/CompletionDialog.tsx` — prompts for actual time when marking task complete
    - On task completion: call `PATCH /api/tasks/:taskId/complete`, update progress indicator, show unblocked tasks notification
    - Show completion summary when all tasks are done (total time spent vs total estimated)
    - _Requirements: 6.1, 7.6, 8.1, 8.2, 8.3, 8.4_

  - [x] 12.6 Write unit tests for frontend components
    - Test TaskInput renders and submits correctly
    - Test MetricsDisplay shows all metric fields
    - Test StrategySelector loads saved preference and triggers re-sort
    - Test ProgressIndicator updates on completion
    - Test CompletionDialog captures actual time
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.7, 8.1, 8.2_

- [ ] 13. Wire application together
  - [x] 13.1 Create main App component and routing
    - Create `client/src/App.tsx` with React Router for main view and analytics dashboard
    - Create `client/src/api/client.ts` with typed API client functions for all endpoints
    - Wire TaskInput → MetricsDisplay → StrategySelector → ProgressIndicator flow
    - Add state management for current session, tasks, and active strategy
    - _Requirements: 1.4, 4.1, 5.2_

  - [x] 13.2 Create server entry point and connect all services
    - Create `server/src/index.ts` — initializes database, registers routes, starts Express server
    - Wire TaskInputParser, TaskAnalyzer, TaskOrganizer, AdaptiveLearningEngine, AnalyticsAggregator, PreferenceProfileStore into route handlers
    - Add CORS configuration for frontend-backend communication
    - _Requirements: N/A (wiring)_

  - [ ] 13.3 Write integration tests for end-to-end flows
    - Test parsing flow: raw text → parse → review → analyze → display
    - Test completion flow: mark complete → record time → update model → check unblocked
    - Test analytics flow: multiple completions → query analytics → verify summary
    - _Requirements: 1.1, 1.4, 2.1, 6.1, 7.1, 8.4_

- [x] 14. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major phase
- Property tests validate the 13 universal correctness properties from the design using fast-check
- Unit tests validate specific examples, edge cases, and UI behavior
- The TaskOrganizer lives in the client since sorting is client-side per the design decision
- LLM integration (TaskInputParser, TaskAnalyzer) is deferred to task 9 so all deterministic logic is built and tested first
