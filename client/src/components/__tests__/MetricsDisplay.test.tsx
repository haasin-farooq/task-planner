import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MetricsDisplay from "../MetricsDisplay";
import type { AnalyzedTask } from "../../types";

function makeTask(overrides: Partial<AnalyzedTask> = {}): AnalyzedTask {
  return {
    id: "t1",
    rawText: "Write report",
    description: "Write report",
    isAmbiguous: false,
    metrics: {
      priority: 4,
      effortPercentage: 35.0,
      difficultyLevel: 3,
      estimatedTime: 60,
      dependsOn: [],
    },
    ...overrides,
  };
}

const sampleTasks: AnalyzedTask[] = [
  makeTask({
    id: "t1",
    description: "Write report",
    metrics: {
      priority: 4,
      effortPercentage: 35.0,
      difficultyLevel: 3,
      estimatedTime: 60,
      dependsOn: ["t2"],
    },
  }),
  makeTask({
    id: "t2",
    description: "Review PRs",
    metrics: {
      priority: 2,
      effortPercentage: 25.0,
      difficultyLevel: 1,
      estimatedTime: 30,
      dependsOn: [],
    },
  }),
  makeTask({
    id: "t3",
    description: "Deploy service",
    metrics: {
      priority: 5,
      effortPercentage: 40.0,
      difficultyLevel: 5,
      estimatedTime: 90,
      dependsOn: ["t1", "t2"],
    },
  }),
];

describe("MetricsDisplay", () => {
  it("shows a message when there are no tasks", () => {
    render(<MetricsDisplay tasks={[]} completedTaskIds={new Set()} />);
    expect(screen.getByText("No tasks to display.")).toBeInTheDocument();
  });

  // Req 3.1 — Priority (now rendered via PriorityBadge inside TaskCard)
  it("displays the priority for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // TaskCard renders PriorityBadge: priority 4 → "High", 2 → "Low", 5 → "High"
    const card1 = screen.getByTestId("task-card-t1");
    expect(card1).toHaveTextContent("High");

    const card2 = screen.getByTestId("task-card-t2");
    expect(card2).toHaveTextContent("Low");

    const card3 = screen.getByTestId("task-card-t3");
    expect(card3).toHaveTextContent("High");
  });

  // Req 3.2 — Effort percentage (now rendered via EffortIndicator inside TaskCard)
  it("displays the effort percentage for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // EffortIndicator renders aria-label with rounded percentage
    const card1 = screen.getByTestId("task-card-t1");
    expect(within(card1).getByLabelText("Effort: 35%")).toBeInTheDocument();

    const card2 = screen.getByTestId("task-card-t2");
    expect(within(card2).getByLabelText("Effort: 25%")).toBeInTheDocument();

    const card3 = screen.getByTestId("task-card-t3");
    expect(within(card3).getByLabelText("Effort: 40%")).toBeInTheDocument();
  });

  // Req 3.3 — Dependencies (now rendered via TaskCard dependency section)
  it("displays dependencies for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // TaskCard shows dependency items or "None"
    const card1 = screen.getByTestId("task-card-t1");
    const deps1 = within(card1).getAllByTestId("dependency-item");
    expect(deps1).toHaveLength(1);

    const card2 = screen.getByTestId("task-card-t2");
    const deps2 = within(card2).getByTestId("dependency-item");
    expect(deps2).toHaveTextContent("None");

    const card3 = screen.getByTestId("task-card-t3");
    const deps3 = within(card3).getAllByTestId("dependency-item");
    expect(deps3).toHaveLength(2);
  });

  // Req 3.4 — Difficulty level (now rendered via DifficultyRating inside TaskCard)
  it("displays the difficulty level for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    const card1 = screen.getByTestId("task-card-t1");
    expect(
      within(card1).getByLabelText("Difficulty: 3 out of 5"),
    ).toBeInTheDocument();

    const card2 = screen.getByTestId("task-card-t2");
    expect(
      within(card2).getByLabelText("Difficulty: 1 out of 5"),
    ).toBeInTheDocument();

    const card3 = screen.getByTestId("task-card-t3");
    expect(
      within(card3).getByLabelText("Difficulty: 5 out of 5"),
    ).toBeInTheDocument();
  });

  // Req 3.5 — Estimated time (now rendered via formatDuration inside TaskCard)
  it("displays the estimated time for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // formatDuration: 60 → "1h", 30 → "30 min", 90 → "1h 30m"
    const card1 = screen.getByTestId("task-card-t1");
    expect(card1).toHaveTextContent("1h");

    const card2 = screen.getByTestId("task-card-t2");
    expect(card2).toHaveTextContent("30 min");

    const card3 = screen.getByTestId("task-card-t3");
    expect(card3).toHaveTextContent("1h 30m");
  });

  // Req 3.6 — Dependency list on selection (expanded detail in MetricsDisplay)
  it("shows the dependency list when a task with dependencies is selected", async () => {
    const user = userEvent.setup();
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // Click on task t3 which depends on t1 and t2
    await user.click(screen.getByTestId("metrics-task-t3"));

    // Should show the dependency descriptions in the expanded detail section
    expect(screen.getByTestId("dep-t3-t1")).toHaveTextContent("Write report");
    expect(screen.getByTestId("dep-t3-t2")).toHaveTextContent("Review PRs");
  });

  it("hides the dependency list when clicking the same task again", async () => {
    const user = userEvent.setup();
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // Select
    await user.click(screen.getByTestId("metrics-task-t3"));
    expect(screen.getByTestId("dep-t3-t1")).toBeInTheDocument();

    // Deselect
    await user.click(screen.getByTestId("metrics-task-t3"));
    expect(screen.queryByTestId("dep-t3-t1")).not.toBeInTheDocument();
  });

  // Req 8.1 — Completed tasks are visually distinguished
  it("visually distinguishes completed tasks with reduced opacity", () => {
    render(
      <MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set(["t2"])} />,
    );

    // The completed task wrapper should have the opacity-50 class
    const completedItem = screen.getByTestId("metrics-task-t2");
    expect(completedItem.className).toContain("opacity-50");

    // Non-completed tasks should have full opacity
    const activeItem = screen.getByTestId("metrics-task-t1");
    expect(activeItem.className).toContain("opacity-100");
  });

  // Completion is now handled via OverflowMenu inside TaskCard
  it("triggers onTaskComplete via the overflow menu Mark Complete action", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <MetricsDisplay
        tasks={sampleTasks}
        completedTaskIds={new Set()}
        onTaskComplete={onComplete}
      />,
    );

    // Open the overflow menu on the first task card
    const card1 = screen.getByTestId("task-card-t1");
    const menuButton = within(card1).getByRole("button", {
      name: "⋯",
    });
    await user.click(menuButton);

    // Click "Mark Complete" in the dropdown
    const markCompleteBtn = screen.getByRole("menuitem", {
      name: "Mark Complete",
    });
    await user.click(markCompleteBtn);

    expect(onComplete).toHaveBeenCalledWith("t1");
  });

  // Req 6.3 — Parsed tasks header
  it("displays the 'Parsed tasks' section header", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);
    expect(screen.getByText("Parsed tasks")).toBeInTheDocument();
  });

  // Req 6.4 — Footer note
  it("displays the AI-generated footer note", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);
    expect(
      screen.getByText("Tasks are AI-generated and may need review."),
    ).toBeInTheDocument();
  });
});
