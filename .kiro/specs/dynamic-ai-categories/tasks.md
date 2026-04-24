# Implementation Plan: Dynamic AI Categories

## Overview

This plan transforms the category system from a static, predefined taxonomy into a fully dynamic, AI-driven, per-user category system. Implementation follows a bottom-up approach: database schema first, then repository, services, API endpoints, and finally client-side components. Each task builds on the previous ones so there is no orphaned code.

## Tasks

- [x] 1. Database schema migration and data model changes
  - [x] 1.1 Evolve the `categories` table schema in `server/src/db/schema.ts`
    - Add `user_id`, `status`, `created_by`, `merged_into_category_id`, `updated_at` columns via `ALTER TABLE ADD COLUMN` with defaults
    - Change UNIQUE constraint from `(name)` to `(user_id, name)` (requires table recreation in SQLite)
    - Backfill `user_id` on existing categories by inferring ownership from `completion_history` references (user with most completions)
    - Set `status='active'` and `created_by='system'` for all existing rows
    - Remove automatic seeding of 10 canonical categories for new databases (preserve existing)
    - All operations must be idempotent (check column existence before ALTER)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.4, 3.1, 3.2, 3.3, 3.4, 15.1, 15.2, 15.3, 15.5, 15.6_

  - [x] 1.2 Add new columns to `completion_history` table
    - Add `raw_llm_category TEXT DEFAULT NULL`
    - Add `category_confidence REAL DEFAULT NULL`
    - Add `category_source TEXT DEFAULT NULL CHECK (category_source IN ('llm', 'fallback', 'user'))`
    - Idempotent: check column existence before ALTER
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 15.4, 15.5_

  - [x] 1.3 Write property test for migration backfill ownership (Property 11)
    - **Property 11: Migration Backfill Assigns Correct User Ownership**
    - Generate random categories with completion_history references from multiple users; verify each category's `user_id` is set to the user with the most completions
    - Test file: `server/src/db/__tests__/migration-backfill-ownership.property.test.ts`
    - **Validates: Requirements 15.2**

  - [x] 1.4 Write property test for migration idempotency (Property 12)
    - **Property 12: Migration Idempotency**
    - Generate random initial DB states; verify running `runMigrations` twice produces the same state as running it once (row counts, column values, schema)
    - Test file: `server/src/db/__tests__/migration-idempotency.property.test.ts`
    - **Validates: Requirements 15.5**

  - [x] 1.5 Write unit tests for schema migration
    - Test new columns exist after migration, backfill correctness, no seeding for new DBs, preservation of existing data
    - Test file: `server/src/db/__tests__/schema.test.ts` (extend existing)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 2. Checkpoint — Ensure all migration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Evolve CategoryRepository for per-user ownership and lifecycle
  - [x] 3.1 Update `CategoryEntity` interface and `CategoryRepository` class in `server/src/db/category-repository.ts`
    - Extend `CategoryEntity` with `userId`, `status`, `createdBy`, `mergedIntoCategoryId`, `updatedAt` fields
    - Add `getActiveByUserId(userId)` — returns only active categories for a user, ordered by name
    - Add `getActiveNamesByUserId(userId)` — returns active category names as string array
    - Add `findByNameAndUserId(name, userId)` — case-insensitive lookup scoped to user
    - Add `create(name, userId, createdBy)` — creates or returns existing (upsert per user)
    - Add `countActiveByUserId(userId)` — count active categories for a user
    - Add `archive(id)` — set status to 'archived'
    - Add `merge(sourceId, targetId)` — soft-delete source, set `merged_into_category_id`, update all `completion_history` and `behavioral_adjustments` references, recompute weighted averages
    - Add `resolveCategory(categoryId)` — follow `merged_into_category_id` chain to final active category
    - Update `rename(id, newName)` to also update `updated_at` timestamp
    - Retain legacy `getAll()` and `getAllNames()` for backward compatibility
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 8.3, 8.4, 13.1, 14.1, 14.2, 14.3_

  - [x] 3.2 Write property test for per-user category isolation (Property 1)
    - **Property 1: Per-User Category Isolation**
    - Generate random user IDs and category names; verify `getActiveByUserId(A)` returns only user A's categories
    - Test file: `server/src/db/__tests__/category-repository.property.test.ts`
    - **Validates: Requirements 2.2, 16.1**

  - [x] 3.3 Write property test for category creation metadata (Property 2)
    - **Property 2: Category Creation Metadata Correctness**
    - Generate random names, user IDs, createdBy values; verify created entity has correct metadata
    - Test file: `server/src/db/__tests__/category-repository.property.test.ts`
    - **Validates: Requirements 2.3, 16.3**

  - [x] 3.4 Write property test for per-user name uniqueness (Property 3)
    - **Property 3: Per-User Case-Insensitive Name Uniqueness**
    - Generate random user pairs and category names with case variations; verify same-user duplicates return existing, cross-user duplicates create separate rows
    - Test file: `server/src/db/__tests__/category-repository.property.test.ts`
    - **Validates: Requirements 2.4**

  - [x] 3.5 Write property test for merge preserves and updates (Property 4)
    - **Property 4: Merge Preserves Source Row and Updates All References**
    - Generate random categories with completion_history and behavioral_adjustment rows; verify source row preserved with merged status, all references updated, weighted averages correct, row counts unchanged
    - Test file: `server/src/db/__tests__/category-merge.property.test.ts`
    - **Validates: Requirements 3.5, 8.3, 14.2**

  - [x] 3.6 Write property test for rename preserves references (Property 16)
    - **Property 16: Rename Preserves Reference Counts**
    - Generate random categories with N completion_history and M behavioral_adjustment references; verify counts unchanged after rename
    - Test file: `server/src/db/__tests__/category-rename.property.test.ts`
    - **Validates: Requirements 8.4**

  - [x] 3.7 Write unit tests for CategoryRepository
    - Test create, find, rename, archive, merge, getActiveByUserId, resolveCategory
    - Test file: `server/src/db/__tests__/category-repository.test.ts` (extend existing)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint — Ensure all repository tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Evolve AICategoryAssigner with confidence, naming rules, and >20 threshold
  - [x] 5.1 Update `AICategoryAssigner` in `server/src/services/ai-category-assigner.ts`
    - Extend `CategoryAssignmentResult` with `confidence`, `source`, `closestExisting`, `lowConfidence` fields
    - Update `assign()` signature to accept optional `activeCategoryCount` parameter
    - Update LLM prompt to request `{ category, isExisting, confidence }` JSON response
    - Add >20 category threshold warning in prompt when `activeCategoryCount > 20`
    - Enforce ≤3 word, title-case naming rules: truncate >3 word names to first 3 words
    - If truncated name matches existing category, use it; otherwise fall back
    - Instruct LLM to validate new names are not synonyms of existing ones
    - On fallback: set `rawLLMCategory=null`, `source='fallback'`, `confidence=0.0`, `isNew=false`
    - When normalizer produces "Other", set `lowConfidence=true`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 5.2 Write property test for category name validation — three word limit (Property 5)
    - **Property 5: Category Name Validation — Three Word Limit**
    - Generate random strings of 1-10 words; verify names >3 words are truncated or rejected, final name never exceeds 3 words
    - Test file: `server/src/services/__tests__/ai-category-assigner.property.test.ts` (extend existing)
    - **Validates: Requirements 5.4**

  - [x] 5.3 Write property test for >20 category threshold (Property 6)
    - **Property 6: Conservative Category Creation Threshold**
    - Generate random category counts (0-50); verify prompt contains extra instruction iff count > 20
    - Test file: `server/src/services/__tests__/ai-category-assigner.property.test.ts` (extend existing)
    - **Validates: Requirements 6.3**

  - [x] 5.4 Write property test for fallback metadata (Property 9)
    - **Property 9: Fallback Produces Correct Metadata**
    - Generate random task descriptions with mocked LLM failure; verify result has `rawLLMCategory=null`, `source='fallback'`, `confidence=0.0`, `isNew=false`
    - Test file: `server/src/services/__tests__/ai-category-assigner.property.test.ts` (extend existing)
    - **Validates: Requirements 10.2**

  - [x] 5.5 Write property test for "Other" low confidence flag (Property 10)
    - **Property 10: "Other" Fallback Triggers Low Confidence Flag**
    - Generate random descriptions that normalize to "Other"; verify `lowConfidence=true`
    - Test file: `server/src/services/__tests__/ai-category-assigner.property.test.ts` (extend existing)
    - **Validates: Requirements 10.4**

  - [x] 5.6 Write unit tests for AICategoryAssigner
    - Test successful assignment with confidence, retry on parse failure, fallback to normalizer, >20 threshold prompt, 3-word truncation
    - Test file: `server/src/services/__tests__/ai-category-assigner.test.ts` (extend existing)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 10.1, 10.2, 10.3, 10.4_

- [x] 6. Implement CategoryConsolidator service
  - [x] 6.1 Create `server/src/services/category-consolidator.ts`
    - Define `SuggestionAction`, `ConsolidationSuggestion` types
    - Implement `CategoryConsolidator` class with `analyze(categories)` method
    - Send user's full category list to LLM with instructions to identify duplicates, synonyms, overly narrow/broad labels
    - Parse LLM response into `ConsolidationSuggestion[]` (merge, rename, split)
    - Retry once with stricter prompt on parse failure; return empty array on total failure
    - Does NOT apply changes — returns suggestions only
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 6.2 Write property test for consolidation suggestion structural validity (Property 17)
    - **Property 17: Consolidation Suggestion Structural Validity**
    - Generate random LLM responses parsed as suggestions; verify merge has sourceCategoryId/Name and targetCategoryId/Name, rename has categoryId/currentName/proposedName, split has categoryId/currentName/proposedNames (length ≥ 2)
    - Test file: `server/src/services/__tests__/category-consolidator.property.test.ts`
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x] 6.3 Write unit tests for CategoryConsolidator
    - Test merge/rename/split suggestion parsing, empty category list, LLM failure handling
    - Test file: `server/src/services/__tests__/category-consolidator.test.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 7. Checkpoint — Ensure all service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update TaskAnalyzer integration
  - [x] 8.1 Update `TaskAnalyzer` in `server/src/services/task-analyzer.ts`
    - Change category assignment to use per-user categories: call `categoryRepo.getActiveNamesByUserId(userId)` instead of `getAllNames()`
    - Pass `categoryRepo.countActiveByUserId(userId)` as `activeCategoryCount` to `categoryAssigner.assign()`
    - Use `categoryRepo.create(name, userId, createdBy)` instead of `upsertByName(name)` for new categories
    - Store `categoryConfidence` on `AnalyzedTask` from assignment result
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 8.2 Write unit tests for TaskAnalyzer category integration
    - Test per-user category fetching, new category creation with correct `createdBy`, confidence propagation
    - Test file: `server/src/services/__tests__/task-analyzer.test.ts` (extend existing)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 9. Update AdaptiveLearningEngine integration
  - [x] 9.1 Update `AdaptiveLearningEngine` in `server/src/services/adaptive-learning-engine.ts`
    - Update `recordCompletion` to store `raw_llm_category`, `category_confidence`, `category_source` in `completion_history`
    - Resolve category via `categoryRepo.create(name, userId, createdBy)` using per-user scoping
    - Group behavioral adjustments by `category_id` and use current category name from `categories` table
    - _Requirements: 9.5, 17.1, 17.2, 17.3_

  - [x] 9.2 Write unit tests for AdaptiveLearningEngine category integration
    - Test category metadata storage, per-user category resolution, behavioral adjustment grouping by category_id
    - Test file: `server/src/services/__tests__/adaptive-learning-engine.test.ts` (extend existing)
    - _Requirements: 17.1, 17.2, 17.3_

- [x] 10. Update AnalyticsAggregator integration (merge rollup)
  - [x] 10.1 Update `AnalyticsAggregator` in `server/src/services/analytics-aggregator.ts`
    - Update all category queries to JOIN `categories` ON `category_id`
    - Follow `merged_into_category_id` for merged categories — roll up historical data under target category
    - Filter to active categories for display
    - Use current category name from `categories` table (not raw text)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 10.2 Write property test for name resolution after rename (Property 13)
    - **Property 13: Name Resolution After Rename**
    - Generate random categories with completions, rename them; verify analytics and learning engine use new name, no results reference old name
    - Test file: `server/src/services/__tests__/analytics-rename.property.test.ts`
    - **Validates: Requirements 13.1, 13.4**

  - [x] 10.3 Write property test for analytics merge rollup (Property 14)
    - **Property 14: Analytics Follows Merge Pointers**
    - Generate random categories with completions, merge them; verify merged category data appears under target, merged category does not appear as separate entry
    - Test file: `server/src/services/__tests__/analytics-merge.property.test.ts`
    - **Validates: Requirements 13.2**

  - [x] 10.4 Write unit tests for AnalyticsAggregator category integration
    - Test merge rollup, rename resolution, active-only filtering
    - Test file: `server/src/services/__tests__/analytics-aggregator.test.ts` (extend existing)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 11. Checkpoint — Ensure all integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update and add API endpoints
  - [x] 12.1 Update existing endpoints in `server/src/app.ts`
    - `GET /api/categories`: Add `userId` query param, return only active categories for that user
    - `POST /api/categories/merge`: Change to soft-delete (set status='merged', populate `merged_into_category_id`) instead of deleting source row
    - `PATCH /api/categories/:categoryId`: Update `updated_at` timestamp on rename
    - `POST /api/tasks/analyze`: Include `categoryConfidence` per task in response
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 12.2 Add new endpoints in `server/src/app.ts`
    - `POST /api/categories` — Create a category manually (`created_by='user'`); return 201 on success, 400 on invalid params, 409 on duplicate
    - `PATCH /api/categories/:categoryId/archive` — Set category status to 'archived'; return 200 on success, 404 if not found
    - `POST /api/categories/consolidate` — Trigger consolidation analysis for a user, return suggestions
    - `POST /api/categories/consolidate/apply` — Apply approved consolidation suggestions (merge/rename/split)
    - Wire `CategoryConsolidator` into `AppDependencies` and `createApp`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 14.4, 14.5, 14.6, 14.7_

  - [x] 12.3 Write property test for API error responses (Property 15)
    - **Property 15: API Error Responses**
    - Generate random invalid payloads and non-existent IDs; verify 400 for invalid params, 404 for missing IDs
    - Test file: `server/src/__tests__/category-api.property.test.ts`
    - **Validates: Requirements 14.6, 14.7**

  - [x] 12.4 Write unit tests for API endpoints
    - Test GET with userId filter, POST create, PATCH rename, PATCH archive, POST merge (soft-delete), consolidate endpoints, error responses
    - Test file: `server/src/__tests__/category-api.test.ts` (extend existing)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 13. Update server-side type definitions
  - [x] 13.1 Update `server/src/types/index.ts`
    - Extend `CategoryEntity` with `userId`, `status`, `createdBy`, `mergedIntoCategoryId`, `updatedAt`
    - Extend `CategoryAssignmentResult` with `confidence`, `source`, `closestExisting`, `lowConfidence`
    - Add `ConsolidationSuggestion` and `SuggestionAction` types
    - Add `categoryConfidence` to `AnalyzedTask`
    - Deprecate `CanonicalCategory` type
    - Extend `CompletionRecord` with optional category metadata fields
    - _Requirements: 1.4, 3.1, 3.2, 3.3, 3.4, 4.4, 4.5, 7.2, 16.4_

- [x] 14. Checkpoint — Ensure all server tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement client-side category color utility
  - [x] 15.1 Create `client/src/utils/category-color.ts`
    - Define `CATEGORY_PALETTE` array of 12 `{ bg, text }` color pairs (soft, muted tones)
    - Implement `getCategoryColor(name)` using djb2 hash to deterministically map category names to palette entries
    - Implement `hashString(str)` helper
    - All palette entries must meet WCAG AA contrast ratio (≥4.5:1)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 15.2 Write property test for deterministic color mapping (Property 7)
    - **Property 7: Deterministic Color Mapping**
    - Generate random category name strings; verify same input always returns same output, output is a member of `CATEGORY_PALETTE`
    - Test file: `client/src/utils/__tests__/category-color.property.test.ts`
    - **Validates: Requirements 11.3, 12.1, 12.2**

  - [x] 15.3 Write property test for WCAG AA contrast (Property 8)
    - **Property 8: WCAG AA Contrast for Category Palette**
    - Exhaustively verify every `CATEGORY_PALETTE` entry has contrast ratio ≥ 4.5:1 between text and bg colors
    - Test file: `client/src/utils/__tests__/category-color.property.test.ts`
    - **Validates: Requirements 11.6**

  - [x] 15.4 Write unit tests for category color utility
    - Test known inputs map to expected colors, palette size ≥ 10, determinism
    - Test file: `client/src/utils/__tests__/category-color.test.ts`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 16. Implement CategoryBadge component and integrate into TaskCard
  - [x] 16.1 Create `client/src/components/CategoryBadge.tsx`
    - Accept `categoryName` prop
    - Render a small rounded pill with soft background tint from `getCategoryColor(categoryName)`
    - Text color chosen for WCAG AA contrast against background
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 16.2 Integrate CategoryBadge into `client/src/components/TaskCard.tsx`
    - Import `CategoryBadge`
    - Add `{task.category && <CategoryBadge categoryName={task.category} />}` in the metrics row between priority badge and effort indicator
    - No badge when `task.category` is undefined
    - _Requirements: 11.1, 11.4, 11.5_

  - [x] 16.3 Write unit tests for CategoryBadge component
    - Test renders with category name, correct color applied, no badge when no category
    - Test file: `client/src/components/__tests__/CategoryBadge.test.tsx`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 16.4 Write unit tests for TaskCard with CategoryBadge
    - Test badge appears in metrics row, no badge when category is undefined
    - Test file: `client/src/components/__tests__/TaskCard.test.tsx`
    - _Requirements: 11.1, 11.4, 11.5_

- [x] 17. Update client-side type definitions and API client
  - [x] 17.1 Update `client/src/types/index.ts`
    - Extend `AnalyzedTask` with `categoryConfidence?: number`
    - Extend `CategoryEntity` with `userId`, `status`, `createdBy`, `mergedIntoCategoryId`, `updatedAt`
    - Add `ConsolidationSuggestion` and `SuggestionAction` types
    - Deprecate `CanonicalCategory` type
    - _Requirements: 1.4, 3.1, 3.2, 3.3, 3.4, 16.4_

  - [x] 17.2 Add new API client functions in `client/src/api/client.ts`
    - `getCategories(userId)` — `GET /api/categories?userId=...`
    - `createCategory(name, userId)` — `POST /api/categories`
    - `archiveCategory(categoryId)` — `PATCH /api/categories/:id/archive`
    - `consolidateCategories(userId)` — `POST /api/categories/consolidate`
    - `applyConsolidation(userId, suggestionIds, suggestions)` — `POST /api/categories/consolidate/apply`
    - _Requirements: 8.1, 8.2, 14.1, 14.4, 14.5_

- [x] 18. Wire dependencies and update server entry point
  - [x] 18.1 Update `server/src/index.ts` to wire new dependencies
    - Import and instantiate `CategoryConsolidator`
    - Pass `CategoryConsolidator` to `createApp` via `AppDependencies`
    - Update `AppDependencies` interface in `server/src/app.ts` to include `categoryConsolidator`
    - Ensure all services receive the updated `CategoryRepository`
    - _Requirements: 7.1, 8.1_

- [x] 19. Final checkpoint — Ensure all tests pass
  - Run full test suite (`vitest --run`) for both server and client
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major layer
- Property tests validate the 17 universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation order is bottom-up: schema → repository → services → API → client
- TypeScript is used throughout; Vitest for testing; fast-check for property-based tests
- better-sqlite3 with in-memory databases for test isolation
