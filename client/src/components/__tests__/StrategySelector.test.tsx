import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import StrategySelector from "../StrategySelector";
import type { AnalyzedTask, PrioritizationStrategy } from "../../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

// We don't need to mock the task-organizer — it's a pure function and
// we can verify the callback receives correctly sorted results.

function makeTask(
  id: string,
  priority: number,
  effort: number,
  difficulty: number,
): AnalyzedTask {
  return {
    id,
    rawText: `Task ${id}`,
    description: `Task ${id}`,
    isAmbiguous: false,
    metrics: {
      priority,
      effortPercentage: effort,
      difficultyLevel: difficulty,
      estimatedTime: 30,
      dependsOn: [],
    },
  };
}

const sampleTasks: AnalyzedTask[] = [
  makeTask("t1", 3, 40, 2),
  makeTask("t2", 5, 10, 4),
  makeTask("t3", 1, 50, 1),
];

describe("StrategySelector", () => {
  const onTasksReordered = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Req 5.2 — Load saved preference on mount
  it("loads the saved preference on mount and applies it", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { strategy: "least-effort-first" },
    });

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    // Should show loading state initially
    expect(screen.getByText("Loading preference…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    // Should have called the preferences API
    expect(mockedAxios.get).toHaveBeenCalledWith("/api/preferences/user-1");

    // Should have called onTasksReordered with the loaded strategy
    expect(onTasksReordered).toHaveBeenCalledWith(
      expect.any(Array),
      "least-effort-first",
    );

    // The "Least Effort First" button should be pressed
    expect(
      screen.getByRole("button", { name: "Sort by Least Effort First" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  // Req 5.4 — Default to "highest-priority-first" when no profile exists
  it("defaults to highest-priority-first when API returns 404", async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 404 } });

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    expect(onTasksReordered).toHaveBeenCalledWith(
      expect.any(Array),
      "highest-priority-first",
    );

    expect(
      screen.getByRole("button", {
        name: "Sort by Highest Priority First",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  // Req 4.7 — Re-ordering on strategy change
  it("re-sorts tasks and saves preference when strategy changes", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { strategy: "highest-priority-first" },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: {} });

    const user = userEvent.setup();

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    // Clear the initial call from mount
    onTasksReordered.mockClear();

    // Click "Hardest First"
    await user.click(
      screen.getByRole("button", { name: "Sort by Hardest First" }),
    );

    // Should immediately re-sort (Req 4.7 — < 2 seconds)
    expect(onTasksReordered).toHaveBeenCalledWith(
      expect.any(Array),
      "hardest-first",
    );

    // Should persist the preference (Req 5.1, 5.3)
    await waitFor(() => {
      expect(mockedAxios.put).toHaveBeenCalledWith("/api/preferences/user-1", {
        strategy: "hardest-first",
      });
    });
  });

  it("renders all four strategy buttons", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { strategy: "highest-priority-first" },
    });

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", {
        name: "Sort by Highest Priority First",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sort by Least Effort First" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sort by Hardest First" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sort by Dependency-Aware" }),
    ).toBeInTheDocument();
  });

  it("shows an error message when saving preference fails", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { strategy: "highest-priority-first" },
    });
    mockedAxios.put.mockRejectedValueOnce(new Error("Network error"));

    const user = userEvent.setup();

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Sort by Hardest First" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Failed to save preference. Your selection is applied locally.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not re-sort when clicking the already active strategy", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { strategy: "highest-priority-first" },
    });

    const user = userEvent.setup();

    render(
      <StrategySelector
        userId="user-1"
        tasks={sampleTasks}
        onTasksReordered={onTasksReordered}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading preference…")).not.toBeInTheDocument();
    });

    onTasksReordered.mockClear();

    // Click the already-active strategy
    await user.click(
      screen.getByRole("button", {
        name: "Sort by Highest Priority First",
      }),
    );

    // Should not trigger a re-sort
    expect(onTasksReordered).not.toHaveBeenCalled();
    expect(mockedAxios.put).not.toHaveBeenCalled();
  });
});
