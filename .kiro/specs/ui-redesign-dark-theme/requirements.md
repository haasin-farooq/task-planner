# Requirements Document

## Introduction

This feature redesigns the AI Daily Task Planner frontend from its current light-themed, single-column layout with inline styles into a polished, dark-themed dashboard inspired by a provided mockup. The redesign introduces a three-panel layout (left sidebar navigation, main content area, right sidebar), replaces all inline styles with Tailwind CSS utility classes, and adds new UI elements including a Today's Focus card, a donut-style progress chart, and an Upcoming tasks panel. All existing functionality (task input, parsing, analysis, metrics display, completion flow, analytics) is preserved while the visual presentation is elevated to a modern SaaS dashboard aesthetic.

## Glossary

- **App_Shell**: The root layout component that wraps all routes and provides the three-panel structure (left sidebar, main content, right sidebar).
- **Left_Sidebar**: The persistent vertical navigation panel on the left side of the viewport containing navigation links, icons, and a user profile section.
- **Main_Content_Area**: The central panel where primary task input, parsed task cards, and analytics content are rendered.
- **Right_Sidebar**: The narrower panel on the right side displaying contextual widgets: Today's Focus, Progress, and Upcoming tasks.
- **Dark_Theme**: The application-wide color scheme using a very dark background (approximately #1a1a2e), slightly lighter card surfaces, white/light-gray text, and purple/violet accent colors.
- **Task_Card**: A styled card component representing a single analyzed task, displaying its description and metric columns (priority, effort, difficulty, estimated time, dependencies).
- **Progress_Ring**: A circular SVG-based donut chart that visualizes task completion percentage with segmented arcs for Done, In Progress, Planned, and Remaining states.
- **Effort_Indicator**: A small circular progress indicator rendered as an SVG ring that displays a task's effort percentage visually.
- **Difficulty_Rating**: A dot-based visual rating (1–5 filled dots) representing a task's difficulty level.
- **Priority_Badge**: An icon-and-label combination (e.g., arrow-up icon + "High") that visually communicates task priority with color coding.
- **Today_Focus_Card**: A right-sidebar widget displaying motivational guidance text encouraging the user to focus on high-impact tasks.
- **Upcoming_Card**: A right-sidebar widget listing upcoming tasks with scheduled times, a "View all" link, and an "Add to calendar" action.
- **Tailwind_CSS**: A utility-first CSS framework used to implement the dark theme and all component styling, replacing the current inline styles.
- **Overflow_Menu**: A three-dot ("...") contextual menu on each Task_Card providing additional actions for that task.

## Requirements

### Requirement 1: Install and Configure Tailwind CSS

**User Story:** As a developer, I want Tailwind CSS integrated into the Vite build pipeline, so that all components can use utility classes for consistent dark-theme styling instead of inline styles.

#### Acceptance Criteria

1. THE Build_System SHALL include Tailwind CSS as a project dependency with a valid `tailwind.config.js` configuration file.
2. THE Build_System SHALL process Tailwind CSS directives (`@tailwind base`, `@tailwind components`, `@tailwind utilities`) and produce compiled CSS in the final bundle.
3. THE `tailwind.config.js` SHALL define a custom color palette that includes the dark background color (#1a1a2e or equivalent), card surface colors, and the purple/violet accent color for primary actions.
4. THE `tailwind.config.js` SHALL set `darkMode` to `"class"` to enable class-based dark mode toggling.
5. WHEN the application loads, THE App_Shell SHALL apply the `dark` class to the root HTML element so that dark-mode utilities are active by default.

### Requirement 2: Three-Panel App Shell Layout

**User Story:** As a user, I want the application to have a sidebar-based dashboard layout, so that I can navigate between sections and see contextual information alongside my tasks.

#### Acceptance Criteria

1. THE App_Shell SHALL render a three-panel layout consisting of the Left_Sidebar, Main_Content_Area, and Right_Sidebar arranged horizontally.
2. THE Left_Sidebar SHALL occupy a fixed width of approximately 240–260 pixels and span the full viewport height.
3. THE Main_Content_Area SHALL fill the remaining horizontal space between the Left_Sidebar and Right_Sidebar and be vertically scrollable when content overflows.
4. THE Right_Sidebar SHALL occupy a fixed width of approximately 280–320 pixels and span the full viewport height.
5. THE App_Shell SHALL use the Dark_Theme background color (#1a1a2e or equivalent) for the full viewport.
6. WHEN the viewport width is below 768 pixels, THE App_Shell SHALL collapse the Left_Sidebar into a toggleable overlay menu and hide the Right_Sidebar, stacking its content below the Main_Content_Area.

### Requirement 3: Left Sidebar Navigation

**User Story:** As a user, I want a persistent sidebar with navigation links, so that I can switch between the Planner, Analytics, Insights, and Preferences sections.

#### Acceptance Criteria

1. THE Left_Sidebar SHALL display navigation items for "Planner", "Analytics", "Insights", and "Preferences", each with an accompanying icon.
2. WHEN the user clicks a navigation item, THE Left_Sidebar SHALL navigate to the corresponding route using React Router.
3. THE Left_Sidebar SHALL visually highlight the currently active navigation item using the purple/violet accent color and a distinct background or border indicator.
4. THE Left_Sidebar SHALL display a user profile section at the bottom containing a placeholder avatar, a display name, and an email address.
5. THE Left_Sidebar SHALL use a slightly lighter dark surface color than the main background to create visual separation.

### Requirement 4: Dark Theme Styling for All Existing Components

**User Story:** As a user, I want all existing UI components to use the dark theme, so that the entire application has a cohesive, modern appearance.

#### Acceptance Criteria

1. THE TaskInput component SHALL render with a dark-surfaced card background, light-colored text, a dark textarea with a subtle border, and the purple/violet accent color on the primary "Analyze tasks" button.
2. THE TaskInput component SHALL display a header reading "Enter your tasks" and a secondary "Get AI suggestions" button in the card header area.
3. THE TaskInput component SHALL show helper text "One task per line" and "Press Cmd + Enter to analyze" below the textarea.
4. THE MetricsDisplay component SHALL render each task as a Task_Card with a dark card background, subtle border, and rounded corners.
5. THE StrategySelector component SHALL render strategy options as styled buttons or a dropdown with dark-themed surfaces and the accent color for the active selection.
6. THE ProgressIndicator component SHALL replace the current linear progress bar with the Progress_Ring donut chart in the Right_Sidebar.
7. THE CompletionDialog component SHALL render its modal overlay and dialog card using dark surface colors, light text, and the accent color for the confirm button.
8. THE CompletionSummary component SHALL render with a dark-themed success card using a green accent for the completion state.
9. THE AnalyticsDashboard component SHALL render all charts, tables, and date selectors using dark surfaces, light text, and the accent color palette.
10. THE UnblockedNotification component SHALL render its toast notification with a dark surface, light text, and a blue/purple accent border.

### Requirement 5: Redesigned Task Cards with Visual Metrics

**User Story:** As a user, I want task cards to display metrics using visual indicators instead of plain text, so that I can quickly scan and compare tasks at a glance.

#### Acceptance Criteria

1. THE Task_Card SHALL display a numbered index (1, 2, 3, …) on the left side of each card.
2. THE Task_Card SHALL display a colored status dot next to the task title: green for completed tasks, orange for in-progress tasks, and gray for planned tasks.
3. THE Task_Card SHALL display the task title and description as the primary content of the card.
4. THE Task_Card SHALL display the Priority_Badge showing an icon and label ("High", "Medium", "Low") with color coding: red/orange for high (priority 4–5), yellow for medium (priority 3), and green/blue for low (priority 1–2).
5. THE Task_Card SHALL display the Effort_Indicator as a small circular SVG progress ring with the effort percentage value shown numerically beside the ring.
6. THE Task_Card SHALL display the Difficulty_Rating as a row of 5 dots where filled dots represent the difficulty level (1–5) and unfilled dots represent the remainder.
7. THE Task_Card SHALL display the estimated time with a clock icon and a human-readable duration label (e.g., "45 min", "1h 30m").
8. THE Task_Card SHALL display dependencies with a link icon followed by the dependency task IDs, or "None" when no dependencies exist.
9. THE Task_Card SHALL display an Overflow_Menu ("...") button on the right side that provides contextual actions including "Mark Complete" and "View Details".
10. WHEN a task is completed, THE Task_Card SHALL reduce its opacity and apply a strikethrough to the task title to indicate completion.

### Requirement 6: Main Content Area Header

**User Story:** As a user, I want a clear header in the main content area, so that I understand the purpose of the planner view.

#### Acceptance Criteria

1. THE Main_Content_Area SHALL display a header with the title "Plan your day intelligently" in large, bold, light-colored text.
2. THE Main_Content_Area SHALL display a subtitle "Enter your rough tasks and let AI structure them into a prioritized plan." in smaller, muted gray text below the title.
3. THE Main_Content_Area SHALL display a "Parsed tasks" section header with a "Sort by" dropdown when analyzed tasks are present.
4. THE Main_Content_Area SHALL display a footer note reading "Tasks are AI-generated and may need review." below the task list in muted text.

### Requirement 7: Right Sidebar Widgets

**User Story:** As a user, I want contextual widgets in a right sidebar, so that I can see my daily focus, progress summary, and upcoming tasks alongside the main planner.

#### Acceptance Criteria

1. THE Today_Focus_Card SHALL display the text "Focus on 1-2 high impact tasks to make meaningful progress." inside a styled dark card in the Right_Sidebar.
2. THE Progress_Ring SHALL render as a circular SVG donut chart showing the completion percentage with segmented colored arcs for Done (green), In Progress (orange), Planned (purple), and Remaining (dark/muted).
3. THE Progress_Ring SHALL display the completion percentage as large centered text inside the ring (e.g., "40%").
4. THE Progress_Ring card SHALL display a legend below the chart listing each status category with its color swatch and task count.
5. THE Progress_Ring card SHALL display a summary line reading "{completed} of {total} tasks completed" below the legend.
6. THE Upcoming_Card SHALL display a list of upcoming tasks with their scheduled times formatted as "HH:MM AM/PM".
7. THE Upcoming_Card SHALL display a "View all" link and an "+ Add to calendar" action button.
8. WHILE no tasks have been analyzed in the current session, THE Right_Sidebar widgets SHALL display placeholder or empty-state content indicating no tasks are loaded.

### Requirement 8: Removal of All Inline Styles

**User Story:** As a developer, I want all inline styles replaced with Tailwind CSS utility classes, so that the codebase is maintainable and the styling is consistent.

#### Acceptance Criteria

1. THE App_Shell component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
2. THE TaskInput component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
3. THE MetricsDisplay component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
4. THE StrategySelector component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
5. THE ProgressIndicator component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
6. THE CompletionDialog component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
7. THE CompletionSummary component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
8. THE AnalyticsDashboard component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.
9. THE UnblockedNotification component SHALL use Tailwind CSS utility classes exclusively and contain zero inline `style` attributes.

### Requirement 9: Responsive Behavior

**User Story:** As a user, I want the dashboard to work well on different screen sizes, so that I can use the planner on both desktop and tablet devices.

#### Acceptance Criteria

1. WHEN the viewport width is 1024 pixels or wider, THE App_Shell SHALL display all three panels (Left_Sidebar, Main_Content_Area, Right_Sidebar) side by side.
2. WHEN the viewport width is between 768 and 1023 pixels, THE App_Shell SHALL hide the Right_Sidebar and allow the Main_Content_Area to fill the remaining space beside the Left_Sidebar.
3. WHEN the viewport width is below 768 pixels, THE App_Shell SHALL collapse the Left_Sidebar into a hamburger-menu overlay and render the Main_Content_Area at full width.
4. THE Task_Card metric columns SHALL wrap gracefully on narrower viewports, stacking vertically when horizontal space is insufficient.
5. THE Progress_Ring SHALL scale proportionally when rendered in a narrower container without clipping or overflow.

### Requirement 10: Accessibility Compliance

**User Story:** As a user who relies on assistive technology, I want the redesigned interface to remain accessible, so that I can use all features with a screen reader or keyboard.

#### Acceptance Criteria

1. THE Left_Sidebar navigation SHALL use a `<nav>` element with an `aria-label` attribute and each navigation item SHALL be keyboard-focusable and operable with Enter or Space keys.
2. THE Progress_Ring SVG SHALL include an `aria-label` describing the current completion percentage and a `role="img"` attribute.
3. THE Overflow_Menu SHALL be keyboard-accessible, openable with Enter or Space, and closable with Escape, and SHALL use `aria-haspopup="menu"` and `aria-expanded` attributes.
4. THE Dark_Theme color palette SHALL maintain a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text against their respective background colors, per WCAG 2.1 AA guidelines.
5. THE Difficulty_Rating dots SHALL include an `aria-label` describing the numeric difficulty level (e.g., "Difficulty: 3 out of 5").
6. THE Effort_Indicator ring SHALL include an `aria-label` describing the effort percentage (e.g., "Effort: 35%").
7. WHEN the Left_Sidebar is collapsed into an overlay on mobile viewports, THE hamburger menu button SHALL have an `aria-label` of "Open navigation menu" and the overlay SHALL trap focus until dismissed.

### Requirement 11: Preserve Existing Functionality

**User Story:** As a user, I want all existing features to continue working after the redesign, so that the visual upgrade does not break any workflows.

#### Acceptance Criteria

1. THE TaskInput component SHALL continue to submit raw text to `POST /api/tasks/parse` and display parsed tasks for review, editing, and confirmation.
2. THE MetricsDisplay component SHALL continue to render all analyzed task metrics (priority, effort, difficulty, estimated time, dependencies) and support task selection to reveal dependency details.
3. THE StrategySelector component SHALL continue to load the saved prioritization preference, allow strategy switching, re-sort tasks client-side, and persist the preference via the API.
4. THE CompletionDialog component SHALL continue to prompt for actual time spent, submit to `PATCH /api/tasks/:taskId/complete`, and report unblocked tasks.
5. THE ProgressIndicator component SHALL continue to calculate and display the correct completion percentage based on completed task IDs.
6. THE AnalyticsDashboard component SHALL continue to fetch analytics data via `GET /api/analytics/:userId` with date range parameters and display daily completions, time comparisons, difficulty breakdowns, and performance insights.
7. THE UnblockedNotification component SHALL continue to display a transient notification listing newly unblocked tasks and auto-dismiss after the configured timeout.
8. THE React Router configuration SHALL continue to serve the planner view at "/" and the analytics view at "/analytics", with additional routes for new navigation items rendering placeholder content.
