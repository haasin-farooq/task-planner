# Requirements Document

## Introduction

Replace the current static keyword-based category normalization with an AI-assisted category assignment flow. When a task is analyzed or a completion is recorded, the system sends the task description along with the user's existing category list to the LLM, which selects the best-fitting existing category or proposes a short, reusable new one. Categories are stored as first-class entities in a dedicated database table, enabling stable references for analytics, adaptive learning, and later category management operations (merge, rename). The existing keyword normalizer is retained as a fallback when the LLM is unavailable.

## Glossary

- **Category_Table**: A dedicated SQLite table (`categories`) that stores each unique category as a row with an integer primary key and a unique label string.
- **Category_Assigner**: The server-side service (`AICategoryAssigner`) that sends a task description and the current category list to the LLM and returns a category assignment result.
- **Category_Normalizer**: The existing keyword-based utility (`category-normalizer.ts`) that maps free-text strings to a fixed set of canonical labels using substring matching.
- **Task_Analyzer**: The service (`TaskAnalyzer`) that assigns AI-generated metrics (priority, effort, difficulty, time, dependencies) to parsed tasks.
- **Adaptive_Learning_Engine**: The service (`AdaptiveLearningEngine`) that records task completions and computes per-category behavioral adjustments.
- **Analytics_Aggregator**: The service (`AnalyticsAggregator`) that queries completion history and computes dashboard metrics.
- **LLM**: The OpenAI-compatible large language model used for task parsing, analysis, and now category assignment.
- **Raw_LLM_Category**: The exact category string returned by the LLM before any resolution against the Category_Table.
- **Final_Category**: The category entity from the Category_Table that is ultimately associated with a task or completion record.
- **Category_Merge**: An operation that replaces all references to one category with another category and removes the source category.
- **Category_Rename**: An operation that changes the label of an existing category while preserving its identity and all references.

## Requirements

### Requirement 1: Categories Table

**User Story:** As a developer, I want categories stored as first-class entities in a dedicated table, so that analytics and learning can reference stable category identifiers instead of free-text strings.

#### Acceptance Criteria

1. THE Category_Table SHALL store each category as a row with an auto-incrementing integer primary key (`id`) and a unique text column (`name`).
2. THE Category_Table SHALL include a `created_at` timestamp column that defaults to the current time.
3. WHEN a new category name is inserted, THE Category_Table SHALL enforce uniqueness on the `name` column using a case-insensitive comparison.
4. THE database migration SHALL add the Category_Table without dropping or altering existing tables.
5. THE database migration SHALL seed the Category_Table with the ten existing canonical categories: Writing, Development, Design, Research, Admin, Communication, Planning, Testing, Learning, Other.

### Requirement 2: AI Category Assignment Service

**User Story:** As a user, I want the system to intelligently assign a category to each task using AI, so that categories are more accurate than keyword matching alone.

#### Acceptance Criteria

1. WHEN the Category_Assigner receives a task description and a list of existing category names, THE Category_Assigner SHALL send both to the LLM with instructions to select the best existing category or propose a new short, reusable, general-purpose label.
2. WHEN the LLM selects an existing category, THE Category_Assigner SHALL return that category name as the assignment result.
3. WHEN the LLM proposes a new category name, THE Category_Assigner SHALL return the proposed name as the assignment result.
4. THE Category_Assigner SHALL instruct the LLM to prefer existing categories and only propose a new category when none of the existing categories fit the task description.
5. THE Category_Assigner SHALL instruct the LLM that new category names must be at most three words, title-cased, and general-purpose enough to apply to multiple future tasks.
6. THE Category_Assigner SHALL return both the Raw_LLM_Category string and the resolved Final_Category name in its response.
7. WHEN the LLM response cannot be parsed as valid JSON, THE Category_Assigner SHALL retry once with a stricter prompt before falling back.

### Requirement 3: Fallback to Keyword Normalizer

**User Story:** As a user, I want the system to still assign reasonable categories when the AI is unavailable, so that the application remains functional without the LLM.

#### Acceptance Criteria

1. IF the LLM call fails after the retry attempt, THEN THE Category_Assigner SHALL fall back to the Category_Normalizer to produce a category from the task description.
2. IF the LLM call times out or returns an empty response after the retry attempt, THEN THE Category_Assigner SHALL fall back to the Category_Normalizer.
3. WHEN the fallback is used, THE Category_Assigner SHALL set the Raw_LLM_Category to `null` and the Final_Category to the Category_Normalizer result.
4. THE Category_Assigner SHALL log a warning when the fallback path is triggered, including the error reason.

### Requirement 4: Category Resolution and Storage

**User Story:** As a developer, I want the assigned category to be resolved against the categories table and persisted, so that every task references a stable category entity.

#### Acceptance Criteria

1. WHEN the Category_Assigner returns an existing category name, THE system SHALL look up the corresponding row in the Category_Table by name.
2. WHEN the Category_Assigner returns a new category name that does not exist in the Category_Table, THE system SHALL insert a new row into the Category_Table with that name.
3. THE completion_history table SHALL include a `category_id` integer column that references the Category_Table primary key.
4. WHEN a completion record is inserted, THE system SHALL store both the raw LLM category string (in the existing `category` column) and the resolved `category_id` referencing the Category_Table.
5. THE database migration SHALL add the `category_id` column to the `completion_history` table without dropping existing data.
6. THE database migration SHALL backfill `category_id` for existing completion_history rows by matching their `normalized_category` value against the Category_Table name.

### Requirement 5: Integration with Task Analyzer

**User Story:** As a user, I want category assignment to happen automatically during task analysis, so that I do not need to manually categorize tasks.

#### Acceptance Criteria

1. WHEN the Task_Analyzer analyzes a list of tasks, THE Task_Analyzer SHALL call the Category_Assigner for each task description.
2. THE Task_Analyzer SHALL pass the full list of current category names from the Category_Table to the Category_Assigner.
3. WHEN the Task_Analyzer receives the category assignment result, THE Task_Analyzer SHALL include the Final_Category name in the analyzed task response.
4. THE AnalyzedTask type SHALL include a `category` string field containing the Final_Category name.

### Requirement 6: Integration with Adaptive Learning Engine

**User Story:** As a user, I want the adaptive learning engine to use stable category entities for behavioral adjustments, so that grouping is consistent and accurate.

#### Acceptance Criteria

1. WHEN the Adaptive_Learning_Engine records a completion, THE Adaptive_Learning_Engine SHALL resolve the task category to a Category_Table entity and store the `category_id` on the completion_history row.
2. WHEN the Adaptive_Learning_Engine computes behavioral adjustments, THE Adaptive_Learning_Engine SHALL group completion records by `category_id` instead of the raw `category` text column.
3. THE behavioral_adjustments table SHALL reference categories by `category_id` instead of the raw category text string.
4. THE database migration SHALL migrate existing behavioral_adjustments rows to use `category_id` by matching the `category` text against the Category_Table name.

### Requirement 7: Integration with Analytics Aggregator

**User Story:** As a user, I want analytics to use stable category entities, so that dashboard metrics are consistent even when category labels change.

#### Acceptance Criteria

1. WHEN the Analytics_Aggregator computes category performance statistics, THE Analytics_Aggregator SHALL group by `category_id` and join to the Category_Table to retrieve the display name.
2. WHEN the Analytics_Aggregator computes recent behavioral changes, THE Analytics_Aggregator SHALL group by `category_id` instead of the `normalized_category` text column.
3. WHEN the Analytics_Aggregator identifies the most delayed or top improving category, THE Analytics_Aggregator SHALL use `category_id` for grouping and return the Category_Table name as the display label.

### Requirement 8: Category Management — Merge

**User Story:** As a user, I want to merge duplicate categories, so that I can consolidate fragmented data under a single category.

#### Acceptance Criteria

1. WHEN a merge request specifies a source category ID and a target category ID, THE system SHALL update all completion_history rows with the source `category_id` to the target `category_id`.
2. WHEN a merge is performed, THE system SHALL update all behavioral_adjustments rows with the source `category_id` to the target `category_id`, recomputing the combined time_multiplier and sample_size.
3. WHEN a merge is completed, THE system SHALL delete the source category row from the Category_Table.
4. IF the source category ID and target category ID are the same, THEN THE system SHALL return an error indicating that a category cannot be merged with itself.
5. IF the source category ID does not exist in the Category_Table, THEN THE system SHALL return a not-found error.

### Requirement 9: Category Management — Rename

**User Story:** As a user, I want to rename a category, so that I can correct or improve category labels without losing historical data.

#### Acceptance Criteria

1. WHEN a rename request specifies a category ID and a new name, THE system SHALL update the `name` column of the corresponding Category_Table row.
2. IF the new name already exists in the Category_Table (case-insensitive), THEN THE system SHALL return an error indicating a duplicate name conflict.
3. IF the category ID does not exist in the Category_Table, THEN THE system SHALL return a not-found error.
4. WHEN a category is renamed, THE system SHALL preserve all existing references (completion_history.category_id, behavioral_adjustments.category_id) without modification.

### Requirement 10: Category Management API Endpoints

**User Story:** As a developer, I want REST API endpoints for listing, merging, and renaming categories, so that the client can provide a category management UI.

#### Acceptance Criteria

1. THE system SHALL expose a `GET /api/categories` endpoint that returns all rows from the Category_Table ordered by name.
2. THE system SHALL expose a `POST /api/categories/merge` endpoint that accepts `sourceCategoryId` and `targetCategoryId` in the request body.
3. THE system SHALL expose a `PATCH /api/categories/:categoryId` endpoint that accepts a `name` field in the request body for renaming.
4. WHEN any category management endpoint receives invalid or missing parameters, THE system SHALL return a 400 status with a descriptive error message.
5. WHEN a category management endpoint references a non-existent category ID, THE system SHALL return a 404 status.

### Requirement 11: Category Reuse and Explosion Prevention

**User Story:** As a user, I want the system to prefer reusing existing categories, so that the category list stays manageable and does not grow unboundedly.

#### Acceptance Criteria

1. THE Category_Assigner prompt SHALL instruct the LLM to select an existing category unless the task clearly does not fit any existing category.
2. THE Category_Assigner prompt SHALL include the full list of existing category names so the LLM can make an informed selection.
3. WHEN the Category_Table contains more than 30 categories, THE Category_Assigner prompt SHALL include an additional instruction emphasizing that new categories should only be created in exceptional cases.
4. THE Category_Assigner prompt SHALL instruct the LLM that new category names must be general-purpose labels, not task-specific descriptions.
