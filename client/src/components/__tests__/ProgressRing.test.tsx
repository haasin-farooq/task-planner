import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressRing from "../ProgressRing";
import type { AnalyzedTask } from "../../types";

function makeTask(id: string): AnalyzedTask {
  return {
    id,
    rawText: `Task ${id}`,
    description: `Task ${id}`,
    isAmbiguous: false,
    metrics: {
      priority: 3,
      effortPercentage: 25,
      difficultyLevel: 2,
      estimatedTime: 30,
      dependsOn: [],
    },
  };
}

describe("ProgressRing", () => {
  const tasks = [
    makeTask("t1"),
    makeTask("t2"),
    makeTask("t3"),
    makeTask("t4"),
  ];

  // --- Percentage calculation ---

  it("shows 0% when no tasks are completed", () => {
    render(<ProgressRing tasks={tasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("0%");
  });

  it("shows 25% when 1 of 4 tasks is completed", () => {
    render(<ProgressRing tasks={tasks} completedTaskIds={new Set(["t1"])} />);

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("25%");
  });

  it("shows 50% when 2 of 4 tasks are completed", () => {
    render(
      <ProgressRing tasks={tasks} completedTaskIds={new Set(["t1", "t3"])} />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("50%");
  });

  it("shows 100% when all tasks are completed", () => {
    render(
      <ProgressRing
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t2", "t3", "t4"])}
      />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("100%");
  });

  it("rounds percentage correctly for 1 of 3 tasks (33%)", () => {
    const threeTasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    render(
      <ProgressRing tasks={threeTasks} completedTaskIds={new Set(["a"])} />,
    );

    // Math.round((1/3) * 100) = 33
    expect(screen.getByTestId("progress-percent")).toHaveTextContent("33%");
  });

  it("rounds percentage correctly for 2 of 3 tasks (67%)", () => {
    const threeTasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    render(
      <ProgressRing
        tasks={threeTasks}
        completedTaskIds={new Set(["a", "b"])}
      />,
    );

    // Math.round((2/3) * 100) = 67
    expect(screen.getByTestId("progress-percent")).toHaveTextContent("67%");
  });

  // --- Summary text ---

  it("displays correct summary text with no completions", () => {
    render(<ProgressRing tasks={tasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("progress-summary")).toHaveTextContent(
      "0 of 4 tasks completed",
    );
  });

  it("displays correct summary text with partial completions", () => {
    render(
      <ProgressRing tasks={tasks} completedTaskIds={new Set(["t1", "t2"])} />,
    );

    expect(screen.getByTestId("progress-summary")).toHaveTextContent(
      "2 of 4 tasks completed",
    );
  });

  it("displays correct summary text when all tasks completed", () => {
    render(
      <ProgressRing
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t2", "t3", "t4"])}
      />,
    );

    expect(screen.getByTestId("progress-summary")).toHaveTextContent(
      "4 of 4 tasks completed",
    );
  });

  // --- ARIA attributes on SVG ---

  it("has role='img' and aria-label with percentage on the SVG", () => {
    render(<ProgressRing tasks={tasks} completedTaskIds={new Set(["t1"])} />);

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", "25% of tasks completed");
  });

  it("updates aria-label when completion changes", () => {
    const { rerender } = render(
      <ProgressRing tasks={tasks} completedTaskIds={new Set()} />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "0% of tasks completed",
    );

    rerender(
      <ProgressRing
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t2", "t3"])}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "75% of tasks completed",
    );
  });

  // --- Empty state (total === 0) ---

  it("renders empty state when there are no tasks", () => {
    render(<ProgressRing tasks={[]} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("progress-ring-empty")).toBeInTheDocument();
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });

  it("has aria-label 'No tasks to display' on SVG in empty state", () => {
    render(<ProgressRing tasks={[]} completedTaskIds={new Set()} />);

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", "No tasks to display");
  });

  it("does not render summary text in empty state", () => {
    render(<ProgressRing tasks={[]} completedTaskIds={new Set()} />);

    expect(screen.queryByTestId("progress-summary")).not.toBeInTheDocument();
  });

  // --- In-progress tasks ---

  it("renders legend with correct counts for in-progress tasks", () => {
    render(
      <ProgressRing
        tasks={tasks}
        completedTaskIds={new Set(["t1"])}
        inProgressTaskIds={new Set(["t2"])}
      />,
    );

    expect(screen.getByText("Done (1)")).toBeInTheDocument();
    expect(screen.getByText("In Progress (1)")).toBeInTheDocument();
    expect(screen.getByText("Planned (2)")).toBeInTheDocument();
  });

  it("defaults inProgressTaskIds to empty set", () => {
    render(<ProgressRing tasks={tasks} completedTaskIds={new Set(["t1"])} />);

    expect(screen.getByText("Done (1)")).toBeInTheDocument();
    expect(screen.getByText("In Progress (0)")).toBeInTheDocument();
    expect(screen.getByText("Planned (3)")).toBeInTheDocument();
  });

  // --- Single task ---

  it("shows 100% for a single completed task", () => {
    const singleTask = [makeTask("only")];
    render(
      <ProgressRing tasks={singleTask} completedTaskIds={new Set(["only"])} />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("100%");
    expect(screen.getByTestId("progress-summary")).toHaveTextContent(
      "1 of 1 tasks completed",
    );
  });
});
