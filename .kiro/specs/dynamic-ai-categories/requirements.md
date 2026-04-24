# Requirements Document

## Introduction

Redesign the category system to be fully dynamic and AI-driven. The current implementation seeds 10 predefined categories (Writing, Development, Design, etc.) and uses a keyword-based normalizer as the primary fallback. This new system starts each user with zero categories, creates categories dynamically from AI analysis of real tasks, prevents category explosion through conservative assignment and periodic consolidation, and displays the assigned category as a colorful badge on every task card in the UI. The existing `categories` table, `CategoryRepository`, `AICategoryAssigner`, and integration points in `TaskAnalyzer`, `AdaptiveLearningEngine`, and `AnalyticsAggregator` are evolved rather than replaced. The keyword normalizer is retained only as a last-resort fallback when the LLM is completely unavailable.

## Glossary

- **Category_Table**: The SQLite `categories` table storing each unique category as a row with an integer primary key, a unique label, per-user ownership, lifecycle status, creation source, and optional merge pointer.
- **Category_Assigner**: The server-side service (`AICategoryAssigner`) that sends a task description and the user's existing category list to the LLM and returns a category assignment result with confidence metadata.
- **Category_Normalizer**: The existing keyword-based utility (`category-normalizer.ts`) that maps free-text strings to canonical labels using substring matching. Retained as a last-resort fallback only.
- **Category_Consolidator**: A new server-side service that uses AI to review a user's full category list and suggest merges, renames, and splits for taxonomy maintenance.
- **Task_Analyzer**: The service (`TaskAnalyzer`) that assigns AI-generated metrics and categories to parsed tasks.
- **Adaptive_Learning_Engine**: The service (`AdaptiveLearningEngine`) that records task completions and computes per-category behavioral adjustments.
- **Analytics_Aggregator**: The service (`AnalyticsAggregator`) that queries completion history and computes dashboard metrics.
- **LLM**: The OpenAI-compatible large language model used for task analysis, category assignment, and category consolidation.
- **Category_Badge**: A small, rounded, color-coded UI element (pill/chip) displayed on each task card showing the assigned category name.
- **Consolidation_Suggestion**: A structured recommendation from the Category_Consolidator to merge, rename, or split categories.
- **Category_Color**: A deterministic color mapping derived from the category name or ID, used for the Category_Badge background tint.

## Requirements

### Requirement 1: Remove Predefined Category Seeding

**User Story:** As a new user, I want to start with no categories, so that my category taxonomy emerges from my actual tasks rather than a generic preset list.

#### Acceptance Criteria

1. WHEN a new user account is initialized, THE Category_Table SHALL contain zero rows for that user.
2. THE database migration SHALL remove the seeding of the 10 predefined canonical categories (Writing, Development, Design, Research, Admin, Communication, Planning, Testing, Learning, Other) for new users.
3. THE database migration SHALL preserve all existing categories and their references for users who already have data.
4. THE `CanonicalCategory` type in both server and client type definitions SHALL be removed or deprecated, since categories are no longer drawn from a fixed set.

### Requirement 2: Per-User Category Ownership

**User Story:** As a user, I want my categories to be separate from other users' categories, so that my taxonomy reflects my personal workflow.

#### Acceptance Criteria

1. THE Category_Table SHALL include a `user_id` column that references the `users` table, making each category owned by a specific user.
2. WHEN the Category_Assigner fetches existing categories, THE Category_Assigner SHALL retrieve only categories belonging to the current user.
3. WHEN a category is created, THE system SHALL associate the new category with the user who triggered the creation.
4. THE uniqueness constraint on category names SHALL be scoped to a single user (case-insensitive uniqueness per user, not globally).

### Requirement 3: Extended Category Data Model

**User Story:** As a developer, I want the category entity to track lifecycle status, creation source, and merge history, so that the system can support consolidation and auditing.

#### Acceptance Criteria

1. THE Category_Table SHALL include a `status` column with allowed values: `active`, `merged`, `archived`.
2. THE Category_Table SHALL include a `created_by` column with allowed values: `llm`, `user`, `system`, `fallback`.
3. THE Category_Table SHALL include a `merged_into_category_id` column (nullable) that references another category row, indicating the target of a merge operation.
4. THE Category_Table SHALL include `created_at` and `updated_at` timestamp columns.
5. WHEN a category is merged into another, THE system SHALL set the source category status to `merged` and populate `merged_into_category_id` with the target category ID, instead of deleting the source row.

### Requirement 4: AI-Driven Category Assignment with Confidence

**User Story:** As a user, I want the AI to assign categories intelligently based on my existing taxonomy, so that categories are accurate and reusable.

#### Acceptance Criteria

1. WHEN the Category_Assigner receives a task description and the user's existing active category names, THE Category_Assigner SHALL send both to the LLM with instructions to select the best existing category or propose a new short, reusable, general-purpose label.
2. THE Category_Assigner SHALL instruct the LLM to prefer existing categories and only propose a new category when confidence is low for all existing categories.
3. THE Category_Assigner SHALL instruct the LLM that new category names must be at most three words, title-cased, and general-purpose (avoiding task-specific names such as "Prepare For Ecobio Interview").
4. THE Category_Assigner SHALL instruct the LLM to return a confidence score (0.0 to 1.0) alongside the category assignment.
5. THE Category_Assigner SHALL return the raw LLM category string, the resolved final category name, whether the category is new, and the confidence score in its response.
6. WHEN the LLM proposes a new category, THE Category_Assigner SHALL validate that the proposed name is not a synonym or near-duplicate of an existing category by including an explicit instruction in the LLM prompt listing existing categories and asking the LLM to confirm the new name is distinct.
7. WHEN the LLM response cannot be parsed as valid JSON, THE Category_Assigner SHALL retry once with a stricter prompt before falling back.

### Requirement 5: Category Naming Rules Enforcement

**User Story:** As a user, I want category names to be short, consistent, and reusable, so that my taxonomy stays clean over time.

#### Acceptance Criteria

1. THE Category_Assigner prompt SHALL instruct the LLM to produce category names in title case using one to three words.
2. THE Category_Assigner prompt SHALL instruct the LLM to avoid task-specific names and prefer stable, general-purpose labels (examples: "Interview Prep", "Personal Care", "Job Search", "Client Work", "Health").
3. THE Category_Assigner prompt SHALL instruct the LLM to avoid creating categories that are synonyms or near-duplicates of existing categories.
4. WHEN a category name proposed by the LLM exceeds three words, THE system SHALL truncate or reject the name and fall back to the closest existing category or the fallback mechanism.

### Requirement 6: Category Explosion Prevention — Assignment Flow

**User Story:** As a user, I want the system to be conservative about creating new categories, so that my category list stays manageable.

#### Acceptance Criteria

1. THE Category_Assigner prompt SHALL instruct the LLM to select an existing category unless the task clearly does not fit any existing category.
2. THE Category_Assigner prompt SHALL include the full list of the user's existing active category names so the LLM can make an informed selection.
3. WHEN the user has more than 20 active categories, THE Category_Assigner prompt SHALL include an additional instruction emphasizing that new categories should only be created in exceptional cases.
4. WHEN the LLM returns a confidence score below 0.5 for an existing category match and proposes a new category, THE Category_Assigner SHALL include the proposed new name and the closest existing category in its response so the system can log or flag the decision.

### Requirement 7: Category Consolidation Service

**User Story:** As a user, I want the system to periodically review my categories and suggest cleanups, so that my taxonomy stays organized without manual effort.

#### Acceptance Criteria

1. THE Category_Consolidator SHALL accept a user's full list of active categories and produce a list of Consolidation_Suggestions.
2. EACH Consolidation_Suggestion SHALL specify one of three actions: `merge` (combine two near-duplicate categories), `rename` (improve a weak or inconsistent category name), or `split` (break an overly broad category into more specific ones).
3. WHEN suggesting a merge, THE Category_Consolidator SHALL identify the source category and the target category.
4. WHEN suggesting a rename, THE Category_Consolidator SHALL provide the current name and the proposed new name.
5. WHEN suggesting a split, THE Category_Consolidator SHALL provide the current category name and the proposed new category names.
6. THE Category_Consolidator SHALL send the category list to the LLM with instructions to identify duplicates, synonyms, overly narrow labels, and overly broad labels.
7. THE Category_Consolidator SHALL return suggestions without automatically applying them; the system or user decides whether to apply.

### Requirement 8: Consolidation API and Application

**User Story:** As a user, I want to trigger category consolidation and review suggestions before they are applied, so that I maintain control over my taxonomy.

#### Acceptance Criteria

1. THE system SHALL expose a `POST /api/categories/consolidate` endpoint that triggers the Category_Consolidator for the specified user and returns the list of Consolidation_Suggestions.
2. THE system SHALL expose a `POST /api/categories/consolidate/apply` endpoint that accepts a list of approved suggestion IDs and applies the corresponding merge, rename, or split operations.
3. WHEN a merge suggestion is applied, THE system SHALL update all `completion_history` and `behavioral_adjustments` rows referencing the source `category_id` to the target `category_id`, recompute behavioral adjustments as a weighted average, and set the source category status to `merged`.
4. WHEN a rename suggestion is applied, THE system SHALL update the category name while preserving all existing references.
5. WHEN a split suggestion is applied, THE system SHALL create the new categories and leave existing task references on the original category (reassignment happens during future task analysis).

### Requirement 9: Enhanced Completion and Task Storage

**User Story:** As a developer, I want task and completion records to store rich category metadata, so that the system can track assignment quality and improve over time.

#### Acceptance Criteria

1. THE `completion_history` table SHALL store the `category_id` referencing the Category_Table.
2. THE `completion_history` table SHALL store the `raw_llm_category` string (the exact LLM output before resolution).
3. THE `completion_history` table SHALL store a `category_confidence` float column for the LLM's confidence score.
4. THE `completion_history` table SHALL store a `category_source` column indicating how the category was assigned (`llm`, `fallback`, `user`).
5. WHEN a completion record is inserted, THE system SHALL populate all category metadata fields.

### Requirement 10: Fallback Behavior

**User Story:** As a user, I want the system to handle AI failures gracefully without defaulting to a meaningless "Other" category, so that my categories remain useful.

#### Acceptance Criteria

1. IF the LLM call fails after the retry attempt, THEN THE Category_Assigner SHALL fall back to the Category_Normalizer to produce a category from the task description.
2. WHEN the fallback is used, THE Category_Assigner SHALL set the `raw_llm_category` to null, the `category_source` to `fallback`, and the confidence to 0.0.
3. THE Category_Assigner SHALL log a warning when the fallback path is triggered, including the error reason.
4. WHEN the Category_Normalizer produces "Other" as the fallback result, THE system SHALL mark the category assignment with a `low_confidence` flag so it can be re-evaluated later when the LLM becomes available.
5. THE system SHALL avoid creating an "Other" category unless the LLM and the fallback normalizer both fail to produce a meaningful category.

### Requirement 11: Category Badge UI Component

**User Story:** As a user, I want to see the assigned category displayed as a colorful badge on each task card, so that I can quickly scan task types at a glance.

#### Acceptance Criteria

1. THE TaskCard component SHALL display a Category_Badge element showing the assigned category name.
2. THE Category_Badge SHALL render as a small rounded pill with a soft background tint and readable text, visually similar to modern issue tracker labels.
3. THE Category_Badge background color SHALL be deterministically derived from the category name so that the same category always has the same color.
4. WHEN a task has no assigned category, THE TaskCard SHALL not display a Category_Badge (no empty or placeholder badge).
5. THE Category_Badge SHALL appear in the metrics row of the TaskCard alongside the priority badge, effort indicator, difficulty rating, and estimated time.
6. THE Category_Badge SHALL be accessible, with sufficient color contrast between the text and background tint (minimum WCAG AA contrast ratio).

### Requirement 12: Category Color Mapping

**User Story:** As a user, I want different categories to have distinct colors, so that I can visually distinguish task types.

#### Acceptance Criteria

1. THE system SHALL provide a deterministic color mapping function that takes a category name and returns a color from a predefined palette of at least 10 visually distinct colors.
2. THE color mapping function SHALL produce consistent results: the same category name SHALL always map to the same color.
3. THE color palette SHALL use soft, muted tones suitable for background tints (not saturated primary colors).
4. THE color mapping function SHALL be implemented as a shared utility usable by both the Category_Badge component and the analytics CategoryPerformance component.

### Requirement 13: Analytics Continuity with Dynamic Categories

**User Story:** As a user, I want my analytics to remain accurate when categories are merged or renamed, so that historical data is not lost or fragmented.

#### Acceptance Criteria

1. WHEN the Analytics_Aggregator computes category performance statistics, THE Analytics_Aggregator SHALL group by `category_id` and join to the Category_Table to retrieve the current display name.
2. WHEN a category has been merged (status = `merged`), THE Analytics_Aggregator SHALL follow the `merged_into_category_id` pointer to roll up historical data under the target category.
3. WHEN the Analytics_Aggregator computes recent behavioral changes, THE Analytics_Aggregator SHALL group by `category_id` and filter to only `active` categories.
4. THE Adaptive_Learning_Engine SHALL group behavioral adjustments by `category_id` and use the current category name from the Category_Table for display.

### Requirement 14: Category Management API Updates

**User Story:** As a developer, I want the category management API to support the new per-user, lifecycle-aware category model, so that the client can provide a complete category management experience.

#### Acceptance Criteria

1. THE `GET /api/categories` endpoint SHALL accept a `userId` query parameter and return only active categories for that user, ordered by name.
2. THE `POST /api/categories/merge` endpoint SHALL set the source category status to `merged` and populate `merged_into_category_id` instead of deleting the source row.
3. THE `PATCH /api/categories/:categoryId` endpoint SHALL update the `updated_at` timestamp when renaming a category.
4. THE system SHALL expose a `POST /api/categories` endpoint that allows manual creation of a category with `created_by` set to `user`.
5. THE system SHALL expose a `PATCH /api/categories/:categoryId/archive` endpoint that sets a category status to `archived`.
6. WHEN any category management endpoint receives invalid or missing parameters, THE system SHALL return a 400 status with a descriptive error message.
7. WHEN a category management endpoint references a non-existent category ID, THE system SHALL return a 404 status.

### Requirement 15: Database Migration Strategy

**User Story:** As a developer, I want the migration to be non-destructive and idempotent, so that existing data is preserved and the migration can be safely re-run.

#### Acceptance Criteria

1. THE database migration SHALL add the `user_id`, `status`, `created_by`, `merged_into_category_id`, and `updated_at` columns to the Category_Table without dropping existing data.
2. THE database migration SHALL backfill `user_id` on existing category rows by inferring ownership from `completion_history` references (assigning each category to the user who has the most completions referencing it).
3. THE database migration SHALL set `status` to `active` and `created_by` to `system` for all existing category rows.
4. THE database migration SHALL add the `raw_llm_category`, `category_confidence`, and `category_source` columns to the `completion_history` table.
5. THE database migration SHALL be idempotent: running the migration multiple times on the same database SHALL produce the same result as running it once.
6. THE database migration SHALL remove the automatic seeding of the 10 canonical categories for new databases, while preserving them in existing databases.

### Requirement 16: Integration with Task Analyzer

**User Story:** As a user, I want category assignment to happen automatically during task analysis using my personal category list, so that I do not need to manually categorize tasks.

#### Acceptance Criteria

1. WHEN the Task_Analyzer analyzes a list of tasks for a user, THE Task_Analyzer SHALL fetch only that user's active categories from the Category_Table.
2. THE Task_Analyzer SHALL call the Category_Assigner for each task description, passing the user's active category names.
3. WHEN the Category_Assigner returns a new category, THE Task_Analyzer SHALL create the category in the Category_Table with `created_by` set to `llm` and `user_id` set to the current user.
4. THE AnalyzedTask response SHALL include the `category` name, `categoryId`, and `categoryConfidence` fields.

### Requirement 17: Integration with Adaptive Learning Engine

**User Story:** As a user, I want the adaptive learning engine to use my personal dynamic categories for behavioral adjustments, so that learning is accurate per my taxonomy.

#### Acceptance Criteria

1. WHEN the Adaptive_Learning_Engine records a completion, THE Adaptive_Learning_Engine SHALL resolve the task category to the user's Category_Table entity and store the `category_id` on the completion_history row.
2. WHEN the Adaptive_Learning_Engine computes behavioral adjustments, THE Adaptive_Learning_Engine SHALL group completion records by `category_id` and filter to the user's categories.
3. THE behavioral_adjustments table SHALL reference categories by `category_id` and scope adjustments to the user's personal categories.
