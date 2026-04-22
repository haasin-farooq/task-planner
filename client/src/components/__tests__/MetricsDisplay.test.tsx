import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  // Req 3.1 — Priority
  it("displays the priority for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("priority-t1")).toHaveTextContent("Priority: 4");
    expect(screen.getByTestId("priority-t2")).toHaveTextContent("Priority: 2");
    expect(screen.getByTestId("priority-t3")).toHaveTextContent("Priority: 5");
  });

  // Req 3.2 — Effort percentage
  it("displays the effort percentage for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("effort-t1")).toHaveTextContent("Effort: 35.0%");
    expect(screen.getByTestId("effort-t2")).toHaveTextContent("Effort: 25.0%");
    expect(screen.getByTestId("effort-t3")).toHaveTextContent("Effort: 40.0%");
  });

  // Req 3.3 — Dependency count
  it("displays the dependency count for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("dependencies-t1")).toHaveTextContent(
      "Dependencies: 1",
    );
    expect(screen.getByTestId("dependencies-t2")).toHaveTextContent(
      "Dependencies: 0",
    );
    expect(screen.getByTestId("dependencies-t3")).toHaveTextContent(
      "Dependencies: 2",
    );
  });

  // Req 3.4 — Difficulty level
  it("displays the difficulty level for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("difficulty-t1")).toHaveTextContent(
      "Difficulty: 3",
    );
    expect(screen.getByTestId("difficulty-t2")).toHaveTextContent(
      "Difficulty: 1",
    );
    expect(screen.getByTestId("difficulty-t3")).toHaveTextContent(
      "Difficulty: 5",
    );
  });

  // Req 3.5 — Estimated time
  it("displays the estimated time for each task", () => {
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("estimated-time-t1")).toHaveTextContent(
      "Est. Time: 60 min",
    );
    expect(screen.getByTestId("estimated-time-t2")).toHaveTextContent(
      "Est. Time: 30 min",
    );
    expect(screen.getByTestId("estimated-time-t3")).toHaveTextContent(
      "Est. Time: 90 min",
    );
  });

  // Req 3.6 — Dependency list on selection
  it("shows the dependency list when a task with dependencies is selected", async () => {
    const user = userEvent.setup();
    render(<MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set()} />);

    // Click on task t3 which depends on t1 and t2
    await user.click(screen.getByTestId("metrics-task-t3"));

    // Should show the dependency descriptions
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
  it("visually distinguishes completed tasks with strikethrough", () => {
    render(
      <MetricsDisplay tasks={sampleTasks} completedTaskIds={new Set(["t2"])} />,
    );

    // The completed task should have a checkmark
    const completedItem = screen.getByTestId("metrics-task-t2");
    expect(completedItem).toHaveTextContent("✓");

    // The completed task should have reduced opacity
    expect(completedItem).toHaveStyle({ opacity: "0.5" });

    // Non-completed tasks should have full opacity
    const activeItem = screen.getByTestId("metrics-task-t1");
    expect(activeItem).toHaveStyle({ opacity: "1" });
  });

  it("does not show the Mark Complete button for completed tasks", () => {
    const onComplete = vi.fn();
    render(
      <MetricsDisplay
        tasks={sampleTasks}
        completedTaskIds={new Set(["t2"])}
        onTaskComplete={onComplete}
      />,
    );

    // Completed task should not have a complete button
    expect(
      screen.queryByLabelText('Mark "Review PRs" as complete'),
    ).not.toBeInTheDocument();

    // Non-completed tasks should have the button
    expect(
      screen.getByLabelText('Mark "Write report" as complete'),
    ).toBeInTheDocument();
  });

  it("calls onTaskComplete when the Mark Complete button is clicked", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <MetricsDisplay
        tasks={sampleTasks}
        completedTaskIds={new Set()}
        onTaskComplete={onComplete}
      />,
    );

    await user.click(screen.getByLabelText('Mark "Write report" as complete'));

    expect(onComplete).toHaveBeenCalledWith("t1");
  });
});
