import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressIndicator from "../ProgressIndicator";
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

describe("ProgressIndicator", () => {
  const tasks = [
    makeTask("t1"),
    makeTask("t2"),
    makeTask("t3"),
    makeTask("t4"),
  ];

  // Req 8.2 — Progress indicator updates on completion
  it("shows 0% when no tasks are completed", () => {
    render(<ProgressIndicator tasks={tasks} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("0%");
    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "0 of 4 tasks completed",
    );

    const bar = screen.getByTestId("progress-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows 25% when 1 of 4 tasks is completed", () => {
    render(
      <ProgressIndicator tasks={tasks} completedTaskIds={new Set(["t1"])} />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("25%");
    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "1 of 4 tasks completed",
    );

    const bar = screen.getByTestId("progress-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
  });

  it("shows 50% when 2 of 4 tasks are completed", () => {
    render(
      <ProgressIndicator
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t3"])}
      />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("50%");
    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "2 of 4 tasks completed",
    );
  });

  it("shows 100% when all tasks are completed", () => {
    render(
      <ProgressIndicator
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t2", "t3", "t4"])}
      />,
    );

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("100%");
    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "4 of 4 tasks completed",
    );

    const bar = screen.getByTestId("progress-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });

  it("handles 0 total tasks gracefully (0%)", () => {
    render(<ProgressIndicator tasks={[]} completedTaskIds={new Set()} />);

    expect(screen.getByTestId("progress-percent")).toHaveTextContent("0%");
    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "0 of 0 tasks completed",
    );
  });

  it("uses singular 'task' when there is exactly 1 task", () => {
    render(
      <ProgressIndicator
        tasks={[makeTask("t1")]}
        completedTaskIds={new Set()}
      />,
    );

    expect(screen.getByTestId("progress-count")).toHaveTextContent(
      "0 of 1 task completed",
    );
  });

  it("updates the progress bar fill width", () => {
    const { rerender } = render(
      <ProgressIndicator tasks={tasks} completedTaskIds={new Set()} />,
    );

    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill).toHaveStyle({ width: "0%" });

    // Simulate completing 2 tasks
    rerender(
      <ProgressIndicator
        tasks={tasks}
        completedTaskIds={new Set(["t1", "t2"])}
      />,
    );

    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("has proper ARIA attributes on the progress bar", () => {
    render(
      <ProgressIndicator tasks={tasks} completedTaskIds={new Set(["t1"])} />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-label", "25% of tasks completed");
  });
});
