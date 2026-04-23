import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LowDataState from "../LowDataState";

describe("LowDataState", () => {
  // --- Partial progress state ---

  it("shows progress message with correct counts", () => {
    render(
      <LowDataState
        current={3}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    expect(screen.getByText(/3 of 5 tasks/)).toBeInTheDocument();
    expect(screen.getByText(/2 more to unlock kpi panel/i)).toBeInTheDocument();
  });

  it("renders a progress bar with correct aria attributes", () => {
    render(
      <LowDataState
        current={3}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "3");
    expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    expect(progressbar).toHaveAttribute("aria-valuemax", "5");
  });

  it("renders the 'Almost there' heading in partial state", () => {
    render(
      <LowDataState
        current={1}
        required={2}
        unit="weeks"
        sectionName="Trends"
      />,
    );

    expect(screen.getByText("Almost there")).toBeInTheDocument();
  });

  it("clamps remaining to zero when current exceeds required", () => {
    render(
      <LowDataState
        current={10}
        required={5}
        unit="tasks"
        sectionName="Insights"
      />,
    );

    expect(screen.getByText(/0 more to unlock/i)).toBeInTheDocument();
  });

  // --- Zero-data welcome state ---

  it("shows welcome message when current is 0", () => {
    render(
      <LowDataState
        current={0}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    expect(screen.getByText("Welcome to KPI Panel")).toBeInTheDocument();
    expect(
      screen.getByText(/start completing tasks to unlock insights/i),
    ).toBeInTheDocument();
  });

  it("does not render a progress bar in zero-data state", () => {
    render(
      <LowDataState
        current={0}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("mentions the required amount and unit in zero-data state", () => {
    render(
      <LowDataState
        current={0}
        required={14}
        unit="days"
        sectionName="Recent Changes"
      />,
    );

    expect(screen.getByText(/at least 14 days/)).toBeInTheDocument();
  });

  // --- Accessibility ---

  it("has a status role with descriptive aria-label", () => {
    render(
      <LowDataState
        current={2}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute(
      "aria-label",
      "KPI Panel requires more data",
    );
  });

  // --- Styling ---

  it("applies cream background color", () => {
    render(
      <LowDataState
        current={1}
        required={5}
        unit="tasks"
        sectionName="KPI Panel"
      />,
    );

    const container = screen.getByRole("status");
    expect(container).toHaveStyle({ backgroundColor: "#FFF8F0" });
  });
});
