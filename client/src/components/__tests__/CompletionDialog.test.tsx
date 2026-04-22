import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import CompletionDialog from "../CompletionDialog";
import type { AnalyzedTask } from "../../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const sampleTask: AnalyzedTask = {
  id: "t1",
  rawText: "Write report",
  description: "Write report",
  isAmbiguous: false,
  metrics: {
    priority: 4,
    effortPercentage: 35,
    difficultyLevel: 3,
    estimatedTime: 60,
    dependsOn: [],
  },
};

describe("CompletionDialog", () => {
  const onCancel = vi.fn();
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dialog with task description and estimated time", () => {
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText(/Estimated time: 60 min/)).toBeInTheDocument();
  });

  it("pre-fills the actual time input with the estimated time", () => {
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByTestId("actual-time-input") as HTMLInputElement;
    expect(input.value).toBe("60");
  });

  it("captures actual time and submits to the API", async () => {
    const user = userEvent.setup();
    mockedAxios.patch.mockResolvedValueOnce({
      data: {
        taskId: "t1",
        completed: true,
        actualTime: 45,
        unblockedTasks: [{ id: "t2", description: "Review PRs" }],
      },
    });

    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByTestId("actual-time-input");
    await user.clear(input);
    await user.type(input, "45");

    await user.click(screen.getByTestId("confirm-complete-btn"));

    await waitFor(() => {
      expect(mockedAxios.patch).toHaveBeenCalledWith("/api/tasks/t1/complete", {
        actualTime: 45,
      });
    });

    expect(onComplete).toHaveBeenCalledWith("t1", 45, [
      { id: "t2", description: "Review PRs" },
    ]);
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });

  it("disables the confirm button when actual time is invalid", async () => {
    const user = userEvent.setup();
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByTestId("actual-time-input");
    await user.clear(input);

    // Empty input should disable the button
    expect(screen.getByTestId("confirm-complete-btn")).toBeDisabled();
  });

  it("disables the confirm button when actual time is zero or negative", async () => {
    const user = userEvent.setup();
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByTestId("actual-time-input");
    await user.clear(input);
    await user.type(input, "0");

    expect(screen.getByTestId("confirm-complete-btn")).toBeDisabled();
  });

  it("shows an error when the API call fails", async () => {
    const user = userEvent.setup();
    mockedAxios.patch.mockRejectedValueOnce(new Error("Network error"));
    mockedAxios.isAxiosError.mockReturnValue(false);

    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByTestId("confirm-complete-btn"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to mark task as complete. Please try again."),
      ).toBeInTheDocument();
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("closes the dialog when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalled();
  });

  it("submits when Enter is pressed in the input field", async () => {
    const user = userEvent.setup();
    mockedAxios.patch.mockResolvedValueOnce({
      data: {
        taskId: "t1",
        completed: true,
        actualTime: 60,
        unblockedTasks: [],
      },
    });

    render(
      <CompletionDialog
        task={sampleTask}
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByTestId("actual-time-input");
    // Focus is already on the input (autoFocus), just press Enter
    await user.click(input);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockedAxios.patch).toHaveBeenCalled();
    });
  });
});
