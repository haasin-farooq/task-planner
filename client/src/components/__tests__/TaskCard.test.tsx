import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TaskCard from "../TaskCard";
import type { AnalyzedTask } from "../../types";

/**
 * Unit tests for TaskCard with CategoryBadge integration.
 * Validates: Requirements 11.1, 11.4, 11.5
 */

/** Helper to build a minimal AnalyzedTask with optional category. */
function makeTask(overrides: Partial<AnalyzedTask> = {}): AnalyzedTask {
  return {
    id: "t1",
    rawText: "Write report",
    description: "Write report",
    isAmbiguous: false,
    metrics: {
      priority: 3,
      effortPercentage: 25,
      difficultyLevel: 2,
      estimatedTime: 30,
      dependsOn: [],
    },
    ...overrides,
  };
}

describe("TaskCard — CategoryBadge integration", () => {
  // --- Req 11.1, 11.5: Badge appears in metrics row when category is set ---

  it("renders a CategoryBadge when task has a category", () => {
    const task = makeTask({ category: "Development" });

    render(
      <TaskCard task={task} index={1} isCompleted={false} allTasks={[task]} />,
    );

    const badge = screen.getByTestId("category-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Development");
  });

  // --- Req 11.4: No badge when category is undefined ---

  it("does not render a CategoryBadge when task has no category", () => {
    const task = makeTask(); // no category field

    render(
      <TaskCard task={task} index={1} isCompleted={false} allTasks={[task]} />,
    );

    expect(screen.queryByTestId("category-badge")).not.toBeInTheDocument();
  });

  it("does not render a CategoryBadge when category is explicitly undefined", () => {
    const task = makeTask({ category: undefined });

    render(
      <TaskCard task={task} index={1} isCompleted={false} allTasks={[task]} />,
    );

    expect(screen.queryByTestId("category-badge")).not.toBeInTheDocument();
  });

  // --- Req 11.5: Badge appears alongside other metrics ---

  it("renders CategoryBadge alongside priority badge and effort indicator", () => {
    const task = makeTask({ category: "Health" });

    render(
      <TaskCard task={task} index={1} isCompleted={false} allTasks={[task]} />,
    );

    // CategoryBadge is present
    const badge = screen.getByTestId("category-badge");
    expect(badge).toHaveTextContent("Health");

    // Priority badge text is present (priority 3 = "Medium")
    expect(screen.getByText("Medium")).toBeInTheDocument();

    // Effort indicator is present (25%)
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("renders the correct category name for different categories", () => {
    const task = makeTask({ category: "Interview Prep" });

    render(
      <TaskCard task={task} index={1} isCompleted={false} allTasks={[task]} />,
    );

    const badge = screen.getByTestId("category-badge");
    expect(badge).toHaveTextContent("Interview Prep");
  });
});
