# Requirements Document

## Introduction

The Analytics Dashboard Redesign transforms the existing flat, shallow analytics view of the AI Daily Task Planner into a rich behavioral insights dashboard. The current dashboard provides basic daily completion charts, time comparisons, difficulty breakdowns, and simple strength/improvement labels. The redesigned dashboard introduces overview KPIs, weekly behavior trends, normalized category performance, natural language behavioral insights, estimation accuracy tracking, difficulty and effort calibration, recent behavioral change detection, and thoughtful low-data states. A key prerequisite is normalizing the free-text categories currently stored in `completion_history` into consistent, canonical groups so that per-category analytics are meaningful and comparable over time.

## Glossary

- **Analytics_Dashboard**: The redesigned frontend view that displays behavioral insights, KPIs, trends, and category performance derived from the user's task completion history.
- **Analytics_Aggregator**: The backend service that queries `completion_history` and `behavioral_adjustments` tables and computes all aggregated metrics, trends, and insights for the dashboard.
- **Category_Normalizer**: A backend component that maps free-text category strings from `completion_history` into canonical category groups using keyword-based matching and synonym resolution.
- **Canonical_Category**: A normalized, consistent category label (e.g., "Writing", "Admin", "Development") produced by the Category_Normalizer from raw free-text categories.
- **KPI_Panel**: The top-level section of the Analytics_Dashboard displaying summary key performance indicators for the selected period.
- **Trend_Chart**: A time-series visualization rendered using CSS/SVG showing metric values across consecutive weeks.
- **Insight_Generator**: A backend component within the Analytics_Aggregator that produces natural language behavioral insight strings from aggregated data patterns.
- **Estimation_Accuracy**: A metric computed as `1 - (|actual_time - estimated_time| / estimated_time)` for a given task, clamped to [0, 1], representing how close the AI estimate was to reality.
- **Time_Overrun**: The difference `actual_time - estimated_time` for a completed task, expressed in minutes. Positive values indicate the task took longer than estimated.
- **Insufficient_Data_Threshold**: The minimum number of completed tasks required before a specific analytics section can display meaningful results. Varies by section (e.g., 5 for basic stats, 14 days of data for weekly trends, 3 tasks per category for category stats).
- **Adaptive_Learning_Engine**: The existing backend component that records task completions and maintains per-category rolling behavioral adjustments. The redesigned dashboard must preserve compatibility with this engine.

## Requirements

### Requirement 1: Category Normalization

**User Story:** As a user, I want my free-text task categories to be normalized into consistent groups, so that per-category analytics are meaningful and comparable across tasks.

#### Acceptance Criteria

1. WHEN a completion record is stored, THE Category_Normalizer SHALL map the raw free-text category to a Canonical_Category using keyword-based matching and synonym resolution.
2. THE Category_Normalizer SHALL maintain a mapping table of keywords and synonyms to Canonical_Category labels (e.g., "write", "writing", "blog", "article" all map to "Writing").
3. IF the Category_Normalizer cannot match a raw category to any Canonical_Category, THEN THE Category_Normalizer SHALL assign the raw category to a "Other" Canonical_Category.
4. THE Category_Normalizer SHALL normalize categories in a case-insensitive manner.
5. WHEN the Analytics_Aggregator computes category-based metrics, THE Analytics_Aggregator SHALL use Canonical_Category values for grouping instead of raw category strings.
6. THE Category_Normalizer SHALL provide a backfill operation that normalizes all existing `completion_history` records that lack a Canonical_Category assignment.
7. THE Category_Normalizer SHALL preserve the original raw category value in `completion_history` so that no data is lost during normalization.

### Requirement 2: Overview KPIs

**User Story:** As a user, I want to see a summary panel of key performance indicators at the top of the dashboard, so that I can quickly understand my productivity at a glance.

#### Acceptance Criteria

1. THE KPI_Panel SHALL display the total number of tasks completed within the selected date range.
2. THE KPI_Panel SHALL display the completion rate as the percentage of planned tasks that were completed within the selected date range.
3. THE KPI_Panel SHALL display the average estimated time and the average actual time across all completed tasks in the selected date range.
4. THE KPI_Panel SHALL display an Estimation_Accuracy score as a percentage, computed as the average of per-task `1 - (|actual_time - estimated_time| / estimated_time)` clamped to [0, 1], across all completed tasks in the selected date range.
5. THE KPI_Panel SHALL display the Canonical_Category with the largest improvement in Estimation_Accuracy over the last 4 weeks compared to the preceding 4 weeks, labeled as "Top Improving Category."
6. THE KPI_Panel SHALL display the Canonical_Category with the highest average positive Time_Overrun in the selected date range, labeled as "Most Delayed Category."
7. WHEN the user has fewer than 5 completed tasks in the selected date range, THE KPI_Panel SHALL display placeholder values with a message indicating that more completed tasks are needed.

### Requirement 3: Weekly Behavior Trends

**User Story:** As a user, I want to see how my productivity metrics change week over week, so that I can identify patterns and track improvement over time.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL display a Trend_Chart showing the total number of tasks completed per week for the last 8 weeks.
2. THE Analytics_Dashboard SHALL display a Trend_Chart showing the total actual time spent per week for the last 8 weeks.
3. THE Analytics_Dashboard SHALL display a Trend_Chart showing the average actual time versus the average estimated time per week for the last 8 weeks.
4. WHEN the user hovers over or focuses on a data point in a Trend_Chart, THE Analytics_Dashboard SHALL display a tooltip showing the exact numeric value and the week date range.
5. THE Analytics_Dashboard SHALL render Trend_Charts using Recharts (a React charting library) with `ResponsiveContainer` for automatic resizing. Only micro-visuals such as KPI trend indicators and mini progress rings SHALL use inline SVG/CSS.
6. WHEN fewer than 2 weeks of completion data exist, THE Analytics_Dashboard SHALL display a message stating the number of additional weeks of data needed to unlock trend analysis.

### Requirement 4: Category Performance

**User Story:** As a user, I want to see detailed performance metrics for each task category, so that I can understand which types of tasks I estimate well and which I struggle with.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL display a table of Canonical_Categories with the following columns for each: category name, average estimated time, average actual time, average Time_Overrun, and sample size.
2. THE Analytics_Dashboard SHALL sort the category table by average Time_Overrun in descending order by default, placing the most overestimated categories at the top.
3. THE Analytics_Dashboard SHALL display a "Consistently Faster" list showing Canonical_Categories where the average actual time is below the average estimated time by at least 10% across a minimum of 3 completed tasks.
4. THE Analytics_Dashboard SHALL display a "Consistently Slower" list showing Canonical_Categories where the average actual time exceeds the average estimated time by at least 10% across a minimum of 3 completed tasks.
5. WHEN a Canonical_Category has fewer than 3 completed tasks, THE Analytics_Dashboard SHALL display the category with a visual indicator and a label stating the number of additional tasks needed for reliable statistics.

### Requirement 5: Behavioral Insights

**User Story:** As a user, I want to see natural language interpretations of my data patterns, so that I can understand what the numbers mean without having to analyze charts myself.

#### Acceptance Criteria

1. THE Insight_Generator SHALL produce natural language insight strings based on patterns detected in the user's completion history.
2. WHEN a Canonical_Category has an average Time_Overrun exceeding 15% of the average estimated time across at least 5 tasks, THE Insight_Generator SHALL produce an insight stating the category name and the percentage by which the user typically underestimates tasks in that category.
3. WHEN a Canonical_Category shows a decreasing trend in average actual time over the last 4 weeks (at least 1 task per week), THE Insight_Generator SHALL produce an insight stating that the user is getting faster at tasks in that category.
4. WHEN a Canonical_Category shows an increasing trend in Estimation_Accuracy over the last 4 weeks, THE Insight_Generator SHALL produce an insight stating that the AI estimates for that category are improving.
5. THE Analytics_Dashboard SHALL display up to 5 behavioral insight strings in a dedicated section, ordered by the magnitude of the underlying pattern.
6. WHEN fewer than 10 completed tasks exist in the user's history, THE Analytics_Dashboard SHALL display a message in the insights section stating how many more tasks are needed before insights can be generated.

### Requirement 6: Estimation Accuracy Tracking

**User Story:** As a user, I want to see how accurate the AI's time estimates are and whether they are improving, so that I can trust the estimates and understand the AI's learning progress.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL display a Trend_Chart showing the weekly average Estimation_Accuracy as a percentage for the last 8 weeks.
2. THE Analytics_Dashboard SHALL display a Trend_Chart showing the weekly average absolute percentage error (computed as `|actual_time - estimated_time| / estimated_time * 100`) for the last 8 weeks.
3. THE Analytics_Dashboard SHALL display a summary label indicating whether the overall Estimation_Accuracy trend is "Improving", "Stable", or "Declining" based on a linear regression slope over the last 8 weeks of data.
4. WHEN fewer than 2 weeks of completion data exist, THE Analytics_Dashboard SHALL display a message in the estimation accuracy section stating the number of additional weeks needed to show accuracy trends.

### Requirement 7: Difficulty and Effort Calibration

**User Story:** As a user, I want to understand how task difficulty relates to actual effort, so that I can better plan my day and calibrate my expectations for different difficulty levels.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL display a table showing each difficulty level (1 through 5) with the average estimated time, average actual time, average Time_Overrun, and task count for that level.
2. THE Analytics_Dashboard SHALL visually highlight difficulty levels where the average actual time exceeds the average estimated time by more than 20%, indicating systematic underestimation.
3. THE Analytics_Dashboard SHALL display a correlation indicator showing whether higher difficulty levels correspond to proportionally longer actual completion times.
4. WHEN a difficulty level has fewer than 3 completed tasks, THE Analytics_Dashboard SHALL display that level with a visual indicator noting insufficient data.

### Requirement 8: Recent Behavioral Changes

**User Story:** As a user, I want to see what has changed recently in my task completion behavior, so that I can be aware of emerging patterns and adjust my planning.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL display a list of Canonical_Categories that have become faster in the last 2 weeks compared to the preceding 4 weeks, showing the percentage change in average actual time.
2. THE Analytics_Dashboard SHALL display a list of Canonical_Categories that have become slower in the last 2 weeks compared to the preceding 4 weeks, showing the percentage change in average actual time.
3. THE Analytics_Dashboard SHALL display a list of up to 5 individual tasks with the largest positive Time_Overrun completed in the last 2 weeks, showing the task description, estimated time, actual time, and overrun amount.
4. THE Analytics_Dashboard SHALL display a list of Canonical_Categories that have fewer than 3 completed tasks in the last 4 weeks, labeled as "Categories with Limited Data."
5. WHEN fewer than 14 days of completion data exist, THE Analytics_Dashboard SHALL display a message in the recent changes section stating the number of additional days needed.

### Requirement 9: Low-Data and Empty States

**User Story:** As a user, I want to see helpful guidance messages when there is not enough data for a dashboard section, so that I understand what I need to do to unlock each feature.

#### Acceptance Criteria

1. WHEN a dashboard section requires a minimum data threshold that is not met, THE Analytics_Dashboard SHALL display a contextual message specific to that section explaining what data is needed.
2. THE Analytics_Dashboard SHALL display progress indicators in low-data states showing how close the user is to unlocking a section (e.g., "3 of 5 tasks completed — 2 more to unlock this section").
3. WHEN the user has zero completed tasks, THE Analytics_Dashboard SHALL display a single welcoming empty state with guidance on how to start tracking analytics.
4. THE Analytics_Dashboard SHALL render low-data state messages using the application's warm editorial design system with cream backgrounds and orange accents.

### Requirement 10: Dashboard Layout and Responsiveness

**User Story:** As a user, I want the analytics dashboard to be well-organized and usable on different screen sizes, so that I can review my analytics comfortably on any device.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL organize sections in the following order from top to bottom: KPI Panel, Weekly Behavior Trends, Category Performance, Behavioral Insights, Estimation Accuracy, Difficulty and Effort Calibration, Recent Behavioral Changes.
2. THE Analytics_Dashboard SHALL use the application's existing warm editorial design system including cream backgrounds (#FFF8F0), orange accent color, and Lora serif font for headings.
3. WHILE the viewport width is 768 pixels or wider, THE Analytics_Dashboard SHALL display KPI cards in a horizontal row and charts at full width.
4. WHILE the viewport width is less than 768 pixels, THE Analytics_Dashboard SHALL stack KPI cards vertically and reduce chart widths to fit the viewport.
5. THE Analytics_Dashboard SHALL render main chart visualizations using Recharts with `ResponsiveContainer`. Only micro-visuals (KPI indicators, decorative accents) SHALL use inline SVG/CSS.
6. THE Analytics_Dashboard SHALL maintain a date range selector that allows the user to choose the analysis period, defaulting to the last 30 days.
7. THE Analytics_Dashboard SHALL preserve compatibility with the existing `GET /api/analytics/:userId` endpoint by extending the response shape rather than replacing it.

### Requirement 11: Accessibility

**User Story:** As a user who relies on assistive technology, I want the analytics dashboard to be accessible, so that I can understand my productivity data regardless of how I interact with the application.

#### Acceptance Criteria

1. THE Analytics_Dashboard SHALL provide text alternatives for all SVG chart visualizations using appropriate ARIA labels that convey the data represented.
2. THE Analytics_Dashboard SHALL ensure all interactive elements (date selectors, tooltips, expandable sections) are keyboard navigable.
3. THE Analytics_Dashboard SHALL use semantic HTML elements (tables for tabular data, headings for section titles, lists for ranked items) throughout the dashboard.
4. THE Analytics_Dashboard SHALL ensure sufficient color contrast ratios (minimum 4.5:1 for normal text, 3:1 for large text) between text and background colors in all dashboard sections.
5. WHEN a Trend_Chart tooltip is displayed, THE Analytics_Dashboard SHALL announce the tooltip content to screen readers using an ARIA live region.
