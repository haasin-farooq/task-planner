# Implementation Plan: UI Redesign — Dark Theme Dashboard

## Overview

This plan transforms the AI Daily Task Planner frontend from a light-themed, single-column layout with inline styles into a dark-themed, three-panel SaaS dashboard using Tailwind CSS. Implementation proceeds incrementally: Tailwind setup first, then utility functions and small visual components, then the layout shell, then restyling existing components, and finally wiring everything together with responsive behavior and accessibility.

## Tasks

- [x] 1. Install and configure Tailwind CSS
  - [x] 1.1 Install Tailwind CSS, PostCSS, and Autoprefixer as dev dependencies and create `tailwind.config.js` with the custom dark theme color palette (`dark-bg`, `dark-surface`, `dark-card`, `dark-border`, `accent`, `accent-light`, `accent-dark`), `darkMode: "class"`, and content paths pointing to `./index.html` and `./src/**/*.{ts,tsx}`
    - Create `postcss.config.js` with tailwindcss and autoprefixer plugins
    - Create `src/index.css` with `@tailwind base`, `@tailwind components`, `@tailwind utilities` directives
    - Import `index.css` in `src/main.tsx`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Update `index.html` to apply the `dark` class to the `<html>` element so dark-mode utilities are active by default
    - _Requirements: 1.5_

- [x] 2. Implement pure utility functions
  - [x] 2.1 Create `src/utils/format-duration.ts` with the `formatDuration(minutes: number): string` function
    - Values < 60 → `"{N} min"`, ≥ 60 with no remainder → `"{H}h"`, ≥ 60 with remainder → `"{H}h {M}m"`
    - _Requirements: 5.7_

  - [ ]\* 2.2 Write property test for `formatDuration` (Property 4: Duration formatting round-trip)
    - **Property 4: Duration formatting round-trip**
    - **Validates: Requirements 5.7**
    - Create `src/utils/__tests__/format-duration.property.test.ts`
    - Use `fc.integer({ min: 1, max: 1440 })` to generate minute values
    - Verify round-trip: parsing the output string back yields the original minutes
    - Verify pattern: values < 60 match `"{N} min"`, values ≥ 60 include `"h"`

  - [x] 2.3 Create `src/utils/priority-config.ts` with the `getPriorityConfig(priority: number): PriorityConfig` function
    - Map priority 4–5 → `{ label: "High", colorClass: "...", icon: "..." }`, 3 → Medium, 1–2 → Low
    - _Requirements: 5.4_

  - [ ]\* 2.4 Write property test for `getPriorityConfig` (Property 1: Priority badge mapping is total and consistent)
    - **Property 1: Priority badge mapping is total and consistent**
    - **Validates: Requirements 5.4**
    - Create `src/utils/__tests__/priority-config.property.test.ts`
    - Use `fc.integer({ min: 1, max: 5 })` to generate priority values
    - Verify label mapping: 4–5 → "High", 3 → "Medium", 1–2 → "Low"
    - Verify non-empty colorClass and icon strings

  - [x] 2.5 Create `src/utils/progress-segments.ts` with the `getProgressSegments(total, completed, inProgress, circumference): ProgressSegment[]` function
    - Compute SVG arc segments (Done, In Progress, Planned, Remaining) with dashLength and dashOffset values
    - _Requirements: 7.2_

  - [ ]\* 2.6 Write property test for `getProgressSegments` (Property 6: Progress ring arc segments sum to full circumference)
    - **Property 6: Progress ring arc segments sum to full circumference**
    - **Validates: Requirements 7.2**
    - Create `src/utils/__tests__/progress-segments.property.test.ts`
    - Use `fc.record` with constrained integers for total (≥1), completed, inProgress where completed + inProgress ≤ total
    - Verify dashLength values sum to the full circumference within floating-point tolerance

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement small visual metric components
  - [x] 4.1 Create `src/components/PriorityBadge.tsx` — a pure component that renders an icon and label ("High", "Medium", "Low") with color coding using `getPriorityConfig`
    - Use Tailwind classes for all styling, no inline styles
    - _Requirements: 5.4_

  - [x] 4.2 Create `src/components/EffortIndicator.tsx` — a pure component that renders a small SVG ring showing effort percentage with numeric label
    - Include `aria-label="Effort: {N}%"` for accessibility
    - Use Tailwind classes for layout, SVG attributes for the ring
    - _Requirements: 5.5, 10.6_

  - [ ]\* 4.3 Write property test for `EffortIndicator` (Property 2: Effort indicator rendering and accessibility)
    - **Property 2: Effort indicator rendering and accessibility**
    - **Validates: Requirements 5.5, 10.6**
    - Create `src/components/__tests__/EffortIndicator.property.test.tsx`
    - Use `fc.integer({ min: 0, max: 100 })` to generate effort percentages
    - Render the component and verify: SVG arc length matches `(effortPercentage / 100) * circumference`, numeric percentage is displayed, `aria-label` reads `"Effort: {N}%"`

  - [x] 4.4 Create `src/components/DifficultyRating.tsx` — a pure component that renders 5 dots with `level` filled and `5 - level` unfilled
    - Include `aria-label="Difficulty: {N} out of 5"` for accessibility
    - _Requirements: 5.6, 10.5_

  - [ ]\* 4.5 Write property test for `DifficultyRating` (Property 3: Difficulty rating rendering and accessibility)
    - **Property 3: Difficulty rating rendering and accessibility**
    - **Validates: Requirements 5.6, 10.5**
    - Create `src/components/__tests__/DifficultyRating.property.test.tsx`
    - Use `fc.integer({ min: 1, max: 5 })` to generate difficulty levels
    - Render the component and verify: exactly 5 dots total, exactly `level` filled dots, exactly `5 - level` unfilled dots, `aria-label` reads `"Difficulty: {level} out of 5"`

  - [x] 4.6 Create `src/components/OverflowMenu.tsx` — a keyboard-accessible three-dot menu with "Mark Complete" and "View Details" actions
    - Use `aria-haspopup="menu"`, `aria-expanded`, open with Enter/Space, close with Escape
    - Close on outside click
    - Use Tailwind classes for all styling
    - _Requirements: 5.9, 10.3_

- [x] 5. Implement TaskCard component
  - [x] 5.1 Create `src/components/TaskCard.tsx` that composes PriorityBadge, EffortIndicator, DifficultyRating, OverflowMenu, and `formatDuration`
    - Display numbered index, colored status dot (green/orange/gray), task title, all metric indicators
    - Display dependencies with link icon and dependency task descriptions or "None"
    - Completed tasks: reduced opacity + strikethrough on title
    - Use Tailwind classes exclusively, no inline styles
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]\* 5.2 Write property test for TaskCard dependencies display (Property 5: Dependencies display completeness)
    - **Property 5: Dependencies display completeness**
    - **Validates: Requirements 5.8**
    - Create `src/components/__tests__/TaskCard.property.test.tsx`
    - Use `fc.array(fc.uuid())` to generate dependency arrays
    - Render TaskCard and verify: empty array shows "None", non-empty array displays every dependency ID, displayed count equals array length

- [x] 6. Implement ProgressRing component
  - [x] 6.1 Create `src/components/ProgressRing.tsx` using SVG `<circle>` elements with `stroke-dasharray`/`stroke-dashoffset` for arc segments
    - Display centered percentage text inside the ring
    - Render legend below with color swatches and counts for Done, In Progress, Planned, Remaining
    - Display summary line `"{completed} of {total} tasks completed"`
    - Include `role="img"` and `aria-label` on the SVG describing completion percentage
    - Handle `total === 0` with empty/placeholder state
    - Use Tailwind classes for layout, no inline styles
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 10.2_

  - [ ]\* 6.2 Write property test for ProgressRing text accuracy (Property 7: Progress ring text accuracy)
    - **Property 7: Progress ring text accuracy**
    - **Validates: Requirements 7.3, 7.5**
    - Create `src/components/__tests__/ProgressRing.property.test.tsx`
    - Generate arrays of tasks and subsets of completed IDs
    - Render ProgressRing and verify: displayed percentage equals `Math.round((completed / total) * 100)`, summary line reads `"{completed} of {total} tasks completed"` with correct values

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement layout shell and sidebar components
  - [x] 8.1 Create `src/components/LeftSidebar.tsx` with navigation items for Planner, Analytics, Insights, and Preferences
    - Each item has an icon and label, uses React Router `NavLink` for active highlighting with accent color
    - Render `<nav aria-label="Main navigation">` with keyboard-focusable links
    - Display user profile section at bottom with placeholder avatar, name, email
    - Use slightly lighter dark surface color than main background
    - Accept `isOpen` and `onClose` props for mobile overlay state
    - Use Tailwind classes exclusively
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.1_

  - [x] 8.2 Create `src/components/RightSidebar.tsx` as a container for TodayFocusCard, ProgressRing, and UpcomingCard
    - Accept `tasks` and `completedTaskIds` props
    - Show empty-state placeholders when no tasks are loaded
    - Use Tailwind classes exclusively
    - _Requirements: 7.8_

  - [x] 8.3 Create `src/components/TodayFocusCard.tsx` — static motivational card with "Focus on 1-2 high impact tasks" text
    - Use dark card styling with Tailwind classes
    - _Requirements: 7.1_

  - [x] 8.4 Create `src/components/UpcomingCard.tsx` — list of upcoming incomplete tasks with placeholder times, "View all" link, and "+ Add to calendar" button
    - Use Tailwind classes exclusively
    - _Requirements: 7.6, 7.7_

  - [x] 8.5 Create `src/components/AppShell.tsx` as the root layout component replacing the current NavBar + `<main>` structure
    - Render `<div className="dark">` at root with flex row containing LeftSidebar, `<Outlet />` (main content), and RightSidebar
    - Manage mobile sidebar toggle state (hamburger button with `aria-label="Open navigation menu"`)
    - Apply dark-bg background color to full viewport
    - Use Tailwind classes exclusively
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.7_

- [x] 9. Restyle existing components — remove all inline styles and apply Tailwind CSS
  - [x] 9.1 Restyle `TaskInput.tsx` — replace all inline `style` attributes with Tailwind utility classes
    - Dark-surfaced card background, light text, dark textarea with subtle border
    - Purple/violet accent on primary button
    - Add header "Enter your tasks" and secondary "Get AI suggestions" button
    - Add helper text "One task per line" and "Press Cmd + Enter to analyze"
    - Preserve all existing functionality and props unchanged
    - _Requirements: 4.1, 4.2, 4.3, 8.2, 11.1_

  - [x] 9.2 Restyle `MetricsDisplay.tsx` — replace inline styles with Tailwind classes and delegate rendering to TaskCard components
    - Add "Parsed tasks" section header with "Sort by" dropdown integration
    - Add footer note "Tasks are AI-generated and may need review."
    - Preserve all existing functionality: task selection, dependency reveal, completion callbacks
    - _Requirements: 4.4, 6.3, 6.4, 8.3, 11.2_

  - [x] 9.3 Restyle `StrategySelector.tsx` — replace inline styles with Tailwind classes
    - Dark-themed button group with accent color for active selection
    - Preserve strategy switching, preference loading/saving, and re-sort behavior
    - _Requirements: 4.5, 8.4, 11.3_

  - [x] 9.4 Restyle `CompletionDialog.tsx` — replace inline styles with Tailwind classes
    - Dark modal overlay and card surfaces, light text, accent confirm button
    - Preserve actual time input, API submission, and unblocked task reporting
    - _Requirements: 4.7, 8.6, 11.4_

  - [x] 9.5 Restyle `CompletionSummary.tsx` — replace inline styles with Tailwind classes
    - Dark success card with green accent for completion state
    - Preserve time comparison display
    - _Requirements: 4.8, 8.7, 11.5 (mapped from Req 4.8 and 8.7)_

  - [x] 9.6 Restyle `AnalyticsDashboard.tsx` — replace inline styles with Tailwind classes
    - Dark surfaces, light text, accent color palette for charts and tables
    - Preserve date range selection, daily completions, time comparisons, difficulty breakdowns, performance insights
    - _Requirements: 4.9, 8.8, 11.6_

  - [x] 9.7 Restyle `UnblockedNotification.tsx` — replace inline styles with Tailwind classes
    - Dark toast with purple/blue accent border
    - Preserve auto-dismiss behavior and task listing
    - _Requirements: 4.10, 8.9, 11.7_

- [x] 10. Wire App.tsx with AppShell and update routing
  - [x] 10.1 Refactor `App.tsx` to use `AppShell` as a layout route wrapping all child routes via `<Outlet />`
    - Remove the old `NavBar` component
    - Add routes for `/insights` and `/preferences` rendering placeholder content
    - Pass tasks and completedTaskIds to RightSidebar through context or props
    - Preserve planner view at "/" and analytics view at "/analytics"
    - _Requirements: 2.1, 6.1, 6.2, 11.8_

  - [x] 10.2 Add main content area header with title "Plan your day intelligently" and subtitle in the PlannerView
    - _Requirements: 6.1, 6.2_

  - [x] 10.3 Replace the ProgressIndicator usage in PlannerView with the ProgressRing in the RightSidebar
    - Ensure the ProgressRing receives the correct tasks and completedTaskIds
    - _Requirements: 4.6, 11.5_

- [x] 11. Implement responsive behavior
  - [x] 11.1 Add Tailwind responsive classes to AppShell for three breakpoints
    - ≥1024px: all three panels side by side
    - 768–1023px: hide RightSidebar, MainContent fills remaining space
    - <768px: collapse LeftSidebar to hamburger overlay with focus trap, MainContent full width, RightSidebar content stacks below
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 11.2 Ensure TaskCard metric columns wrap gracefully on narrow viewports using Tailwind flex-wrap utilities
    - _Requirements: 9.4_

  - [x] 11.3 Ensure ProgressRing scales proportionally in narrower containers without clipping
    - _Requirements: 9.5_

- [x] 12. Update existing tests for DOM structure changes
  - [x] 12.1 Update `TaskInput.test.tsx` to account for changed DOM structure (new header text, button labels, Tailwind classes instead of inline styles)
    - Preserve all behavioral assertions; update element queries as needed
    - _Requirements: 11.1_

  - [x] 12.2 Update `MetricsDisplay.test.tsx` to account for TaskCard delegation and new DOM structure
    - Preserve all behavioral assertions for metrics display, task selection, dependency reveal, completion
    - _Requirements: 11.2_

  - [x] 12.3 Update `ProgressIndicator.test.tsx` or create new `ProgressRing.test.tsx` to test the replacement component
    - Verify percentage calculation, summary text, ARIA attributes on SVG
    - _Requirements: 11.5_

  - [x] 12.4 Update `StrategySelector.test.tsx` and `CompletionDialog.test.tsx` for Tailwind class changes
    - Preserve all behavioral assertions
    - _Requirements: 11.3, 11.4_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All existing component interfaces (props, callbacks, API calls) remain unchanged — modifications are purely presentational
- The project already has `fast-check` as a dev dependency for property-based tests
- No backend changes are required; all API integrations remain identical
