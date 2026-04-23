# Implementation Plan: AI Category Assignment

## Overview

Replace the static keyword-based category normalization with an AI-assisted category assignment flow. Implementation proceeds bottom-up: schema migration and data layer first, then the AI category assigner service, followed by integration updates to TaskAnalyzer, AdaptiveLearningEngine, and AnalyticsAggregator, then new API endpoints, and finally type updates for the client.

## Tasks

- [x] 1. Create the categories table and schema migration
  - [x] 1.1 Add `categories` table DDL to `server/src/db/schema.ts`
    - Add CREATE TABLE IF NOT EXISTS for `categories` with `id INTEGER PRIMARY KEY AUTOINCREMENT`, `name TEXT NOT NULL UNIQUE COLLATE NOCASE`, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
    - Add INSERT OR IGNORE statements to seed the 10 canonical categories: Writing, Development, Design, Research, Admin, Communication, Planning, Testing, Learning, Other
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 1.2 Add `category_id` column migration to `completion_history` and `behavioral_adjustments`
    - In `runMigrations()`, add `ALTER TABLE completion_history ADD COLUMN category_id INTEGER REFERENCES categories(id) DEFAULT NULL` if column doesn't exist
    - Add `ALTER TABLE behavioral_adjustments ADD COLUMN category_id INTEGER REFERENCES categories(id) DEFAULT NULL` if column doesn't exist
    - _Requirements: 4.5, 6.3_

  - [x] 1.3 Implement backfill logic for `category_id` on existing rows
    - Backfill `completion_history.category_id` by matching `normalized_category` against `categories.name`
    - Backfill `behavioral_adjustments.category_id` by matching `category` against `categories.name`
    - Ensure backfill is idempotent (only updates rows where `category_id IS NULL`)
    - _Requirements: 4.6, 6.4_

  - [x] 1.4 Write property test for case-insensitive category uniqueness
    - **Property 1: Case-insensitive category uniqueness**
    - **Validates: Requirements 1.3**

  - [x] 1.5 Extend existing schema tests in `server/src/db/__tests__/schema.test.ts`
    - Test migration creates categories table with correct columns
    - Test migration seeds 10 canonical categories
    - Test migration adds category_id to completion_history and behavioral_adjustments
    - Test migration backfills category_id for existing rows
    - Test migration is idempotent (running twice is safe)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.5, 4.6_

- [x] 2. Implement CategoryRepository data access layer
  - [x] 2.1 Create `server/src/db/category-repository.ts`
    - Implement `CategoryRepository` class with constructor accepting `Database.Database`
    - Implement `getAll(): CategoryEntity[]` — returns all categories ordered by name
    - Implement `getAllNames(): string[]` — returns category names as string array
    - Implement `findByName(name: string): CategoryEntity | null` — case-insensitive lookup
    - Implement `findById(id: number): CategoryEntity | null`
    - Implement `upsertByName(name: string): CategoryEntity` — insert or return existing
    - Implement `rename(id: number, newName: string): CategoryEntity` — throws on duplicate or missing ID
    - Implement `delete(id: number): void`
    - _Requirements: 1.1, 1.3, 4.1, 4.2, 9.1, 9.2, 9.3_

  - [x] 2.2 Write property test for category resolution idempotency
    - **Property 5: Category resolution is idempotent**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 2.3 Write unit tests for CategoryRepository in `server/src/db/__tests__/category-repository.test.ts`
    - Test `getAll()` returns categories sorted by name
    - Test `upsertByName()` creates new category and returns existing on duplicate
    - Test `rename()` updates name and throws on duplicate name
    - Test `findByName()` is case-insensitive
    - Test `findById()` returns null for non-existent ID
    - _Requirements: 1.1, 1.3, 4.1, 4.2, 9.1, 9.2, 9.3_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement AICategoryAssigner service
  - [x] 4.1 Create `server/src/services/ai-category-assigner.ts`
    - Implement `AICategoryAssigner` class following the same LLM interaction pattern as `TaskAnalyzer` and `TaskInputParser`
    - Constructor accepts optional `OpenAI` client and model string for testability
    - Implement `assign(description: string, existingCategories: string[]): Promise<CategoryAssignmentResult>`
    - Build system prompt that includes the task description and all existing category names
    - Instruct LLM to prefer existing categories, only propose new ones when none fit
    - Instruct LLM that new names must be at most 3 words, title-cased, general-purpose
    - When `existingCategories.length > 30`, append additional instruction emphasizing reuse
    - Expect JSON response: `{ "category": "...", "isExisting": true/false }`
    - On parse failure, retry once with stricter prompt
    - On total failure, fall back to `normalize(description)` from `category-normalizer.ts`, log warning, set `rawLLMCategory` to `null`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 11.1, 11.2, 11.3, 11.4_

  - [x] 4.2 Write property test for prompt construction
    - **Property 2: Prompt construction includes description and all categories**
    - **Validates: Requirements 2.1, 11.2, 11.3**

  - [x] 4.3 Write property test for category assignment results
    - **Property 3: Category assignment returns correct result for LLM responses**
    - **Validates: Requirements 2.2, 2.3, 2.6**

  - [x] 4.4 Write property test for fallback behavior
    - **Property 4: Fallback produces normalizer result with null raw category**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 4.5 Write unit tests for AICategoryAssigner in `server/src/services/__tests__/ai-category-assigner.test.ts`
    - Test LLM selects existing category → returns correct result
    - Test LLM proposes new category → returns correct result
    - Test LLM returns invalid JSON → retries with stricter prompt
    - Test LLM fails twice → falls back to keyword normalizer
    - Test prompt contains instruction to prefer existing categories
    - Test prompt contains formatting constraints for new categories
    - Test fallback logs a warning
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Integrate AICategoryAssigner with TaskAnalyzer
  - [x] 6.1 Update `server/src/services/task-analyzer.ts`
    - Add `AICategoryAssigner` and `CategoryRepository` as constructor dependencies
    - In `analyze()`, fetch category names via `CategoryRepository.getAllNames()`
    - Call `AICategoryAssigner.assign()` for each task description
    - Resolve/create the category in the table via `CategoryRepository.upsertByName()`
    - Include `category` (string) and `categoryId` (number) on each returned `AnalyzedTask`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.2 Write property test for task analysis category assignment
    - **Property 8: Task analysis assigns a category to every task**
    - **Validates: Requirements 5.1, 5.3**

  - [x] 6.3 Update existing TaskAnalyzer tests in `server/src/services/__tests__/task-analyzer.test.ts`
    - Add tests verifying category assignment is included in analysis results
    - Mock AICategoryAssigner to return controlled responses
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Integrate AICategoryAssigner with AdaptiveLearningEngine
  - [x] 7.1 Update `server/src/services/adaptive-learning-engine.ts`
    - Add `CategoryRepository` as a constructor dependency
    - In `recordCompletion()`, resolve the category to a `category_id` via `CategoryRepository.upsertByName()` and store it on the `completion_history` row
    - Update `getBehavioralModel()` to group by `category_id` and join `categories` table for display names
    - Update behavioral_adjustments upsert to use `category_id` as the grouping key
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.2 Write property test for completion record storage
    - **Property 6: Completion records store both raw category and category_id**
    - **Validates: Requirements 4.4, 6.1**

  - [x] 7.3 Write property test for behavioral adjustment grouping
    - **Property 9: Behavioral adjustments group by category_id**
    - **Validates: Requirements 6.2**

  - [x] 7.4 Update existing AdaptiveLearningEngine tests
    - Verify completion records include `category_id`
    - Verify behavioral model groups by `category_id`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Integrate category_id with AnalyticsAggregator
  - [x] 8.1 Update `server/src/services/analytics-aggregator.ts`
    - Update `getPerformanceCategories()` to group by `category_id` with JOIN to `categories` for display name
    - Update `computeCategoryPerformance()` to group by `category_id` with JOIN
    - Update `findMostDelayedCategory()` to group by `category_id` with JOIN
    - Update `findTopImprovingCategory()` to group by `category_id` with JOIN
    - Update `computeRecentChanges()` to group by `category_id` with JOIN
    - Update `computeWeeklyByCategory()` to group by `category_id` with JOIN
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 8.2 Write property test for analytics category grouping
    - **Property 10: Analytics groups by category_id and returns display name**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 8.3 Update existing AnalyticsAggregator tests
    - Verify category performance stats group by `category_id`
    - Verify display names come from the categories table
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 9. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement category management API endpoints
  - [x] 10.1 Add `GET /api/categories` endpoint to `server/src/app.ts`
    - Add `CategoryRepository` to `AppDependencies`
    - Return all categories from `CategoryRepository.getAll()` ordered by name
    - _Requirements: 10.1_

  - [x] 10.2 Add `POST /api/categories/merge` endpoint to `server/src/app.ts`
    - Accept `sourceCategoryId` and `targetCategoryId` in request body
    - Validate both IDs exist, return 404 if not found
    - Return 400 if source equals target
    - Update all `completion_history` rows with source `category_id` to target
    - Recompute `behavioral_adjustments` as weighted average of `time_multiplier` based on `sample_size`
    - Delete source category from `categories` table
    - Wrap in a transaction for atomicity
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 10.2, 10.4, 10.5_

  - [x] 10.3 Add `PATCH /api/categories/:categoryId` endpoint to `server/src/app.ts`
    - Accept `name` in request body
    - Validate category exists, return 404 if not
    - Validate new name is not empty, return 400 if missing
    - Use `CategoryRepository.rename()`, return 409 on duplicate name conflict
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.3, 10.4, 10.5_

  - [x] 10.4 Write property tests for merge operations
    - **Property 11: Merge transfers all references and deletes source**
    - **Validates: Requirements 8.1, 8.3**

  - [x] 10.5 Write property test for merge weighted average
    - **Property 12: Merge recomputes behavioral adjustments as weighted average**
    - **Validates: Requirements 8.2**

  - [x] 10.6 Write property tests for rename operations
    - **Property 13: Rename updates label and preserves all references**
    - **Validates: Requirements 9.1, 9.4**

  - [x] 10.7 Write property test for rename duplicate rejection
    - **Property 14: Rename rejects duplicate names case-insensitively**
    - **Validates: Requirements 9.2**

  - [x] 10.8 Write unit tests for category API endpoints in `server/src/__tests__/category-api.test.ts`
    - Test `GET /api/categories` returns sorted list
    - Test `POST /api/categories/merge` with valid IDs succeeds
    - Test `POST /api/categories/merge` with same source/target returns 400
    - Test `POST /api/categories/merge` with missing source returns 404
    - Test `PATCH /api/categories/:id` with valid name succeeds
    - Test `PATCH /api/categories/:id` with duplicate name returns 409
    - Test `PATCH /api/categories/:id` with non-existent ID returns 404
    - Test all endpoints return 400 for missing/invalid parameters
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 11. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update server and client types
  - [x] 12.1 Update `server/src/types/index.ts`
    - Add `CategoryEntity` interface with `id: number`, `name: string`, `createdAt: string`
    - Add `CategoryAssignmentResult` interface with `rawLLMCategory: string | null`, `finalCategory: string`, `isNew: boolean`
    - Extend `AnalyzedTask` to include optional `category?: string` and `categoryId?: number` fields
    - _Requirements: 5.4_

  - [x] 12.2 Update `client/src/types/index.ts`
    - Add `CategoryEntity` interface mirroring the server type
    - Extend `AnalyzedTask` to include optional `category?: string` and `categoryId?: number` fields
    - _Requirements: 5.4_

- [x] 13. Wire updated dependencies in app.ts and index.ts
  - [x] 13.1 Update `server/src/app.ts` to wire new dependencies
    - Add `CategoryRepository` to `AppDependencies` interface
    - Pass `CategoryRepository` to `TaskAnalyzer` and `AdaptiveLearningEngine` constructors
    - Pass `AICategoryAssigner` to `TaskAnalyzer` constructor
    - Wire the three new category management endpoints
    - _Requirements: 5.1, 5.2, 10.1, 10.2, 10.3_

  - [x] 13.2 Update `server/src/index.ts` to instantiate new services
    - Create `CategoryRepository` instance with the database connection
    - Create `AICategoryAssigner` instance
    - Pass both to `TaskAnalyzer` and `AdaptiveLearningEngine`
    - Include `CategoryRepository` in `AppDependencies`
    - _Requirements: 5.1, 5.2_

- [x] 14. Write migration backfill property test
  - [x] 14.1 Write property test for migration backfill
    - **Property 7: Migration backfill populates category_id from text columns**
    - **Validates: Requirements 4.6, 6.4**

- [x] 15. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript, Vitest for testing, and fast-check for property-based tests
- All database operations use better-sqlite3 with in-memory databases for testing
