import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import TaskInput from "../TaskInput";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

describe("TaskInput", () => {
  const onConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the text area and submit button", () => {
    render(<TaskInput onConfirm={onConfirm} />);

    expect(screen.getByLabelText("Raw task input")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Parse Tasks" }),
    ).toBeInTheDocument();
  });

  it("shows an error when submitting empty input", async () => {
    const user = userEvent.setup();
    render(<TaskInput onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    expect(
      screen.getByText("Please enter at least one task."),
    ).toBeInTheDocument();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("calls the parse API and displays parsed tasks for review", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        tasks: [
          {
            id: "t1",
            rawText: "Write report",
            description: "Write report",
            isAmbiguous: false,
          },
          {
            id: "t2",
            rawText: "Review PRs",
            description: "Review PRs",
            isAmbiguous: false,
          },
        ],
        ambiguousItems: [],
        errors: [],
      },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(
      screen.getByLabelText("Raw task input"),
      "Write report\nReview PRs",
    );
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(screen.getByText("Review Your Tasks")).toBeInTheDocument();
    });

    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Review PRs")).toBeInTheDocument();
  });

  it("shows an error when the API returns no tasks with errors", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        tasks: [],
        ambiguousItems: [],
        errors: ["No tasks detected. Please enter at least one task."],
      },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("Raw task input"), "...");
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(
        screen.getByText("No tasks detected. Please enter at least one task."),
      ).toBeInTheDocument();
    });
  });

  it("shows ambiguous task indicator", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        tasks: [
          {
            id: "t1",
            rawText: "Do stuff and things",
            description: "Do stuff and things",
            isAmbiguous: true,
          },
        ],
        ambiguousItems: [],
        errors: [],
      },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(
      screen.getByLabelText("Raw task input"),
      "Do stuff and things",
    );
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Ambiguous task")).toBeInTheDocument();
    });
  });

  it("calls onConfirm with parsed tasks when user confirms", async () => {
    const user = userEvent.setup();
    const tasks = [
      {
        id: "t1",
        rawText: "Write report",
        description: "Write report",
        isAmbiguous: false,
      },
    ];
    mockedAxios.post.mockResolvedValueOnce({
      data: { tasks, ambiguousItems: [], errors: [] },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("Raw task input"), "Write report");
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(screen.getByText("Review Your Tasks")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Confirm Tasks" }));

    expect(onConfirm).toHaveBeenCalledWith(tasks);
  });

  it("allows editing a task description in review mode", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        tasks: [
          {
            id: "t1",
            rawText: "Write report",
            description: "Write report",
            isAmbiguous: false,
          },
        ],
        ambiguousItems: [],
        errors: [],
      },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("Raw task input"), "Write report");
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(screen.getByText("Write report")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Edit task: Write report" }),
    );

    const editInput = screen.getByLabelText("Edit task description");
    await user.clear(editInput);
    await user.type(editInput, "Write quarterly report");
    await user.click(screen.getByRole("button", { name: "Save edit" }));

    expect(screen.getByText("Write quarterly report")).toBeInTheDocument();
  });

  it("allows removing a task in review mode", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        tasks: [
          {
            id: "t1",
            rawText: "Task A",
            description: "Task A",
            isAmbiguous: false,
          },
          {
            id: "t2",
            rawText: "Task B",
            description: "Task B",
            isAmbiguous: false,
          },
        ],
        ambiguousItems: [],
        errors: [],
      },
    });

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("Raw task input"), "Task A\nTask B");
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(screen.getByText("Task A")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Remove task: Task A" }),
    );

    expect(screen.queryByText("Task A")).not.toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
  });

  it("handles API errors gracefully", async () => {
    const user = userEvent.setup();
    mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));
    mockedAxios.isAxiosError.mockReturnValue(false);

    render(<TaskInput onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("Raw task input"), "Some tasks");
    await user.click(screen.getByRole("button", { name: "Parse Tasks" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Something went wrong while parsing your tasks. Please try again.",
        ),
      ).toBeInTheDocument();
    });
  });
});
